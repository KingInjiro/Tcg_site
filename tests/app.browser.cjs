const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const playwright = require('playwright');
const { build } = require('../scripts/build');
const { pageFiles, pageURL } = require('../lib/site-routes');

(async () => {
    const output = build(), engine = process.env.TCG_TEST_BROWSER || 'chromium';
    const app = express();
    let publicationChanged = false, brokenPage = false, slowImages = false;
    const requests = [], delayedResources = new Set();
    app.use((req, res, next) => {
        requests.push(req.path);
        if (delayedResources.has(req.path) || (slowImages && /\.(?:gif|png|jpe?g|svg)$/i.test(req.path))) {
            res.set('Cache-Control', 'no-cache');
            setTimeout(next, 250);
        } else next();
    });
    app.get('/sw.js', (_req, res) => res.type('js').set('Cache-Control', 'no-cache').send(
        fs.readFileSync(path.join(output, 'sw.js'), 'utf8').replace(/("version":")([^"]+)/, (_all, start, version) => start + version + (publicationChanged ? '-update' : ''))));
    app.get('/contacts/', (req, res, next) => brokenPage && req.get('X-TCG-Navigation') ? res.status(503).send('temporary failure') : next());
    // Make transient stylesheet reloads visible instead of hiding them in the cache.
    app.get(/\.css$/, (_req, res, next) => {
        res.set('Cache-Control', 'no-cache');
        setTimeout(next, 80);
    });
    app.get('/themes/navigation.css', (_req, res) => res.type('css').send(
        fs.readFileSync(path.join(output, 'themes/navigation.css'), 'utf8') + '\n:root { --tcg-test-build: ' + (publicationChanged ? 'after' : 'before') + '; }'));
    const originalVersion = JSON.parse(fs.readFileSync(path.join(output, 'site-version.json'))).version;
    app.get('/site-version.json', (_req, res) => res.set('Cache-Control', 'no-store').json({ version: originalVersion + (publicationChanged ? '-update' : '') }));
    app.get(/\/$/, (req, res, next) => {
        const file = path.join(output, req.path, 'index.html');
        if (!fs.existsSync(file)) return next();
        res.type('html').set('Cache-Control', 'no-cache').send(fs.readFileSync(file, 'utf8').replaceAll(originalVersion, originalVersion + (publicationChanged ? '-update' : '')));
    });
    app.use(express.static(output));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? {
            executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'],
        } : {}) });
        const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 900 } });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/');
        await page.evaluate(() => {
            window.documentMarker = 'same-document';
            window.styleGaps = [];
            function sampleStyles() {
                const missing = [...document.querySelectorAll('link[rel="stylesheet"]')]
                    .filter(link => !link.disabled && matchMedia(link.media || 'all').matches && !link.sheet)
                    .map(link => new URL(link.href).pathname);
                if (missing.length && window.styleGaps.length < 10) {
                    window.styleGaps.push({ path: location.pathname, font: getComputedStyle(document.body).fontFamily, missing });
                }
                requestAnimationFrame(sampleStyles);
            }
            requestAnimationFrame(sampleStyles);
        });
        const clickRoute = async (url, target = page) => {
            await target.evaluate(url => {
                const link = document.createElement('a'); link.href = url; link.dataset.tcgPage = ''; link.id = 'test-navigation'; link.textContent = 'Test navigation'; link.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647'; document.body.prepend(link);
            }, url);
            await target.locator('#test-navigation').click();
            await target.waitForURL(origin + url);
            await target.waitForFunction(() => !document.documentElement.hasAttribute('aria-busy') && !document.getElementById('test-navigation'));
        };
        // Real menu click, URL/title/focus update, original GIF styling, and no document reload.
        await page.evaluate(() => {
            document.addEventListener('click', () => {
                window.clickFeedback = {
                    busy: document.documentElement.getAttribute('aria-busy'),
                    cursor: getComputedStyle(document.documentElement).cursor,
                    indicator: getComputedStyle(document.documentElement, '::before').height,
                };
            }, { once: true });
            document.addEventListener('tcg:page-load', () => {
                window.unfinishedImages = [...document.images].filter(img => !img.complete || !img.naturalWidth)
                    .map(img => img.getAttribute('src').slice(0, 100));
            }, { once: true });
        });
        const firstClickRequest = requests.length;
        slowImages = true;
        await page.locator('a[data-tcg-page][href="/contacts/"]').first().click();
        await page.waitForURL(origin + '/contacts/');
        await page.waitForFunction(() => document.activeElement?.id === 'main-content');
        slowImages = false;
        assert.deepEqual(requests.slice(firstClickRequest).filter(url => url.endsWith('.css')), [], 'shared CSS does not reload on navigation');
        assert.deepEqual(await page.evaluate(() => window.clickFeedback), { busy: 'true', cursor: 'progress', indicator: '2px' }, 'click is acknowledged synchronously');
        assert.deepEqual(await page.evaluate(() => window.unfinishedImages), [], 'contact page/menu images are ready at the commit, even with delayed image requests');
        console.log('PASS ' + engine + ': no repeated shared CSS requests, immediate click feedback, delayed images ready before page commit');
        assert.equal(await page.evaluate(() => window.documentMarker), 'same-document');
        assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), '/contacts/');
        const originalTitle = await page.title();
        await clickRoute('/ListPage/Pege03/');
        await page.evaluate(() => scrollTo(0, 1000));
        await page.waitForFunction(() => history.state.tcgScroll[1] >= 900);
        await clickRoute('/contacts/');
        await page.goBack(); await page.waitForURL(origin + '/ListPage/Pege03/');
        await page.waitForFunction(() => scrollY >= 900);
        await page.goForward(); await page.waitForURL(origin + '/contacts/');
        await page.waitForFunction(title => document.title === title, originalTitle);
        assert.equal(await page.evaluate(() => window.documentMarker), 'same-document');

        const direct = await context.newPage();
        const routes = engine === 'chromium' ? pageFiles(path.resolve(__dirname, '..')).map(pageURL) : ['/search/', '/feedback/', '/ListPage/Pege05/', '/'];
        for (const route of routes) {
            if (new URL(page.url()).pathname !== route) await clickRoute(route);
            await direct.goto(origin + route);
            const snapshot = target => target.evaluate(async () => {
                await Promise.all([...document.images].filter(img => img.src.startsWith(location.origin)).map(img => img.decode().catch(() => {})));
                const headings = [...document.querySelectorAll('h1,h2,h3')].map(node => {
                    const style = getComputedStyle(node), r = node.getBoundingClientRect();
                    return { text: node.textContent, font: style.font, color: style.color, width: Math.round(r.width) };
                });
                return { title: document.title, headings, manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
                    broken: [...document.images].filter(img => img.src.startsWith(location.origin) && !img.naturalWidth).map(img => img.src) };
            });
            assert.deepEqual(await snapshot(page), await snapshot(direct), route + ': SPA and direct loading have the same styles, headings and images');
            assert.equal(await page.evaluate(() => window.documentMarker), 'same-document', route);
        }
        await direct.close();
        assert.deepEqual(await page.evaluate(() => window.styleGaps), [], 'no visible frame loses an active stylesheet during slow, uncached SPA transitions');
        console.log('PASS ' + engine + ': SPA navigation on ' + routes.length + ' routes, original styles/images, title/canonical/focus, back/forward and scroll restoration');
        console.log('PASS ' + engine + ': frame-by-frame stylesheet continuity with delayed, uncached CSS');
        await clickRoute('/search/');
        await page.locator('#site-search').fill('резервное копирование');
        await page.locator('#site-search').press('Enter');
        await page.locator('#search-results a[href="/ListPage/Pege05/"]').click();
        await page.waitForURL(origin + '/ListPage/Pege05/');
        await page.locator('#backup-calculator [name="size"]').fill('100');
        await page.waitForFunction(() => document.querySelector('#backup-result').textContent.includes('ГБ'));
        await page.goBack(); await page.waitForURL(/\/search\/\?search=/);
        await page.waitForSelector('#search-results li');
        await clickRoute('/feedback/');
        await page.locator('[name="Name"]').fill('Збережені дані');
        await page.locator('[name="Email"]').fill('test@example.com');
        await page.locator('[data-contact-form] [type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-contact-form] [role="status"]').textContent.includes('Не удалось подтвердить'));
        assert.equal(await page.locator('[name="Name"]').inputValue(), 'Збережені дані');
        await clickRoute('/search/'); await clickRoute('/feedback/');
        assert.equal(await page.locator('[name="Name"]').inputValue(), '');
        assert.deepEqual(errors, []);
        brokenPage = true;
        await page.locator('a[data-tcg-page][href="/contacts/"]').first().click();
        await page.waitForURL(origin + '/contacts/');
        await page.waitForFunction(() => !window.documentMarker);
        assert.equal(await page.title(), originalTitle);
        brokenPage = false;
        console.log('PASS ' + engine + ': search/calculator/form reinitialization, no duplicate handlers, and full-page fallback after SPA request failure');
        await context.close();

        const onlineContext = await browser.newContext();
        await onlineContext.route('https://**/*', route => route.abort());
        const form = await onlineContext.newPage(), otherTab = await onlineContext.newPage();
        await form.goto(origin + '/feedback/');
        await form.locator('[name="Name"]').fill('Не втрачати при оновленні');
        await otherTab.goto(origin + '/contacts/');
        await otherTab.waitForLoadState('networkidle');
        publicationChanged = true;
        await otherTab.evaluate(() => window.dispatchEvent(new Event('online')));
        await form.evaluate(() => window.dispatchEvent(new Event('online')));
        await otherTab.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim() === 'after');
        await form.waitForFunction(() => window.TCGUpdateReady);
        assert.equal(await form.locator('[name="Name"]').inputValue(), 'Не втрачати при оновленні');
        assert.equal(await form.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim()), 'before');
        await otherTab.evaluate(() => { window.documentMarker = 'spa-after-update'; });
        await clickRoute('/search/', otherTab);
        assert.equal(await otherTab.evaluate(() => window.documentMarker), 'spa-after-update');
        await form.reload();
        assert.equal(await form.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim()), 'after');
        assert.equal(await form.locator('link[rel="manifest"]').count(), 0);
        assert.deepEqual(await form.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(r => r.scope)), []);
        assert.deepEqual(await form.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('tgroup-pwa-'))), []);
        assert.equal(await form.evaluate(() => navigator.serviceWorker.controller), null);
        console.log('PASS ' + engine + ': publication without workers, new CSS, preserved dirty form, resumed SPA, no offline caches');
        await onlineContext.close();

    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
