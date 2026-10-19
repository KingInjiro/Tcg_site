// Runs on real Windows against the ZIP, not a substitute PHP/browser fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const root = process.env.TCG_WINDOWS_DEMO;
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
    const pidExists = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
    async function launch() {
        const command = spawn('cmd.exe', ['/d', '/c', 'START-DEMO.cmd'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = ''; command.stderr.on('data', data => stderr += data); command.stdout.resume();
        current = { command };
        const running = await until(() => {
            if (command.exitCode !== null) throw new Error('START-DEMO exited: ' + stderr);
            try { return JSON.parse(fs.readFileSync(path.join(root, 'demo-data/running.json'))); } catch { return null; }
        });
        current.running = running;
        browser = await chromium.connectOverCDP('http://127.0.0.1:' + running.debugPort);
        const context = browser.contexts()[0]; context.setDefaultTimeout(120000);
        admin = await until(() => context.pages().find(p => p.url().startsWith(running.origin + '/admin/')));
        admin.on('pageerror', error => errors.push(error.message));
        return { context, running };
    }
    async function close() {
        const { command, running } = current;
        await admin.close();
        await until(() => command.exitCode !== null, 60000);
        await wait(1000);
        for (const pid of [running.vmPid, running.browserPid, running.launcherPid]) assert.equal(pidExists(pid), false, 'no surviving demo process ' + pid);
        assert.equal(fs.existsSync(path.join(root, 'demo-data/running.json')), false);
        assert.equal(fs.existsSync(path.join(root, 'demo-data/boot.json')), false);
        current = null;
    }
    t.after(async () => {
        if (current) { try { await admin?.close(); } catch {} await wait(3000); if (current.command.exitCode === null) execFileSync('taskkill.exe', ['/PID', String(current.command.pid), '/T', '/F']); }
    });

    let { context, running } = await launch();
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
    await admin.locator('#activation-key').fill(settings.activationKey);
    await admin.locator('#php-username').fill(credentials.username);
    await admin.locator('#php-password').fill(credentials.password);
    await admin.locator('#php-login-form button').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/', {}, { timeout: 180000 });
    assert.equal(await admin.locator('#page-list [data-path]').count(), 51);
    const api = async (action, body) => admin.evaluate(async ({ action, body }) => {
        const session = await (await fetch('/admin/api.php?action=session')).json();
        const r = await fetch('/admin/api.php?action=' + action, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TCG-CSRF': session.csrf }, body: JSON.stringify(body) });
        return { status: r.status, data: await r.json() };
    }, { action, body });
    const caps = await api('capabilities'); assert.equal(caps.data.privateStorage, true); assert.equal(caps.data.write, true);
    assert.match(caps.data.php, /^8\.[2-5]\./);
    assert.equal((await api('read&path=..%2Findex.html')).status, 403);
    await admin.locator('#new-page').click();
    await admin.locator('#new-title').fill('Тест Windows'); await admin.locator('#new-slug').fill('windows-test');
    await admin.getByRole('button', { name: 'Створити сторінку', exact: true }).click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-test/');
    const canvas = admin.frameLocator('.gjs-frame');
    await canvas.getByText('Тест Windows', { exact: true }).dblclick();
    await canvas.locator('[contenteditable="true"]').fill('Збережено у Windows'); await admin.locator('#page-title').click();
    await admin.getByRole('button', { name: 'Зображення', exact: true }).click();
    if (!await admin.locator('#asset-dialog').isVisible()) await admin.locator('#choose-image').click();
    await admin.locator('#asset-upload').setInputFiles({ name: 'demo-logo.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(__dirname, '../../images/favicon-32.png')) });
    await admin.locator('#asset-dialog').waitFor({ state: 'hidden' });
    const previewEvent = context.waitForEvent('page'); await admin.locator('#preview').click();
    const preview = await previewEvent; await preview.waitForLoadState();
    assert.equal(await preview.locator('h1').innerText(), 'Збережено у Windows'); await preview.close();
    await admin.locator('#publish').click();
    await admin.waitForFunction(() => document.getElementById('status').textContent.startsWith('Опубліковано.'), {}, { timeout: 180000 });
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
    await admin.locator('#publish').click(); await admin.waitForFunction(() => document.getElementById('status').textContent.startsWith('Опубліковано.'), {}, { timeout: 180000 });
    await visitor.reload(); assert.equal(await visitor.locator('.site-header nav a[href="/windows-test/"]').count(), 1);
    const stale = (await api('tree')).data.head;
    assert.equal((await api('save', { head: stale, changes: [{ path: 'images/editor/bad.png', encoding: 'base64', content: Buffer.from('<?php echo 1;').toString('base64') }] })).status, 400);
    await admin.locator('[data-path="windows-test.html"]').click(); await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-test/');
    await admin.locator('#php-rename-button').click(); await admin.locator('#php-new-address').fill('windows-renamed');
    await admin.getByRole('button', { name: 'Перейменувати', exact: true }).click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    assert.equal((await api('publish', { head: stale })).status, 409);
    await admin.locator('#publish').click(); await admin.waitForFunction(() => document.getElementById('status').textContent.startsWith('Опубліковано.'), {}, { timeout: 180000 });
    await visitor.goto(running.origin + '/windows-test.html'); await visitor.waitForURL(running.origin + '/windows-renamed/');
    await admin.locator('[data-path="windows-renamed.html"]').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/windows-renamed/');
    admin.once('dialog', dialog => dialog.accept()); await admin.locator('#php-delete-button').click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('#publish').click(); await admin.waitForFunction(() => document.getElementById('status').textContent.startsWith('Опубліковано.'), {}, { timeout: 180000 });
    assert.equal((await request(running, '', undefined, { rawPath: '/windows-renamed/' })).status, 404);
    await visitor.goto(running.origin + '/'); assert.equal(await visitor.locator('a[href="/windows-renamed/"]').count(), 0);
    await admin.locator('#php-versions-button').click(); admin.once('dialog', dialog => dialog.accept());
    await admin.locator('dialog[open]').getByRole('button', { name: 'Відновити', exact: true }).first().click();
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/');
    await admin.locator('[data-path="windows-renamed.html"]').waitFor();
    await admin.locator('#publish').click(); await admin.waitForFunction(() => document.getElementById('status').textContent.startsWith('Опубліковано.'), {}, { timeout: 180000 });
    await visitor.goto(running.origin + '/windows-test.html'); await visitor.waitForURL(running.origin + '/windows-renamed/');
    assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows');
    await visitor.evaluate(async () => { await navigator.serviceWorker.ready; });
    assert.ok(await visitor.evaluate(async () => (await caches.keys()).some(k => k.startsWith('tcg-'))));
    const network = await context.newPage(); await assert.rejects(network.goto('https://example.com/'), /ERR_PROXY_CONNECTION_FAILED/); await network.close();
    const certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-untrusted-'));
    const openssl = path.join(process.env.ProgramFiles, 'Git/usr/bin/openssl.exe');
    execFileSync(openssl, ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'), '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    const untrusted = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (_, res) => res.end('unexpected trust'));
    await new Promise(resolve => untrusted.listen(0, '127.0.0.1', resolve));
    const certificateProbe = await context.newPage();
    try { await assert.rejects(certificateProbe.goto('https://127.0.0.1:' + untrusted.address().port), /ERR_CERT_AUTHORITY_INVALID/, 'the demo browser must reject other self-signed certificates'); }
    finally { await certificateProbe.close(); untrusted.closeAllConnections(); await new Promise(resolve => untrusted.close(resolve)); fs.rmSync(certDir, { recursive: true, force: true }); }
    const listeners = JSON.parse(ps(`Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -in @(${running.vmPid},${running.browserPid}) } | Select-Object LocalAddress,LocalPort | ConvertTo-Json -Compress`));
    assert.ok([].concat(listeners).length >= 2);
    assert.ok([].concat(listeners).every(x => x.LocalAddress === '127.0.0.1'), 'all test listeners are loopback-only');
    // Closing the original admin must close preview windows and all VM processes.
    const originalOrigin = running.origin; await close();
    ({ context, running } = await launch()); assert.equal(running.origin, originalOrigin);
    assert.equal((await request(running, 'session')).data.setupRequired, false);
    if (await admin.locator('#php-login-form').isVisible()) {
        await admin.locator('#php-username').fill(credentials.username); await admin.locator('#php-password').fill(credentials.password); await admin.locator('#php-login-form button').click();
    }
    await admin.waitForFunction(() => document.getElementById('current-path').textContent === '/', {}, { timeout: 180000 });
    await admin.locator('[data-path="windows-renamed.html"]').waitFor();
    visitor = await context.newPage(); await visitor.goto(running.origin + '/windows-renamed/'); assert.equal(await visitor.locator('h1').innerText(), 'Збережено у Windows');
    await close();
    const reset = spawn('cmd.exe', ['/d', '/c', 'RESET-DEMO.cmd'], { cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    reset.stdout.resume(); reset.stderr.resume(); reset.stdin.end('RESET\r\n\r\n');
    await new Promise((resolve, reject) => { reset.on('error', reject); reset.on('exit', code => code === 0 ? resolve() : reject(new Error('RESET failed'))); });
    assert.equal(fs.existsSync(path.join(root, 'demo-data')), false);
    ({ running } = await launch()); assert.equal((await request(running, 'session')).data.setupRequired, true); await close();
    assert.equal(trust(), originalTrust, 'the Windows certificate store is unchanged');
    assert.deepEqual(errors, []);
});
