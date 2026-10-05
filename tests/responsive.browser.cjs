const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const playwright = require('playwright');
const { build } = require('../scripts/build');
const { pageFiles, pageURL } = require('../lib/site-routes');

(async () => {
    const root = path.resolve(__dirname, '..'), output = build();
    const engine = process.env.TCG_TEST_BROWSER || 'chromium';
    const server = express().use(express.static(output)).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? {
            executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'],
        } : {}) });
        const context = await browser.newContext({ serviceWorkers: 'block' });
        await context.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const page = await context.newPage(), errors = [], failures = [];
        page.on('pageerror', error => errors.push(error.message));
        const sources = engine === 'chromium' ? pageFiles(root) : ['index.html', 'contacts.html', 'feedback.html', 'search.html', '1CPrice.html', '1Cabon.html', 'price01.html', 'price1C.html', 'ListPage/Pege03.html', 'ListPage/Pege06.html'];
        const widths = [320, 390, 768, 900, 1024, 1440, 1920, 2560];
        for (const width of widths) {
            await page.setViewportSize({ width, height: 900 });
            for (const file of sources) {
                await page.goto(origin + pageURL(file));
                const findings = await page.evaluate(() => {
                    const viewport = document.documentElement.clientWidth, problems = [];
                    if (document.documentElement.scrollWidth > viewport + 1) problems.push('page has horizontal overflow');
                    const main = document.querySelector('main, [role="main"]');
                    // Legacy desktop rules include a 2px border outside full-width separators.
                    if (main && main.scrollWidth > main.clientWidth + (viewport <= 1100 ? 1 : 2)) problems.push('article has horizontal overflow');
                    const visible = node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(node).visibility !== 'hidden'; };
                    for (const node of document.querySelectorAll('input:not([type="hidden"]), textarea, select, button, img')) {
                        if (!visible(node) || node.closest('.table-scroll')) continue;
                        const r = node.getBoundingClientRect();
                        if (r.left < -1 || r.right > viewport + 1) problems.push(node.tagName + ': outside viewport');
                    }
                    if (viewport <= 1100) {
                        const targets = [...document.querySelectorAll('a:has(.top-nav-icon), a:has(.left-nav-icon), .contact-choice, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, button')].filter(visible);
                        for (const node of targets) {
                            const r = node.getBoundingClientRect();
                            if (r.width < 43.5 || r.height < 43.5) problems.push((node.textContent || node.getAttribute('aria-label') || node.querySelector('img')?.alt || node.name) + ': target smaller than 44px');
                        }
                        const links = targets.filter(node => node.tagName === 'A');
                        for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
                            const a = links[i].getBoundingClientRect(), b = links[j].getBoundingClientRect();
                            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) problems.push('menu hit targets overlap');
                        }
                    }
                    return [...new Set(problems)];
                });
                if (findings.length) failures.push({ file, width, findings });
                if (process.env.TCG_RESPONSIVE_SCREENSHOTS && [390, 768].includes(width) && ['index.html', 'feedback.html', '1Cabon.html', 'price1C.html', 'ListPage/Pege03.html'].includes(file)) {
                    fs.mkdirSync(process.env.TCG_RESPONSIVE_SCREENSHOTS, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.TCG_RESPONSIVE_SCREENSHOTS, file.replace(/[^a-z0-9]/gi, '-') + '-' + width + '.png') });
                }
            }
        }
        if (failures.length) console.log(JSON.stringify(failures, null, 2));
        assert.deepEqual(failures, [], 'responsive pages fit without clipping articles/controls or overlapping touch targets');
        console.log('PASS ' + engine + ': ' + sources.length + ' pages at ' + widths.join('/') + 'px; no page/article overflow, visible controls, 44px menu and form targets');

        // Wide tables must remain readable and keyboard-scrollable on a phone.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(origin + '/1Cabon/');
        const table = page.locator('.table-scroll');
        assert.ok(await table.evaluate(node => node.scrollWidth > node.clientWidth));
        await table.focus(); await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.querySelector('.table-scroll').scrollLeft > 0);
        assert.equal(await page.evaluate(() => scrollX), 0);
        console.log('PASS ' + engine + ': wide tables scroll independently with the keyboard');
        assert.deepEqual(errors, []);
        await context.close();

        const touch = await browser.newContext({ serviceWorkers: 'block', hasTouch: true, viewport: { width: 390, height: 844 }, ...(engine === 'firefox' ? {} : { isMobile: true }) });
        await touch.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const phone = await touch.newPage();
        await phone.goto(origin + '/');
        await phone.evaluate(() => { window.responsiveMarker = true; });
        await phone.locator('a[href="/contacts/"]:has(.left-nav-icon)').tap();
        await phone.waitForURL(origin + '/contacts/');
        await phone.waitForFunction(() => !document.documentElement.hasAttribute('aria-busy'));
        assert.equal(await phone.evaluate(() => window.responsiveMarker), true, 'touch navigation keeps the SPA document');
        await phone.locator('a[href="/feedback/"]:has(img)').tap();
        await phone.waitForURL(origin + '/feedback/');
        await phone.locator('[name="Name"]').fill('Перевірка повороту екрана');
        await phone.setViewportSize({ width: 844, height: 390 });
        assert.equal(await phone.locator('[name="Name"]').inputValue(), 'Перевірка повороту екрана');
        assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
        await phone.setViewportSize({ width: 820, height: 1180 });
        await phone.locator('a[href="/search/"]:has(img)').tap();
        await phone.waitForURL(origin + '/search/');
        await phone.locator('#site-search').fill('резервное копирование');
        await phone.locator('[data-site-search] [type="submit"]').tap();
        await phone.locator('#search-results a[href="/ListPage/Pege05/"]').tap();
        await phone.waitForURL(origin + '/ListPage/Pege05/');
        assert.equal(await phone.evaluate(() => window.responsiveMarker), true);
        await phone.goto(origin + '/price1C/');
        const choice = phone.locator('[name="SendServiceLiterature"]'), checked = await choice.isChecked();
        await phone.locator('label[for="contact-1"]').tap();
        assert.equal(await choice.isChecked(), !checked, 'the full checkbox caption is a touch target');
        console.log('PASS ' + engine + ': touch menu, phone rotation retains form input, tablet search and SPA navigation');
        await touch.close();

        const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 700 } });
        const plain = await noScript.newPage();
        await plain.goto(origin + '/');
        await plain.locator('a[href="/contacts/"]:has(.left-nav-icon)').click();
        await plain.waitForURL(origin + '/contacts/');
        assert.ok(await plain.locator('#main-content').isVisible());
        console.log('PASS ' + engine + ': small-screen navigation also works without JavaScript');
        await noScript.close();
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
