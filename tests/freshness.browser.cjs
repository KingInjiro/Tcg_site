const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const playwright = require('playwright');
const { build } = require('../scripts/build');
const { pageFiles, pageURL } = require('../lib/site-routes');

(async () => {
    const output = build(), engine = process.env.TCG_TEST_BROWSER || 'chromium';
    const base = JSON.parse(fs.readFileSync(path.join(output, 'site-version.json'))).version;
    const read = file => fs.readFileSync(path.join(output, file), 'utf8');
    const fixture = file => fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');
    let revision = 'one', worker = 'retired', helper = 'online', unavailable = false, partial = false, removed = false, staleNavigation = false;
    let workerRequests = 0, navigationRequests = 0, blockWorkerUpdates = false;
    // Real published URL/alias list and worker/helper from pre-retirement ead5a5e.
    const previousConfig = JSON.parse(fixture('pwa-release-config.json'));
    const config = version => ({ ...previousConfig, version });
    const app = express();
    app.get('/site-version.json', (_req, res) => unavailable ? res.status(503).end() : res.set('Cache-Control', 'no-store').json({ version: revision }));
    app.get('/sw.js', (_req, res) => {
        workerRequests++;
        if (blockWorkerUpdates) return res.status(503).end();
        const source = worker === 'retired' ? read('sw.js') : fixture(worker === 'previous' ? 'pwa-release-sw.txt' : 'legacy-sw.txt')
            .replace('/* TCG_BUILD_CONFIG */', 'self.TCG_PWA = ' + JSON.stringify(config(revision)) + ';');
        res.type('js').set('Cache-Control', 'no-store').send(source);
    });
    app.get('/themes/offline.html', (_req, res) => res.type('html').send(fixture('pwa-release-offline.txt')));
    app.get('/manifest.json', (_req, res) => res.type('json').send(fixture('pwa-release-manifest.txt')));
    app.get('/foreign/sw.js', (_req, res) => res.type('js').send("self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"));
    app.get('/themes/service-worker.js', (_req, res) => res.type('js').set('Cache-Control', 'no-cache').send(
        helper === 'online' ? read('themes/service-worker.js') : fixture(helper === 'previous' ? 'pwa-release-helper.txt' : 'legacy-helper.txt')));
    app.get('/themes/navigation.js', (_req, res) => res.type('js').set('Cache-Control', 'public, max-age=3600').send(read('themes/navigation.js') + '\nwindow.freshnessScript = ' + JSON.stringify(revision) + ';'));
    app.get('/themes/navigation.css', (_req, res) => res.type('css').set('Cache-Control', 'public, max-age=3600').send(
        read('themes/navigation.css') + '\n:root { --freshness: ' + revision + '; }'));
    app.get(/\/$/, (req, res, next) => {
        const file = path.join(output, req.path, 'index.html');
        if (!fs.existsSync(file)) return next();
        navigationRequests++;
        if (unavailable) return res.status(503).send('Temporarily unavailable');
        if (removed && req.path === '/contacts/') return res.status(404).type('html').send('<h1>Removed</h1>');
        let content = fs.readFileSync(file, 'utf8').replaceAll(base, partial || staleNavigation && req.query['tcg-online'] && !req.query['tcg-probe'] ? 'incomplete' : revision);
        if (helper === 'legacy') content = content.replace(/<meta name="tcg-build"[^>]+>/, '');
        res.set('Cache-Control', 'no-cache').type('html').send(content);
    });
    app.use(express.static(output));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    const marker = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--freshness').trim());
    const updated = (page, value) => page.waitForFunction(value =>
        document.querySelector('meta[name="tcg-build"]')?.content === value &&
        getComputedStyle(document.documentElement).getPropertyValue('--freshness').trim() === value, value, { timeout: 25000 });
    const signal = page => page.evaluate(() => window.dispatchEvent(new Event('online')));
    const noTCG = async page => {
        await page.waitForFunction(async () => !(await navigator.serviceWorker.getRegistrations()).some(r => r.scope === location.origin + '/') &&
            !(await caches.keys()).some(key => key.startsWith('tgroup-pwa-')));
        assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
    };
    try {
        browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? {
            executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'],
        } : {}) });
        const context = await browser.newContext();
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        await page.goto(origin + '/contacts/'); await page.waitForLoadState('networkidle');
        assert.equal(await marker(page), 'one');
        revision = 'two';
        await page.locator('.site-header a[href="/toc/"]').first().click();
        await updated(page, 'two');
        assert.equal(new URL(page.url()).pathname, '/toc/');
        assert.equal(await page.evaluate(() => window.freshnessScript), 'two', 'new JS is fetched with the new version');
        const form = await context.newPage(); await form.goto(origin + '/feedback/');
        await form.locator('[name="Name"]').fill('Автоматичне оновлення не стирає це');
        revision = 'three';
        await updated(page, 'three'); // Real 15-second polling, no worker and no synthetic notification.
        await form.waitForFunction(() => window.TCGUpdateReady, {}, { timeout: 20000 });
        assert.equal(await form.locator('[name="Name"]').inputValue(), 'Автоматичне оновлення не стирає це');
        assert.equal(await marker(form), 'two');
        await form.evaluate(() => document.querySelector('[data-contact-form]').reset()); await updated(form, 'three');
        await noTCG(page); assert.equal(await page.evaluate(() => navigator.serviceWorker.controller), null);
        assert.equal(workerRequests, 0, 'fresh visits never register or download a worker');
        // Server outage and partial publication leave the current document intact.
        await page.evaluate(() => { window.safeDocument = true; });
        unavailable = true; revision = 'four'; await signal(page); await page.waitForTimeout(1000);
        assert.equal(await page.evaluate(() => window.safeDocument), true);
        unavailable = false; partial = true; await signal(page); await page.waitForTimeout(1000);
        assert.equal(await page.evaluate(() => window.safeDocument), true, 'partial HTML is not applied');
        partial = false; await signal(page); await updated(page, 'four');
        // No fresh helper can loop even when session storage is unavailable.
        await page.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage disabled'); } }));
        const before = navigationRequests; await page.reload(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
        assert.ok(navigationRequests - before <= 1, 'no automatic reload loop');
        // A server can change between probe and navigation. Even without storage,
        // an inconsistent navigation response must not trigger an endless reload.
        revision = 'loop-guard'; staleNavigation = true; await signal(page);
        await page.waitForFunction(() => new URL(location.href).searchParams.get('tcg-online') === 'loop-guard' && document.querySelector('meta[name="tcg-build"]')?.content === 'incomplete');
        await page.waitForLoadState('networkidle');
        const guarded = navigationRequests;
        for (let i = 0; i < 3; i++) { await signal(page); await page.waitForTimeout(150); }
        assert.equal(navigationRequests, guarded, 'the URL guard prevents retries when sessionStorage is disabled');
        staleNavigation = false; await page.reload(); await updated(page, revision);
        removed = true; assert.equal((await page.goto(origin + '/contacts/')).status(), 404); removed = false;
        // Offline requests must fail, rather than silently serving TCG snapshots.
        const probe = await context.newPage(); await probe.goto(origin + '/contacts/'); await noTCG(probe);
        await context.setOffline(true);
        assert.equal(await probe.evaluate(async () => { try { await fetch('/products/?uncached=' + Date.now(), { cache: 'no-store' }); return true; } catch { return false; } }), false);
        await context.setOffline(false); await probe.close();
        console.log('PASS ' + engine + ': online polling, fresh CSS/JS URLs, SPA publication, dirty-form/reset, outage, partial upload, 404, no reload loop or offline snapshot');
        await context.close();
        const restricted = await browser.newContext();
        await restricted.route('https://**/*', route => route.abort());
        await restricted.addInitScript(() => {
            Object.defineProperty(navigator.serviceWorker, 'getRegistrations', { value: () => Promise.reject(new DOMException('Browser policy', 'SecurityError')) });
        });
        const restrictedPage = await restricted.newPage();
        await restrictedPage.goto(origin + '/contacts/'); await restrictedPage.waitForLoadState('networkidle');
        assert.equal(await restrictedPage.evaluate(async () => { try { await navigator.serviceWorker.getRegistrations(); return 'allowed'; } catch (error) { return error.name; } }), 'SecurityError');
        revision = 'restricted-policy'; await signal(restrictedPage); await updated(restrictedPage, revision);
        assert.equal(await restrictedPage.evaluate(() => navigator.serviceWorker.controller), null);
        await restricted.close();
        console.log('PASS ' + engine + ': online publication also works when browser policy rejects Service Worker API');
        if (engine !== 'chromium') return;

        for (const generation of ['previous', 'legacy']) {
            revision = 'old-' + generation; worker = helper = generation;
            const migration = await browser.newContext(); await migration.route('https://**/*', route => route.abort());
            const old = await migration.newPage(); await old.goto(origin + '/contacts/');
            await old.waitForFunction(() => !!navigator.serviceWorker.controller);
            if (generation === 'previous') await old.evaluate(() => new Promise((resolve, reject) => {
                const channel = new MessageChannel(), timer = setTimeout(() => reject(new Error('Old release warmup timeout')), 30000);
                channel.port1.onmessage = () => { clearTimeout(timer); resolve(); };
                navigator.serviceWorker.controller.postMessage({ type: 'TCG_WARM_CACHE' }, [channel.port2]);
            }));
            assert.ok(await old.evaluate(async () => (await caches.keys()).some(key => key.startsWith('tgroup-pwa-'))));
            const dirty = await migration.newPage(); await dirty.goto(origin + '/feedback/');
            await dirty.locator('[name="Name"]').fill('Стара відкрита форма');
            await dirty.evaluate(() => { window.originalForm = true; });
            await old.evaluate(async () => {
                await (await caches.open('foreign-application')).put('/foreign-value', new Response('keep'));
                const r = await navigator.serviceWorker.register('/foreign/sw.js', { scope: '/foreign/' });
                if (!r.active) await new Promise(resolve => { const timer = setInterval(() => { if (r.active) { clearInterval(timer); resolve(); } }, 30); });
            });
            worker = 'retired'; helper = 'online'; revision = 'new-' + generation;
            await old.evaluate(async () => (await navigator.serviceWorker.getRegistration('/')).update());
            await old.waitForFunction(async () => !(await navigator.serviceWorker.getRegistration('/')));
            assert.equal(await dirty.locator('[name="Name"]').inputValue(), 'Стара відкрита форма');
            assert.equal(await dirty.evaluate(() => window.originalForm), true, 'retirement never navigates an unsaved form');
            if (generation === 'legacy') {
                // This earliest helper has no version poll. Ordinary user navigation
                // leaves its old controlled document; retirement must not force it.
                await old.locator('.site-header a[href="/toc/"]').first().click();
            }
            await updated(old, 'new-' + generation); await noTCG(old);
            await old.waitForFunction(() => navigator.serviceWorker.controller === null);
            assert.equal(await old.evaluate(() => navigator.serviceWorker.controller), null);
            await old.waitForFunction(() => !new URL(location.href).searchParams.has('tcg-online'));
            assert.equal(await old.evaluate(async () => await (await caches.open('foreign-application')).match('/foreign-value').then(r => r.text())), 'keep');
            assert.ok(await old.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration('/foreign/'))));
            await dirty.reload(); await updated(dirty, revision); await noTCG(dirty);
            console.log('PASS migration from exact ' + generation + ' worker/helper: TCG-only cleanup, no worker on new documents, preserved form and foreign cache/registration');
            await migration.close();
        }
        // The client cleanup works without a replacement worker ever installing.
        revision = 'old-direct'; worker = helper = 'previous';
        const directContext = await browser.newContext(), direct = await directContext.newPage();
        await directContext.route('https://**/*', route => route.abort());
        await direct.goto(origin + '/contacts/'); await direct.waitForFunction(() => !!navigator.serviceWorker.controller);
        await direct.waitForLoadState('networkidle');
        await direct.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Storage disabled'); } }));
        revision = 'new-direct'; helper = 'online'; blockWorkerUpdates = true;
        await direct.locator('.site-header a[href="/feedback/"]').first().click();
        await direct.waitForURL(url => url.pathname === '/feedback/');
        await updated(direct, revision); await noTCG(direct);
        await direct.waitForFunction(() => navigator.serviceWorker.controller === null);
        assert.equal(await direct.evaluate(() => navigator.serviceWorker.controller), null);
        assert.equal(new URL(direct.url()).search, '', 'temporary retirement URL is cleaned after detachment');
        // Any automatic browser update check receives 503. Cleanup succeeds
        // despite no replacement script being available to install or activate.
        assert.equal(blockWorkerUpdates, true);
        await directContext.close();
        console.log('PASS direct cleanup and coherent online document without installing/activating the retirement worker');
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
