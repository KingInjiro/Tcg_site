const assert = require('node:assert/strict');
const express = require('express');
const playwright = require('playwright');
const { build } = require('../scripts/build');
const { createApp } = require('../server');
const { createContact } = require('../lib/contact');

(async () => {
    const output = build(), accepted = [];
    let failure = false, browser;
    const contact = createContact({
        env: { CONTACT_FROM: 'site@example.com', CONTACT_TO: 'owner@example.com' },
        sendMail: async message => {
            if (failure) throw new Error('Simulated SMTP failure');
            accepted.push(message);
            return { accepted: ['owner@example.com'] };
        },
    });
    const servers = [createApp({ contact }), express().use(express.static(output))].map(app => app.listen(0, '127.0.0.1'));
    await Promise.all(servers.map(server => new Promise(resolve => server.once('listening', resolve))));
    const origins = servers.map(server => 'http://127.0.0.1:' + server.address().port);
    const engine = process.env.TCG_TEST_BROWSER || 'chromium';
    assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), 'unsupported browser');
    try {
        browser = await playwright[engine].launch({
            headless: true,
            ...(engine === 'chromium' ? { executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}),
        });
        const page = await browser.newPage({ serviceWorkers: 'block' }), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => origins.includes(new URL(route.request().url()).origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.goto(origins[1] + '/search/');
            await page.locator('#site-search').fill('резервное копирование');
            await page.locator('#site-search').press('Enter');
            await page.waitForSelector('#search-results li');
            assert.ok(await page.locator('#search-results a[href="/ListPage/Pege05/"]').count());
            assert.equal(new URL(page.url()).searchParams.get('search'), 'резервное копирование');
            await page.reload();
            await page.waitForSelector('#search-results li');
            for (const query of ['несуществующийзапрос', '<img src=x onerror=alert(1)>']) {
                await page.locator('#site-search').fill(query);
                await page.locator('#site-search').press('Enter');
                await page.waitForFunction(() => document.querySelector('#search-status').textContent.includes('ничего не найдено'));
                assert.equal(await page.locator('#search-results img').count(), 0);
            }
            await page.locator('[data-site-search] [type="reset"]').click();
            assert.equal(await page.locator('#site-search').inputValue(), '');
            assert.equal(await page.locator('#search-results li').count(), 0);
        }
        let count = 0;
        for (const url of ['/feedback/', '/1CPrice/', '/price01/', '/price1C/']) {
            await page.goto(origins[0] + url);
            const form = page.locator('[data-contact-form]');
            await form.locator('[name="Name"]').fill('Тестова перевірка');
            await form.locator('[name="Email"]').fill('test' + (++count) + '@example.com');
            if (await form.locator('textarea').count()) await form.locator('textarea').first().fill('Тест без надсилання реальної пошти.');
            await form.locator('[type="submit"]').click();
            await page.waitForFunction(() => document.querySelector('[data-contact-form] [role="status"]').textContent.includes('принято почтовым сервером'));
            assert.equal(await form.locator('[name="Name"]').inputValue(), '');
            assert.equal(accepted.length, count);
        }
        failure = true;
        for (const [origin, name, email] of [
            [origins[0], 'Збережені дані', 'failed@example.com'],
            [origins[1], 'Статичний хостинг', 'static@example.com'],
        ]) {
            await page.goto(origin + '/feedback/');
            const form = page.locator('[data-contact-form]');
            await form.locator('[name="Name"]').fill(name);
            await form.locator('[name="Email"]').fill(email);
            await form.locator('[type="submit"]').click();
            await page.waitForFunction(() => document.querySelector('[data-contact-form] [role="status"]').textContent.includes('Не удалось подтвердить'));
            assert.equal(await form.locator('[name="Name"]').inputValue(), name);
        }
        assert.equal(accepted.length, 4, 'failed requests must not appear sent');
        assert.deepEqual(errors, []);
        console.log('PASS ' + engine + ': static search at 1440/390, reload/reset/empty results, four forms, SMTP rejection and absent backend retain input; no real mail sent');
    } finally {
        await browser?.close();
        await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
