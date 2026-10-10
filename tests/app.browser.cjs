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
    let workerVersion = false, brokenPage = false, slowImages = false;
    const requests = [], delayedResources = new Set();
    app.use((req, res, next) => {
        requests.push(req.path);
        if (delayedResources.has(req.path) || (slowImages && /\.(?:gif|png|jpe?g|svg)$/i.test(req.path))) {
            res.set('Cache-Control', 'no-store');
            setTimeout(next, 250);
        } else next();
    });
    app.get('/sw.js', (_req, res) => res.type('js').set('Cache-Control', 'no-cache').send(
        fs.readFileSync(path.join(output, 'sw.js'), 'utf8').replace(/("version":")([^"]+)/, (_all, start, version) => start + version + (workerVersion ? '-update' : ''))));
    app.get('/contacts/', (req, res, next) => brokenPage && req.get('X-TCG-Navigation') ? res.status(503).send('temporary failure') : next());
    // Make transient stylesheet reloads visible instead of hiding them in the cache.
    app.get(/\.css$/, (_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        setTimeout(next, 80);
    });
    app.get('/themes/navigation.css', (_req, res) => res.type('css').send(
        fs.readFileSync(path.join(output, 'themes/navigation.css'), 'utf8') + '\n:root { --tcg-test-build: ' + (workerVersion ? 'after' : 'before') + '; }'));
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

        if (engine === 'chromium') {
            const offlineContext = await browser.newContext();
            // Fulfil external APIs predictably; never send real mail or depend on live news.
            await offlineContext.route('https://**/*', route => route.abort());
            let offline = await offlineContext.newPage();
            await offline.goto(origin + '/');
            await offline.waitForFunction(() => !!navigator.serviceWorker.controller, {}, { timeout: 30000 });
            const cdp = await offlineContext.newCDPSession(offline);
            const manifest = await cdp.send('Page.getAppManifest');
            assert.deepEqual(manifest.errors, [], 'manifest parses');
            const install = await cdp.send('Page.getInstallabilityErrors');
            assert.deepEqual(install.installabilityErrors, [], 'Chromium PWA installability requirements');
            const keys = await offline.evaluate(async () => (await (await caches.open((await caches.keys()).find(k => k.startsWith('tgroup-pwa-')))).keys()).map(r => new URL(r.url).pathname));
            for (const file of pageFiles(path.resolve(__dirname, '..'))) assert.ok(keys.includes(pageURL(file)), file + ': precached');
            assert.ok(keys.includes('/themes/navigation.js') && keys.includes('/images/app-icon.svg'));
            assert.ok(!keys.some(key => /^\/(admin|api)(\/|$)/.test(key) || key === '/themes/contact-config.json'));
            // Being online must not make ready PWA pages wait for a slow server.
            keys.forEach(key => delayedResources.add(key));
            const cachedClickRequest = requests.length;
            await offline.evaluate(() => { window.documentMarker = 'cached-spa'; });
            await clickRoute('/contacts/', offline);
            const searchQuery = 'резервное копирование', searchURL = '/search/?search=' + encodeURIComponent(searchQuery);
            await clickRoute(searchURL, offline);
            assert.equal(await offline.locator('#site-search').inputValue(), searchQuery, 'cached HTML retains the requested query');
            await offline.locator('#search-results a[href="/ListPage/Pege05/"]').waitFor();
            await clickRoute('/contacts/', offline);
            await offline.goBack(); await offline.waitForURL(origin + searchURL);
            await offline.locator('#search-results a[href="/ListPage/Pege05/"]').waitFor();
            assert.equal(await offline.evaluate(() => window.documentMarker), 'cached-spa');
            assert.deepEqual(requests.slice(cachedClickRequest).filter(url => delayedResources.has(url)), [], 'cached navigation, modules, search index and images make no server requests');
            delayedResources.clear();
            console.log('PASS PWA: online cached transitions bypass delayed network; search query/results survive navigation and history');
            await offlineContext.setOffline(true);
            await offline.goto(origin + '/contacts/');
            assert.equal(await offline.title(), originalTitle);
            const broken = await offline.locator('img').evaluateAll(async imgs => {
                const local = imgs.filter(img => img.src.startsWith(location.origin));
                await Promise.all(local.map(img => img.decode().catch(() => {})));
                return local.filter(img => !img.naturalWidth).map(img => img.src);
            });
            assert.deepEqual(broken, []);
            await offline.evaluate(() => { window.documentMarker = 'offline-spa'; });
            await clickRoute('/search/', offline);
            await offline.locator('#site-search').fill('резервное копирование'); await offline.locator('#site-search').press('Enter');
            await offline.locator('#search-results a[href="/ListPage/Pege05/"]').click();
            await offline.waitForURL(origin + '/ListPage/Pege05/');
            assert.equal(await offline.evaluate(() => window.documentMarker), 'offline-spa');
            await offline.goto(origin + '/unknown-offline-page/');
            assert.equal(await offline.locator('h1').innerText(), 'Немає з’єднання');
            await offline.goto(origin + '/contacts.html?from=old#phone');
            await offline.waitForURL(origin + '/contacts/?from=old#phone');
            await offlineContext.setOffline(false);
            await offline.goto(origin + '/feedback/');
            await offline.locator('[name="Name"]').fill('Не втрачати при оновленні');
            const otherTab = await offlineContext.newPage();
            await otherTab.goto(origin + '/');
            await offline.evaluate(() => { window.documentMarker = 'form-before-update'; });
            await otherTab.evaluate(() => { window.documentMarker = 'other-tab-before-update'; });
            workerVersion = true;
            await offline.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
            await Promise.all([offline, otherTab].map(tab => tab.waitForFunction(() => window.TCGUpdateReady, {}, { timeout: 30000 })));
            assert.equal(await offline.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), false, 'update activates while both tabs remain open');
            assert.equal(await offline.locator('[name="Name"]').inputValue(), 'Не втрачати при оновленні');
            assert.equal(await offline.evaluate(() => window.documentMarker), 'form-before-update', 'activation never reloads an unfinished form');
            assert.equal(await otherTab.evaluate(() => window.documentMarker), 'other-tab-before-update', 'activation does not interrupt the other tab either');
            assert.equal(await otherTab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim()), 'before');
            await otherTab.locator('a[data-tcg-page][href="/contacts/"]').first().click();
            await otherTab.waitForURL(origin + '/contacts/');
            await otherTab.waitForFunction(() => !window.documentMarker);
            assert.equal(await otherTab.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim()), 'after', 'next menu click loads the new styles and document together');
            await otherTab.evaluate(() => { window.documentMarker = 'spa-after-update'; });
            await clickRoute('/search/', otherTab);
            assert.equal(await otherTab.evaluate(() => window.documentMarker), 'spa-after-update', 'SPA resumes after applying the update');
            assert.equal(await offline.locator('[name="Name"]').inputValue(), 'Не втрачати при оновленні', 'navigation in another tab does not lose the form');
            await offline.reload();
            assert.equal(await offline.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--tcg-test-build').trim()), 'after', 'ordinary reload receives new CSS without closing tabs');
            console.log('PASS PWA: Chromium installability, all pages/assets cached, offline SPA/search/images, offline fallback/legacy URLs, private endpoints excluded');
            console.log('PASS PWA update: activates with two open tabs, preserves unfinished form, new CSS on next click/reload, SPA resumes afterwards');
            await offlineContext.close();
        }
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
