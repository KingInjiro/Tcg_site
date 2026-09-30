// Deterministic UI checks. The NBU responses below are fixtures, not live exchange rates.
const { chromium } = require('playwright');
const express = require('express');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build');

(async () => {
    const output = build();
    const server = express().use(express.static(output)).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let mode = 'valid', requests = 0;
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin || url.protocol === 'data:') return route.continue();
            if (url.hostname === 'bank.gov.ua') {
                requests++;
                const date = url.searchParams.get('date');
                assert.match(date, /^\d{8}$/);
                const exchangedate = date.slice(6) + '.' + date.slice(4, 6) + '.' + date.slice(0, 4);
                const records = [
                    { cc: 'USD', rate: 42, exchangedate },
                    { cc: 'EUR', rate: 50, exchangedate },
                ];
                if (mode === 'network') return route.abort();
                if (mode === 'http') return route.fulfill({ status: 503, body: 'Unavailable' });
                if (mode === 'missing') records.pop();
                if (mode === 'zero') records[0].rate = 0;
                if (mode === 'stale') records[0].exchangedate = '01.01.2000';
                return route.fulfill({ json: mode === 'malformed' ? { error: 'invalid' } : records });
            }
            if (url.hostname === 'api.rss2json.com') return route.fulfill({ json: { status: 'ok', items: [] } });
            return route.abort();
        });
        const text = async selector => (await page.locator(selector).innerText()).replace(/[\s\u00a0\u202f]/g, '');
        const loaded = async () => {
            await page.waitForFunction(() => !document.querySelector('#currency-converter fieldset').disabled);
            assert.equal(await page.locator('#currency-refresh').isDisabled(), false);
        };
        await page.goto(origin + '/');
        await loaded();
        await page.getByText('Курс НБУ и конвертер валют', { exact: true }).click();
        assert.equal(await text('#currency-result'), '100,00USD=4200,00UAH');
        assert.match(await page.locator('#currency-date').innerText(), /^Курс на \d{2}\.\d{2}\.\d{4}$/);
        await page.locator('#currency-from').selectOption('UAH');
        await page.locator('#currency-to').selectOption('USD');
        await page.locator('#currency-amount').fill('4200');
        assert.equal(await text('#currency-result'), '4200,00UAH=100,00USD');
        await page.locator('#currency-from').selectOption('EUR');
        await page.locator('#currency-amount').fill('100');
        assert.equal(await text('#currency-result'), '100,00EUR=119,05USD');
        await page.locator('#currency-to').selectOption('UAH');
        await page.locator('#currency-amount').fill('12,5');
        assert.equal(await text('#currency-result'), '12,50EUR=625,00UAH');
        await page.locator('#currency-to').selectOption('EUR');
        assert.equal(await text('#currency-result'), '12,50EUR=12,50EUR');
        await page.locator('#currency-amount').fill('0');
        assert.equal(await text('#currency-result'), '0,00EUR=0,00EUR');
        for (const value of ['', '-5', 'abc', '1e309']) {
            await page.locator('#currency-amount').fill(value);
            assert.equal(await page.locator('#currency-amount').getAttribute('aria-invalid'), 'true');
            assert.match(await text('#currency-result'), /Введитесумму/);
        }
        await page.locator('#currency-amount').fill('1 000,50');
        assert.equal(await page.locator('#currency-amount').getAttribute('aria-invalid'), null);
        await page.locator('#currency-amount').press('Enter');
        assert.equal(new URL(page.url()).pathname, '/');
        console.log('PASS currency UI: direct, reverse, cross and same-currency conversions; comma, zero and invalid input; keyboard submit');

        for (mode of ['network', 'http', 'missing', 'zero', 'stale', 'malformed']) {
            await page.locator('#currency-refresh').click();
            await page.waitForFunction(() => document.getElementById('currency-rates').textContent === 'Курсы НБУ недоступны.');
            assert.equal(await page.locator('#currency-amount').isDisabled(), true);
            assert.equal(await page.locator('#currency-date').innerText(), '');
            assert.match(await page.locator('#currency-result').innerText(), /Расчёт недоступен/);
        }
        mode = 'valid';
        await page.locator('#currency-refresh').click();
        await loaded();
        assert.equal(await text('#currency-result'), '1000,50EUR=1000,50EUR');
        console.log('PASS failed, incomplete and stale rates never produce a result; retry restores the converter');

        const requestsBeforeBackup = requests;
        await page.goto(origin + '/articles/backup/');
        assert.equal(await text('#backup-result'), 'Требуетсяпримерно360ГБ');
        assert.equal(await text('#backup-formula'), '100ГБ×3×(1+20/100)=360ГБ');
        await page.locator('#backup-size').fill('10,5');
        await page.locator('#backup-copies').fill('2');
        await page.locator('#backup-reserve').fill('0');
        assert.equal(await text('#backup-result'), 'Требуетсяпримерно21ГБ');
        await page.locator('#backup-size').fill('0,001');
        assert.equal(await text('#backup-result'), 'Требуетсяпримерно0,002ГБ');
        await page.locator('#backup-copies').fill('2.5');
        assert.equal(await page.locator('#backup-copies').getAttribute('aria-invalid'), 'true');
        assert.equal(await text('#backup-formula'), '');
        await page.locator('#backup-copies').fill('2');
        for (const [field, value] of [['#backup-size', '0'], ['#backup-size', '-1'], ['#backup-reserve', ''], ['#backup-reserve', '-1']]) {
            await page.locator(field).fill(value);
            assert.equal(await page.locator(field).getAttribute('aria-invalid'), 'true');
        }
        await page.locator('#backup-size').fill('250');
        await page.locator('#backup-reserve').fill('20');
        assert.equal(await text('#backup-result'), 'Требуетсяпримерно600ГБ');
        await page.locator('#backup-size').press('Enter');
        assert.equal(new URL(page.url()).pathname, '/articles/backup/');
        assert.equal(requests, requestsBeforeBackup, 'backup calculation is local and never loads exchange rates');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(await page.locator('#backup-size').isVisible());
        assert.ok(await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) <= innerWidth + 1));
        assert.deepEqual(errors, []);
        console.log('PASS backup UI: full-copy estimate and formula, validation, mobile layout and no external data dependency');
    } finally {
        await browser?.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
