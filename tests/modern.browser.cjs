// Public journeys on a plain static server: no Node route helpers or hosting rewrites.
const { chromium } = require('playwright');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build');
const { sourcePages } = require('../lib/published-site');
const routes = require('../themes/routes');

(async () => {
    const output = build();
    const server = express().use(express.static(output)).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const snapshot = async name => {
            if (!process.env.TCG_SCREENSHOT_DIR) return;
            fs.mkdirSync(process.env.TCG_SCREENSHOT_DIR, { recursive: true });
            await page.screenshot({ path: path.join(process.env.TCG_SCREENSHOT_DIR, name + '.png') });
        };
        for (const [old, clean] of [['/index.html', '/'], ['/contacts.htm', '/contacts/'], ['/ListPage/Pege05.html', '/articles/backup/'], ['/services/index.html', '/services/']]) {
            await page.goto(origin + old + '?from=bookmark#main-content');
            await page.waitForURL(origin + clean + '?from=bookmark#main-content');
            assert.equal(await page.locator('main').count(), 1);
        }
        console.log('PASS static-host legacy redirects retain query and fragment, including index.html');

        await page.goto(origin + '/services/');
        const menu = page.locator('.main-navigation a').first();
        assert.ok(await menu.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 18 && el.getBoundingClientRect().height >= 48));
        await menu.hover();
        assert.match(await menu.evaluate(el => getComputedStyle(el).backgroundImage), /nav_vert_over_spring\.gif/);
        assert.equal(await page.locator('.utility-navigation img').count(), 6);
        for (const image of await page.locator('.utility-navigation img').all()) assert.deepEqual(await image.evaluate(el => [el.naturalWidth, el.naturalHeight, el.width, el.height]), [90, 25, 90, 25]);
        await snapshot('modern-services-desktop');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#site-navigation').waitFor({ state: 'hidden' });
        await page.locator('.menu-toggle').click();
        assert.equal(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'true');
        await page.locator('.main-navigation a[href="/products/"]').click();
        await page.waitForURL(origin + '/products/');
        await snapshot('modern-products-mobile');
        for (const width of [390, 1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            for (const file of sourcePages(path.resolve(__dirname, '..'))) {
                await page.goto(origin + routes.url(file));
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), file + ' overflows at ' + width);
            }
        }
        console.log('PASS all pages fit 390/1024/1440px; larger yellow-hover menu, original top images and mobile navigation');

        await page.goto(origin + '/search/?q=' + encodeURIComponent('резерв'));
        await page.locator('#search-results a[href="/articles/backup/"]').waitFor();
        await page.locator('#site-query').fill('несуществующееслово999');
        await page.locator('.search-form button').click();
        await page.getByText('Ничего не найдено.', { exact: false }).waitFor();
        await page.goBack();
        await page.locator('#search-results a[href="/articles/backup/"]').waitFor();
        await page.locator('#site-query').fill('<img src=x onerror=alert(1)>');
        await page.locator('.search-form button').click();
        assert.equal(await page.locator('#search-results img').count(), 0);
        await page.route('**/search-index.json', route => route.fulfill({ status: 503, body: 'Unavailable' }));
        await page.reload();
        await page.getByText('Не удалось загрузить поиск.', { exact: false }).waitFor();
        await page.unroute('**/search-index.json');
        await page.locator('#site-query').fill('резерв');
        await page.locator('.search-form button').click();
        await page.locator('#search-results a[href="/articles/backup/"]').waitFor();
        await snapshot('modern-search');
        console.log('PASS actual search results, clean result links, history, escaped input and retry after unavailable index');

        await page.goto(origin + '/feedback/');
        await page.evaluate(() => { window.open = url => { window.testMail = url; }; Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });
        for (const [id, value] of [['name', 'Ім’я'], ['email', 'test@example.com'], ['subject', 'Перевірка & питання'], ['message', 'Текст повідомлення']]) await page.locator('#contact-' + id).fill(value);
        await page.locator('#contact-compose button[type="submit"]').click();
        const draft = new URL(await page.evaluate(() => window.testMail));
        assert.equal(draft.protocol, 'mailto:');
        assert.equal(draft.pathname, 'tcg@tcg.com.ua');
        assert.equal(draft.searchParams.get('subject'), 'Перевірка & питання');
        assert.match(draft.searchParams.get('body'), /Текст повідомлення/);
        assert.match(await page.locator('#contact-status').innerText(), /Подтвердите отправку/);
        await page.locator('#copy-message').click();
        assert.match(await page.locator('#copy-fallback').inputValue(), /Текст повідомлення/);
        console.log('PASS mail draft and copy fallback; no message sent, no false delivery confirmation');

        await page.goto(origin + '/documents/advertising-tax/#chapter-2');
        assert.equal(await page.locator('#chapter-2').getAttribute('open'), '');
        await page.evaluate(() => { window.print = () => { window.printOpen = [...document.querySelectorAll('.manual-chapter')].every(el => el.open); }; });
        await page.locator('[data-print]').click();
        assert.equal(await page.evaluate(() => window.printOpen), true);
        await page.evaluate(() => dispatchEvent(new Event('afterprint')));
        assert.equal(await page.locator('#chapter-3').getAttribute('open'), null);
        console.log('PASS manual chapter anchors and print expand/restore');

        const noJS = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
        await noJS.goto(origin + '/contacts/');
        assert.equal(await noJS.locator('#site-navigation').isVisible(), true);
        await noJS.close();
        assert.deepEqual(errors, []);
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
