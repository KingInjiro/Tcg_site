const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const playwright = require('playwright');
const { build } = require('../scripts/build');

(async () => {
    const output = build(), engine = process.env.TCG_TEST_BROWSER || 'chromium';
    const base = JSON.parse(fs.readFileSync(path.join(output, 'site-version.json'))).version;
    const originalWorker = fs.readFileSync(path.join(output, 'sw.js'), 'utf8');
    const originalConfig = JSON.parse(originalWorker.match(/^self\.TCG_PWA = (.+);$/m)[1]);
    let revision = 'one', legacy = false, slow = false, removed = false;
    const html = route => fs.readFileSync(path.join(output, route, 'index.html'), 'utf8');
    const app = express();
    app.get('/site-version.json', (_req, res) => res.set('Cache-Control', 'no-store').json({ version: revision }));
    app.get('/sw.js', (_req, res) => {
        const source = legacy ? fs.readFileSync(path.join(__dirname, 'fixtures/legacy-sw.txt'), 'utf8')
            .replace('/* TCG_BUILD_CONFIG */', 'self.TCG_PWA = ' + JSON.stringify({ ...originalConfig, version: 'legacy' }) + ';')
            : originalWorker.replace(base, revision);
        res.type('js').set('Cache-Control', 'no-cache').send(source);
    });
    app.get('/themes/service-worker.js', (_req, res) => res.type('js').set('Cache-Control', 'no-cache').send(fs.readFileSync(
        legacy ? path.join(__dirname, 'fixtures/legacy-helper.txt') : path.join(output, 'themes/service-worker.js'), 'utf8')));
    app.get('/themes/navigation.css', (_req, res) => res.type('css').set('Cache-Control', 'public, max-age=3600').send(
        fs.readFileSync(path.join(output, 'themes/navigation.css'), 'utf8') + '\n:root { --freshness: ' + revision + '; }'));
    app.get('/images/app-icon.svg', (_req, _res, next) => slow ? setTimeout(next, 10000) : next());
    app.get(/\/$/, (req, res, next) => {
        if (removed && req.path === '/contacts/') return res.status(404).type('html').send('<h1>Removed</h1>');
        if (!fs.existsSync(path.join(output, req.path, 'index.html'))) return next();
        let content = html(req.path);
        content = legacy ? content.replace(/<meta name="tcg-build"[^>]+>/, '') : content.replaceAll(base, revision);
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
    try {
        browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? {
            executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'],
        } : {}) });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('https://**/*', route => route.abort());
        const page = await context.newPage();
        await page.goto(origin + '/contacts/');
        assert.equal(await marker(page), 'one');
        // Initial helper and pageshow version checks must finish before the fixture
        // changes the server build; otherwise a correct automatic reload can remove
        // the synthetic link between evaluate() and click(), especially in Firefox.
        await page.waitForLoadState('networkidle');
        revision = 'two';
        await page.evaluate(() => { const link = document.createElement('a'); link.href = '/products/'; link.dataset.tcgPage = ''; link.id = 'next-test'; link.textContent = 'Next'; document.body.prepend(link); });
        await page.locator('#next-test').click();
        await updated(page, 'two');
        assert.equal(new URL(page.url()).pathname, '/products/', 'fresh HTML from SPA causes one coherent new document load');
        const form = await context.newPage();
        await form.goto(origin + '/feedback/');
        await form.locator('[name="Name"]').fill('Автоматичне оновлення не стирає це');
        revision = 'three';
        await updated(page, 'three'); // Real 15-second polling, no synthetic click/update event.
        await form.waitForFunction(() => window.TCGUpdateReady, {}, { timeout: 20000 });
        assert.equal(await form.locator('[name="Name"]').inputValue(), 'Автоматичне оновлення не стирає це');
        assert.equal(await marker(form), 'two', 'dirty form keeps its document');
        await form.evaluate(() => document.querySelector('[data-contact-form]').reset());
        await updated(form, 'three');
        console.log('PASS ' + engine + ': new-build SPA navigation, idle-tab polling without a worker, same-URL CSS, dirty-form deferral and reset');
        await context.close();
        if (engine !== 'chromium') return;

        legacy = true;
        const migration = await browser.newContext();
        await migration.route('https://**/*', route => route.abort());
        const old = await migration.newPage();
        await old.goto(origin + '/contacts/');
        await old.waitForFunction(() => !!navigator.serviceWorker.controller);
        const dirty = await migration.newPage();
        await dirty.goto(origin + '/feedback/');
        await dirty.locator('[name="Name"]').fill('Стара відкрита форма');
        await old.evaluate(() => { window.legacyDocument = true; });
        await dirty.evaluate(() => { window.legacyDocument = true; });
        legacy = false; revision = 'four'; slow = true;
        const started = Date.now();
        await old.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
        await updated(old, 'four');
        assert.ok(Date.now() - started < 8000, 'slow nonessential offline download cannot gate activation');
        assert.equal(await old.evaluate(() => window.legacyDocument), undefined, 'old cached helper migrates without clicking or clearing data');
        assert.equal(await dirty.locator('[name="Name"]').inputValue(), 'Стара відкрита форма');
        assert.equal(await dirty.evaluate(() => window.legacyDocument), true);
        // Freshness must not depend on a new worker installation on every visit.
        revision = 'five';
        await old.reload(); await updated(old, 'five');
        removed = true;
        const missing = await old.reload();
        assert.equal(missing.status(), 404, 'online 404 is not replaced by cached content');
        removed = false;
        await old.goto(origin + '/contacts/'); await updated(old, 'five');
        await migration.setOffline(true);
        await old.reload();
        assert.equal(await marker(old), 'five', 'last online page and same-URL CSS remain available offline');
        await migration.setOffline(false);
        revision = 'six';
        await old.evaluate(() => window.dispatchEvent(new Event('online')));
        await updated(old, 'six');
        assert.equal(await dirty.locator('[name="Name"]').inputValue(), 'Стара відкрита форма');
        console.log('PASS PWA migration: exact old worker/helper, no-click refresh, legacy form safety, slow offline asset, network-first reload, 404, offline and reconnection');
        await migration.close();
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
