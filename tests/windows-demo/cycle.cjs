// Runs on real Windows against the ZIP, not a substitute PHP/browser fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
let root = process.env.TCG_WINDOWS_DEMO;
const privateFill = async (locator, value) => { try { await locator.fill(value); } catch { throw new Error('Could not fill a private setup/login field'); } };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 240000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const result = await fn(); if (result) return result; await wait(500); }
    throw new Error('Timed out waiting for Windows demo');
}
const ps = script => execFileSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; ' + script], { encoding: 'utf8', windowsHide: true }).trim();
const trust = () => ps('$all = @(); foreach ($location in @("CurrentUser", "LocalMachine")) { $s = [System.Security.Cryptography.X509Certificates.X509Store]::new("Root", $location); $s.Open("ReadOnly"); $all += $s.Certificates.Thumbprint; $s.Close() }; $all | Sort-Object | ConvertTo-Json -Compress');
function request(running, action, body, { cookie = '', csrf = '', rawPath, origin } = {}) {
    return new Promise((resolve, reject) => {
        const req = https.request(running.origin + (rawPath || '/admin/api.php?action=' + action), {
            ca: fs.readFileSync(running.certificate), method: body === undefined ? 'GET' : 'POST',
            headers: { Origin: origin || running.origin, Cookie: cookie, 'X-TCG-CSRF': csrf, 'Content-Type': 'application/json' }
        }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => { const text = Buffer.concat(chunks).toString(); let data; try { data = JSON.parse(text); } catch { data = { text }; } resolve({ status: res.statusCode, data, headers: res.headers }); }); });
        req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
}

test('actual portable Windows ZIP: clean setup, GrapesJS, PHP publication, restart and reset', { timeout: 1000000 }, async t => {
    assert.equal(process.platform, 'win32');
    assert.ok(root);
    const originalTrust = trust(), errors = [];
    let current, browser, admin;
    const measurements = { startupMs: [], memory: [] };
    const sumFiles = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? sumFiles(path.join(dir, f.name)) : fs.statSync(path.join(dir, f.name)).size), 0);
    measurements.unpackedBytes = sumFiles(root);
    async function sampleProcesses() {
        const snapshot = JSON.parse(ps(`
            $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)
            $ids = [System.Collections.Generic.HashSet[int]]::new()
            [void]$ids.Add(${current.running.launcherPid})
            do { $changed = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and $ids.Add([int]$p.ProcessId)) { $changed = $true } } } while ($changed)
            $p = @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue)
            $tcp = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $ids.Contains([int]$_.OwningProcess) } | Select-Object LocalAddress,RemoteAddress,State)
            @{ pids=@($ids); workingSetBytes=($p | Measure-Object WorkingSet64 -Sum).Sum; tcp=$tcp } | ConvertTo-Json -Depth 4 -Compress
        `));
        snapshot.pids.forEach(id => current.observedPids.add(id));
        measurements.memory.push(snapshot.workingSetBytes);
        assert.ok(snapshot.tcp.every(c => ['127.0.0.1', '::1', '0.0.0.0', '::'].includes(c.RemoteAddress)), 'no demo process connects to an external address');
        assert.ok(snapshot.tcp.filter(c => c.State === 2 || c.State === 'Listen').every(c => ['127.0.0.1', '::1'].includes(c.LocalAddress)), 'child process listeners are loopback-only');
    }
    const pidExists = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    async function launch() {
        const started = Date.now();
        const cleanEnv = { ...process.env, PATH: [path.join(process.env.SystemRoot, 'System32'), process.env.SystemRoot].join(';') };
        const command = spawn('cmd.exe', ['/d', '/c', 'START-DEMO.cmd'], { cwd: root, env: cleanEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = ''; command.stderr.on('data', data => stderr += data); command.stdout.resume();
        current = { command, observedPids: new Set() };
        const running = await until(() => {
            if (command.exitCode !== null) throw new Error('START-DEMO exited: ' + stderr);
            try { return JSON.parse(fs.readFileSync(path.join(root, 'demo-data/running.json'))); } catch { return null; }
        });
        current.running = running;
        browser = await chromium.connectOverCDP('http://127.0.0.1:' + running.debugPort, { timeout: 60000 });
        const context = browser.contexts()[0]; context.setDefaultTimeout(120000);
        admin = await until(() => context.pages().find(p => p.url().startsWith(running.origin + '/admin/')));
        const startupLog = [];
        const diagnosticCDP = await context.newCDPSession(admin);
        diagnosticCDP.on('Log.entryAdded', ({ entry }) => { if (entry.level === 'error') startupLog.push({ source: entry.source, text: entry.text, url: entry.url }); });
        await diagnosticCDP.send('Log.enable');
        await admin.bringToFront();
        await admin.waitForLoadState('load');
        // Keep the real desktop viewport: CDP device metrics must not extend
        // the canvas beyond the native Windows window's input surface.
        const ui = await admin.evaluate(() => ({
            sheets: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => ({ path: new URL(l.href).pathname, loaded: !!l.sheet, rules: l.sheet?.cssRules.length, firstRule: l.sheet?.cssRules[0]?.cssText.slice(0, 160) })),
            viewport: [innerWidth, innerHeight], screen: [screen.width, screen.height],
            bodyMargin: getComputedStyle(document.body).margin,
            globals: { grapesjs: typeof window.grapesjs, repository: typeof window.TCGRepository, php: typeof window.TCGPHP, document: typeof window.TCGDocument },
            loginStatus: document.getElementById('login-status')?.textContent
        }));
        console.log('Native admin layout', JSON.stringify(ui));
        console.log('Browser startup errors', JSON.stringify(startupLog));
        for (const name of ['admin/builder.css', 'admin/builder.js', 'admin/php-repository.js']) {
            const served = await request(running, '', undefined, { rawPath: '/' + name });
            console.log('Resource identity', JSON.stringify({ name, status: served.status, type: served.headers['content-type'], sha256: crypto.createHash('sha256').update(served.data.text || '').digest('hex'), bytes: Buffer.byteLength(served.data.text || '') }));
        }
        await diagnosticCDP.detach();
        if (ui.sheets.some(s => !s.loaded || !s.rules) || ui.bodyMargin !== '0px' || ui.globals.php !== 'object') {
            await admin.screenshot({ path: path.join(process.env.RUNNER_TEMP, 'tcg-rte-debug.png'), fullPage: true });
            assert.fail('The real admin stylesheet failed to load; mouse/RTE tests cannot proceed');
        }
        measurements.startupMs.push(Date.now() - started);
        admin.on('pageerror', error => errors.push(error.message));
        await sampleProcesses();
        return { context, running };
    }
    async function close() {
        await sampleProcesses();
        const { command, running, observedPids } = current;
        await admin.close();
        await until(() => command.exitCode !== null, 60000);
        await wait(1000);
        for (const pid of new Set([...observedPids, running.vmPid, running.browserPid, running.launcherPid])) assert.equal(pidExists(pid), false, 'no surviving demo process ' + pid);
        assert.equal(fs.existsSync(path.join(root, 'demo-data/running.json')), false);
        assert.equal(fs.existsSync(path.join(root, 'demo-data/boot.json')), false);
        current = null;
    }
    t.after(async () => {
        if (current) { try { await admin?.close(); } catch {} await wait(3000); if (current.command.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(current.command.pid), '/T', '/F']); }
    });

    let { context, running } = await launch();
    const expectedCSS = JSON.parse(fs.readFileSync(path.join(root, 'runtime/release-manifest.json'))).files['admin/builder.css'];
    const burst = async target => Promise.all(Array.from({ length: 24 }, async () => {
        try { const r = await request(target, '', undefined, { rawPath: '/admin/builder.css' }); return r.status === 200 && crypto.createHash('sha256').update(r.data.text || '').digest('hex') === expectedCSS; }
        catch { return false; }
    }));
    const rawBurst = await burst({ ...running, origin: 'https://127.0.0.1:' + running.guestPort });
    console.log('QEMU direct burst failures', rawBurst.filter(ok => !ok).length);
    for (let round = 0; round < 3; round++) assert.ok((await burst(running)).every(Boolean), 'queued TLS transport serves all concurrent resources intact');
    assert.equal((await request(running, 'tree')).status, 401);
    const session = await request(running, 'session');
    assert.equal(session.data.setupRequired, true);
    assert.match(session.headers['set-cookie'][0], /secure/i);
    assert.match(session.headers['set-cookie'][0], /httponly/i);
    assert.match(session.headers['set-cookie'][0], /samesite=strict/i);
    for (const target of ['/admin/_app/release.php', '/admin/_app/seed.php', '/.tcg-test/owner.json']) assert.ok((await request(running, '', undefined, { rawPath: target })).status >= 400);
    const settings = JSON.parse(fs.readFileSync(path.join(root, 'demo-data/settings.json')));
    assert.equal(settings.activationKey.length, 43);
    const credentials = { username: 'demo-owner', password: 'Portable demo password 42' };
    assert.equal((await request(running, 'setup', { activationKey: settings.activationKey, ...credentials })).status, 403, 'CSRF is mandatory');
    try { await admin.locator('#activation-key').waitFor({ timeout: 30000 }); }
    catch (error) { console.log('Setup failure', await admin.locator('#login-status').textContent()); await admin.screenshot({ path: path.join(process.env.RUNNER_TEMP, 'tcg-rte-debug.png'), fullPage: true }); throw error; }
    await privateFill(admin.locator('#activation-key'), settings.activationKey);
    await admin.locator('#php-username').fill(credentials.username);
    await privateFill(admin.locator('#php-password'), credentials.password);
    await admin.locator('#php-login-form button').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/', {}, { timeout: 180000 });
    console.log('Checkpoint: secure activation and real page list');
    assert.equal(await admin.locator('#page-list [data-path]').count(), 51);
    await admin.locator('#logout').click();
    await admin.locator('#php-login-form').waitFor();
    assert.equal(await admin.locator('#activation-key').count(), 0);
    await admin.locator('#php-username').fill(credentials.username);
    await privateFill(admin.locator('#php-password'), credentials.password);
    await admin.locator('#php-login-form button').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    const api = async (action, body) => admin.evaluate(async ({ action, body }) => {
        const session = await (await fetch('/admin/api.php?action=session')).json();
        const r = await fetch('/admin/api.php?action=' + action, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TCG-CSRF': session.csrf }, body: JSON.stringify(body) });
        return { status: r.status, data: await r.json() };
    }, { action, body });
    const caps = await api('capabilities'); assert.equal(caps.data.privateStorage, true); assert.equal(caps.data.write, true);
    const published = async () => {
        await admin.waitForFunction(() => { const s = document.getElementById('status'); return s.textContent.startsWith('Опубліковано.') || s.parentElement.classList.contains('error'); }, {}, { timeout: 180000 });
        assert.match(await admin.locator('#status').innerText(), /^Опубліковано\./);
    };
    assert.match(caps.data.php, /^8\.[2-5]\./);
    assert.equal((await api('read&path=..%2Findex.html')).status, 403);
    await admin.locator('#new-page').click();
    await admin.locator('#new-title').fill('Тест Windows'); await admin.locator('#new-slug').fill('windows-test');
    await admin.getByRole('button', { name: 'Створити сторінку', exact: true }).click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-test/');
    const canvas = admin.frameLocator('.gjs-frame');
    const heading = canvas.getByText('Тест Windows', { exact: true });
    const editable = canvas.locator('[contenteditable="true"]');
    await heading.evaluate(node => {
        window.__tcgPointerEvents = [];
        for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'focusin']) document.addEventListener(type, e => window.__tcgPointerEvents.push({ type, tag: e.target.tagName, id: e.target.id, trusted: e.isTrusted }), true);
    });
    console.log('Canvas input geometry', JSON.stringify({ heading: await heading.boundingBox(), frame: await admin.locator('.gjs-frame').boundingBox() }));
    for (let attempt = 0; attempt < 3; attempt++) {
        await heading.dblclick({ delay: 120 });
        try { await editable.waitFor({ state: 'visible', timeout: 3000 }); break; }
        catch (error) {
            if (attempt === 2) {
                console.log('RTE diagnostic', JSON.stringify(await admin.evaluate(() => {
                    const ed = window.grapesjs.editors[window.grapesjs.editors.length - 1], selected = ed.getSelected();
                    const body = ed.Canvas.getBody();
                    return { focus: document.hasFocus(), frameFocus: body.ownerDocument.hasFocus(),
                        selection: selected ? { type: selected.get('type'), tag: selected.get('tagName'), editable: selected.get('editable') } : null,
                        headings: ed.getWrapper().find('h1').map(h => ({ type: h.get('type'), editable: h.get('editable'), content: h.get('content') })),
                        editables: Array.from(body.querySelectorAll('[contenteditable]')).map(n => ({ tag: n.tagName, value: n.getAttribute('contenteditable') })),
                        heading: body.querySelector('h1')?.outerHTML, pointerEvents: body.ownerDocument.defaultView.__tcgPointerEvents };
                })));
                await admin.screenshot({ path: path.join(process.env.RUNNER_TEMP, 'tcg-rte-debug.png'), fullPage: true });
                throw error;
            }
            await heading.click();
        }
    }
    const received = await heading.evaluate(node => window.__tcgPointerEvents);
    assert.ok(received.some(e => e.type === 'dblclick' && e.tag === 'H1' && e.trusted), 'real mouse double click reaches the text component');
    assert.equal(await heading.evaluate(node => document.hasFocus()), true, 'canvas receives focus through real mouse input');
    console.log('Checkpoint: trusted mouse RTE and iframe focus');
    await editable.fill('Збережено у Windows'); await admin.locator('#page-title').click();
    await admin.getByRole('button', { name: 'Зображення', exact: true }).click();
    if (!await admin.locator('#asset-dialog').isVisible()) await admin.locator('#choose-image').click();
    await admin.locator('#asset-upload').setInputFiles({ name: 'demo-logo.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(__dirname, '../../images/favicon-32.png')) });
    await admin.locator('#asset-dialog').waitFor({ state: 'hidden' });
    const previewEvent = context.waitForEvent('page'); await admin.locator('#preview').click();
    const preview = await previewEvent; await preview.waitForLoadState();
    assert.equal(await preview.locator('h1').innerText(), 'Збережено у Windows'); await preview.close();
    await admin.locator('#publish').click();
    await published();
    await sampleProcesses();
    console.log('Checkpoint: image, preview and real PHP publication');
    let visitor = await context.newPage(); await visitor.goto(running.origin + '/windows-test/');
    assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows');
    await visitor.locator('img[src^="/images/editor/"]').evaluate(image => image.decode());
    const version = (await request(running, '', undefined, { rawPath: '/site-version.json' })).data;
    assert.ok(JSON.stringify(version).length > 20);
    await admin.reload(); await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('[data-path="windows-test.html"]').click();
    await canvas.getByText('Збережено у Windows', { exact: true }).waitFor();
    await admin.locator('#php-menu-button').click(); await admin.locator('#php-menu-add').click();
    await admin.locator('dialog[open] select').last().selectOption('windows-test.html');
    await admin.locator('dialog[open] input[aria-label="Назва пункту"]').last().fill('Windows демо');
    await admin.locator('#php-menu-save').click(); await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('#publish').click(); await published();
    await visitor.reload(); assert.equal(await visitor.locator('.site-header nav a[href="/windows-test/"]').count(), 1);
    await visitor.goto(running.origin + '/');
    await visitor.waitForFunction(() => window.TCGNavigation === true);
    await visitor.evaluate(() => { window.__tcgSPAProbe = 'same document'; });
    await visitor.locator('.site-header nav a[href="/windows-test/"][data-tcg-page]').click();
    await visitor.waitForURL(running.origin + '/windows-test/');
    await visitor.getByRole('heading', { name: 'Збережено у Windows', exact: true }).waitFor();
    assert.equal(await visitor.evaluate(() => window.__tcgSPAProbe), 'same document', 'SPA changes the page without replacing the document');
    console.log('Checkpoint: saved project, shared menu and real SPA click');
    const stale = (await api('tree')).data.head;
    assert.equal((await api('save', { head: stale, changes: [{ path: 'images/editor/bad.png', encoding: 'base64', content: Buffer.from('<?php echo 1;').toString('base64') }] })).status, 400);
    await admin.locator('[data-path="windows-test.html"]').click(); await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-test/');
    await admin.locator('#php-rename-button').click(); await admin.locator('#php-new-address').fill('windows-renamed');
    await admin.getByRole('button', { name: 'Перейменувати', exact: true }).click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    assert.equal((await api('publish', { head: stale })).status, 409);
    await admin.locator('#publish').click(); await published();
    await visitor.goto(running.origin + '/windows-test.html'); await visitor.waitForURL(running.origin + '/windows-renamed/');
    await admin.locator('[data-path="windows-renamed.html"]').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-renamed/');
    admin.once('dialog', dialog => dialog.accept()); await admin.locator('#php-delete-button').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('#publish').click(); await published();
    assert.equal((await request(running, '', undefined, { rawPath: '/windows-renamed/' })).status, 404);
    await visitor.goto(running.origin + '/'); assert.equal(await visitor.locator('a[href="/windows-renamed/"]').count(), 0);
    await admin.locator('#php-versions-button').click(); admin.once('dialog', dialog => dialog.accept());
    await admin.locator('dialog[open]').getByRole('button', { name: 'Відновити', exact: true }).first().click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('[data-path="windows-renamed.html"]').waitFor();
    await admin.locator('#publish').click(); await published();
    await visitor.bringToFront();
    await visitor.goto(running.origin + '/windows-test.html'); await visitor.waitForURL(running.origin + '/windows-renamed/');
    assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows');
    console.log('Checkpoint: rename, delete, history restoration and legacy URLs');
    await visitor.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {}, { timeout: 120000 });
    assert.ok(await visitor.evaluate(async () => (await caches.keys()).some(k => k.startsWith('tgroup-pwa-'))));
    await visitor.reload();
    try { await until(() => visitor.evaluate(async () => !!(await caches.match(location.href))), 120000); }
    catch (error) {
        console.log('PWA diagnostic', JSON.stringify(await visitor.evaluate(async () => ({
            visible: document.visibilityState, online: navigator.onLine, build: document.querySelector('meta[name="tcg-build"]')?.content,
            caches: await caches.keys(), controller: navigator.serviceWorker.controller?.scriptURL,
            registrations: await Promise.all((await navigator.serviceWorker.getRegistrations()).map(async r => ({ active: r.active?.state, installing: r.installing?.state, waiting: r.waiting?.state }))),
            storedPageKeys: (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => new URL(r.url).pathname).filter(p => p.includes('windows-'))))).flat()
        }))));
        throw error;
    }
    await context.setOffline(true);
    try { await visitor.reload(); assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows'); }
    finally { await context.setOffline(false); }
    const network = await context.newPage(); await assert.rejects(network.goto('https://example.com/'), /ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/); await network.close();
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-untrusted-'));
    const openssl = path.join(process.env.ProgramFiles, 'Git/usr/bin/openssl.exe');
    execFileSync(openssl, ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    const fixtureSockets = new Set();
    const untrusted = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (_, res) => res.end('unexpected trust'));
    untrusted.on('connection', socket => { fixtureSockets.add(socket); socket.once('close', () => fixtureSockets.delete(socket)); });
    await new Promise(resolve => untrusted.listen(0, '127.0.0.1', resolve));
    const certificateProbe = await context.newPage();
    try { await assert.rejects(certificateProbe.goto('https://127.0.0.1:' + untrusted.address().port), /ERR_CERT_AUTHORITY_INVALID/, 'the demo browser must reject other self-signed certificates'); }
    finally { await certificateProbe.close(); for (const socket of fixtureSockets) socket.destroy(); untrusted.closeAllConnections(); await new Promise(resolve => untrusted.close(resolve)); fs.rmSync(certDir, { recursive: true, force: true }); }
    const listeners = JSON.parse(ps(`Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in @(${running.vmPid},${running.browserPid},${running.launcherPid}) } | Select-Object LocalAddress,LocalPort | ConvertTo-Json -Compress`));
    assert.ok([].concat(listeners).length >= 2);
    assert.ok([].concat(listeners).every(x => ['127.0.0.1', '::1'].includes(x.LocalAddress)), 'all test listeners are loopback-only');
    // Closing the original admin must close preview windows and all VM processes.
    console.log('Checkpoint: PWA offline, strict TLS and loopback isolation');
    const originalOrigin = running.origin; await close();
    const movedRoot = root + ' — перенесено';
    fs.renameSync(root, movedRoot); root = movedRoot;
    ({ context, running } = await launch()); assert.equal(running.origin, originalOrigin);
    assert.equal((await request(running, 'session')).data.setupRequired, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'demo-data/settings.json'))).activationKey, settings.activationKey, 'test identity survives moving and restarting the folder');
    if (await admin.locator('#php-login-form').isVisible()) {
        await admin.locator('#php-username').fill(credentials.username); await privateFill(admin.locator('#php-password'), credentials.password); await admin.locator('#php-login-form button').click();
    }
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/', {}, { timeout: 180000 });
    await admin.locator('[data-path="windows-renamed.html"]').waitFor();
    visitor = await context.newPage(); await visitor.goto(running.origin + '/windows-renamed/'); assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows');
    await close();
    const reset = spawn('cmd.exe', ['/d', '/c', 'RESET-DEMO.cmd'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    reset.stdout.resume(); reset.stderr.resume(); reset.stdin.end('RESET\r\n\r\n');
    await new Promise((resolve, reject) => { reset.on('error', reject); reset.on('exit', code => code === 0 ? resolve() : reject(new Error('RESET failed'))); });
    console.log('Checkpoint: persistence after folder move and restart; complete RESET');
    assert.equal(fs.existsSync(path.join(root, 'demo-data')), false);
    ({ running } = await launch()); assert.equal((await request(running, 'session')).data.setupRequired, true);
    assert.notEqual(JSON.parse(fs.readFileSync(path.join(root, 'demo-data/settings.json'))).activationKey, settings.activationKey, 'RESET creates a new independent test identity');
    await close();
    assert.equal(trust(), originalTrust, 'the Windows certificate store is unchanged');
    assert.deepEqual(errors, []);
    console.log('Windows ZIP measurements', JSON.stringify({ ...measurements, sampledPeakWorkingSetBytes: Math.max(...measurements.memory) }));
});
