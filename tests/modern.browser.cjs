// Public journeys on a plain static server: no Node route helpers or hosting rewrites.
const { chromium } = require('playwright');
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build');
const { sourcePages } = require('../lib/published-site');
const routes = require('../themes/routes');

async function checkPhones(browser, origin) {
    const createPage = async options => {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', ...options });
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        // Never hand a real number to a native app during a test.
        await page.addInitScript(() => {
            window.phoneLaunches = [];
            window.open = (url, target) => { window.phoneLaunches.push({ url, target }); return null; };
        });
        await page.goto(origin + '/');
        return page;
    };
    const desktop = await createPage({ viewport: { width: 1440, height: 1000 } });
    for (const width of [1440, 390]) {
        await desktop.setViewportSize({ width, height: 1000 });
        assert.equal(await desktop.locator('.header-contacts span.contact-phone').count(), 2);
        assert.equal(await desktop.locator('.header-contacts button, a[href^="tel:"]').count(), 0);
        await desktop.locator('.contact-phone').first().click();
        assert.deepEqual(await desktop.evaluate(() => window.phoneLaunches), []);
    }
    await desktop.close();
    for (const userAgent of [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
    ]) {
        const phone = await createPage({ userAgent, isMobile: true, hasTouch: true });
        const numbers = phone.locator('.header-contacts button.contact-phone');
        assert.equal(await numbers.count(), 2);
        assert.equal(await phone.locator('a[href^="tel:"]').count(), 0);
        await numbers.first().click();
        const dialog = phone.locator('.phone-dialog');
        assert.equal(await dialog.getAttribute('open'), '');
        assert.equal(await phone.locator('#phone-dialog-number').innerText(), '+38 (044) 400-46-00');
        assert.deepEqual(await phone.evaluate(() => window.phoneLaunches), []);
        assert.ok(await phone.locator('.phone-cancel').evaluate(el => el === document.activeElement));
        await phone.locator('.phone-cancel').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await phone.evaluate(() => window.phoneLaunches), []);
        assert.ok(await numbers.first().evaluate(el => el === document.activeElement));
        await numbers.last().click();
        await phone.locator('.phone-confirm').click();
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await phone.evaluate(() => window.phoneLaunches), [{ url: 'tel:+380504486958', target: '_self' }]);
        await numbers.first().click();
        await phone.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await phone.evaluate(() => window.phoneLaunches.length), 1);
        await phone.close();
    }
    const plain = await createPage({ javaScriptEnabled: false });
    assert.equal(await plain.locator('.header-contacts span.contact-phone').count(), 2);
    assert.equal(await plain.locator('a[href^="tel:"]').count(), 0);
    assert.equal(await plain.locator('meta[name="format-detection"]').getAttribute('content'), 'telephone=no');
    await plain.close();
    console.log('PASS desktop phone numbers stay text even in a narrow window; simulated phone browsers confirm/cancel before tel handoff; no native app launched by the test; no-JS fallback');
}

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

        await checkPhones(browser, origin);
        await page.goto(origin + '/');
        assert.equal(await page.locator('.direction-grid > li').count(), 5);
        assert.equal(await page.locator('.direction-grid > li > a[href]').count(), 5);
        await page.locator('.direction-grid > li').nth(1).click({ position: { x: 15, y: 15 } });
        await page.waitForURL(origin + '/services/office/#equipment-supply');
        assert.match(await page.locator('#equipment-supply').innerText(), /Комплексная поставка оборудования/);
        await page.goto(origin + '/');
        await page.locator('.direction-grid > li').nth(4).click({ position: { x: 15, y: 15 } });
        await page.waitForURL(origin + '/services/audit/');
        console.log('PASS all five direction cards are clickable; equipment and consulting lead to existing relevant content');

        await page.goto(origin + '/services/');
        const menu = page.locator('.main-navigation a').first();
        assert.ok(await menu.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 18 && el.getBoundingClientRect().height >= 48));
        const idleBackground = await menu.evaluate(el => getComputedStyle(el).backgroundColor);
        await menu.hover();
        assert.equal(await menu.evaluate(el => getComputedStyle(el).backgroundImage), 'none');
        await page.waitForFunction(previous => getComputedStyle(document.querySelector('.main-navigation a:hover')).backgroundColor !== previous, idleBackground);
        const activeMenu = page.locator('.main-navigation a[aria-current="page"]');
        assert.notEqual(await activeMenu.evaluate(el => getComputedStyle(el).backgroundColor), idleBackground);
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
                assert.equal(await page.locator('.site-brand').count(), 0, file + ': duplicate logo text');
                assert.equal(await page.locator('.header-contacts span.contact-phone').count(), 2, file + ': desktop numbers are plain text');
                assert.equal(await page.locator('meta[name="format-detection"]').getAttribute('content'), 'telephone=no');
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), file + ' overflows at ' + width);
                assert.ok(await page.locator('.site-header').evaluate(el => { const box = el.getBoundingClientRect(); return box.x === 0 && Math.abs(box.width - innerWidth) < 1; }), file + ': banner must reach both viewport edges at ' + width);
            }
        }
        await page.setViewportSize({ width: 1920, height: 1080 });
        await page.goto(origin + '/');
        assert.ok(await page.locator('.site-header').evaluate(el => el.getBoundingClientRect().width === innerWidth));
        console.log('PASS full-width banner including 1920px; all pages fit 390/1024/1440px; larger yellow-hover menu, original top images and mobile navigation');

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
