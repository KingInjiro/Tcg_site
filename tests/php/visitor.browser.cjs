const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fixture } = require('./fixture.cjs');
const { pageFiles, pageURL } = require('../../lib/site-routes');
const path = require('node:path');
const snapshot = page => page.evaluate(() => {
    const round = value => Math.round(value * 100) / 100;
    const rect = node => { const r = node.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(round); };
    return [...document.querySelectorAll('body *')].filter(node => !node.matches('script,style,meta,link') && node.checkVisibility()).map(node => {
        const style = getComputedStyle(node);
        return [node.tagName, node.children.length ? '' : node.textContent, rect(node), style.font, style.color, style.backgroundColor, style.borderRadius,
            node.tagName === 'IMG' ? [node.getAttribute('src'), node.naturalWidth, node.naturalHeight] : null];
    });
});
test('PHP public site: all 51 page layouts, GIF hover, SPA, no offline caching and fresh publication', { timeout: 180000 }, async t => {
    const f = await fixture(t), owner = f.client(); await owner.session();
    const credentials = { activationKey: f.activationKey, username: 'site-owner', password: 'Visitor browser secure password 42' };
    assert.equal((await owner.call('setup', credentials)).status, 200); assert.equal((await owner.call('login', credentials)).status, 200);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors-spki-list=' + f.spki] });
    t.after(() => browser.close());
    const pages = pageFiles(path.resolve(__dirname, '../..')), reference = new Map();
    const staticContext = await browser.newContext({ serviceWorkers: 'block' }), view = await staticContext.newPage();
    await view.route('**/*', route => route.request().resourceType() === 'script' || new URL(route.request().url()).origin !== f.origin ? route.abort() : route.continue());
    async function capture(compare) {
        for (const width of [1440, 390]) {
            await view.setViewportSize({ width, height: 1000 });
            for (const file of pages) {
                await view.goto(f.origin + pageURL(file), { waitUntil: 'load' });
                await view.evaluate(() => document.fonts.ready);
                const key = width + ':' + file, rendered = await snapshot(view);
                if (compare) assert.deepEqual(rendered, reference.get(key), key + ': no visible changes from PHP compilation');
                else reference.set(key, rendered);
            }
        }
    }
    await capture(false);
    let head = (await owner.call('tree')).data.head;
    const published = await owner.call('publish', { head }); assert.equal(published.status, 200, published.data.error);
    await capture(true); await staticContext.close();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => new URL(route.request().url()).origin === f.origin || /^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort());
    await page.goto(f.origin + '/');
    const upper = page.locator('.site-header nav a:has(img)').first();
    await upper.hover();
    assert.notEqual(await upper.evaluate(node => getComputedStyle(node).boxShadow), 'none', 'original upper hover glow remains');
    const left = page.locator('img[src*="_VBTN.GIF"],img[src*="_HBTN.GIF"]').first();
    if (await left.count()) { const src = await left.getAttribute('src'); await left.hover(); assert.ok((await left.evaluate(node => getComputedStyle(node).content)).includes(src.replace(/\.GIF$/i, '_A.GIF')), 'legacy rollover artwork remains'); }
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('link[rel="manifest"]').count(), 0);
    assert.deepEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope)), []);
    assert.deepEqual(await page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('tgroup-pwa-'))), []);
    await page.evaluate(() => { window.phpSPAMarker = 'kept'; });
    await page.locator('.site-header a[href="/contacts/"]').first().click(); await page.waitForURL(f.origin + '/contacts/');
    assert.equal(await page.evaluate(() => window.phpSPAMarker), 'kept', 'SPA does not reload the document');
    const home = (await owner.call('read&path=index.html')).data.content;
    const saved = await owner.call('save', { head, changes: [{ path: 'index.html', content: home.replace('</body>', '<!-- browser freshness test --></body>'), encoding: 'utf-8' }] }); head = saved.data.head;
    const updated = await owner.call('publish', { head }); assert.equal(updated.status, 200, updated.data.error);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(version => document.querySelector('meta[name="tcg-build"]')?.content === version, updated.data.version, { timeout: 20000 });
    await page.goto(f.origin + '/feedback/');
    await page.locator('[name="Name"]').fill('Form visitor'); await page.locator('[name="Email"]').fill('visitor@example.test');
    const submit = page.locator('[data-contact-form] [type="submit"]'); await submit.click();
    await page.locator('[data-contact-form] [role="status"]').filter({ hasText: 'недоступна' }).waitFor();
    assert.equal(await page.locator('[name="Name"]').inputValue(), 'Form visitor', 'unconfigured SMTP never clears data or reports success');
    assert.deepEqual(errors, []);
});
