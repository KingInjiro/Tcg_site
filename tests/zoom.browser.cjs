// Use Chromium's actual tab zoom. CSS zoom and pinch emulation do not test
// the browser's changing layout viewport and responsive media queries.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { build } = require('../scripts/build');

(async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-zoom-'));
    const extension = path.join(temporary, 'extension');
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify({
        manifest_version: 3, name: 'TCG zoom test', version: '1.0', background: { service_worker: 'worker.js' },
    }));
    fs.writeFileSync(path.join(extension, 'worker.js'), 'chrome.runtime.onInstalled.addListener(() => {});');
    const server = express().use(express.static(build())).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let context;
    try {
        context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
            channel: 'chromium', headless: true, viewport: null,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1440,1000',
                '--disable-extensions-except=' + extension, '--load-extension=' + extension],
        });
        const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
        const page = await context.newPage();
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        await page.goto(origin);
        await page.bringToFront();
        const originalWidth = await page.evaluate(() => innerWidth);
        for (const zoom of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
            const actual = await worker.evaluate(async factor => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                await chrome.tabs.setZoom(tab.id, factor);
                return chrome.tabs.getZoom(tab.id);
            }, zoom);
            assert.ok(Math.abs(actual - zoom) < 0.001, 'real tab zoom is applied');
            await page.waitForFunction(width => Math.abs(innerWidth - width) <= 2, originalWidth / zoom);
            let reference;
            for (const route of ['/', '/contacts/', '/1CPrice/', '/1Cabon/', '/ListPage/Pege05/']) {
                await page.goto(origin + route);
                const result = await page.evaluate(() => {
                    const viewport = document.documentElement.clientWidth, header = document.querySelector('.site-header').getBoundingClientRect();
                    const sidebar = document.querySelector('.site-layout > tbody > tr > td:first-child')?.getBoundingClientRect();
                    return { viewport, overflow: document.documentElement.scrollWidth > viewport + 1,
                        header: [header.left, header.top, header.width, header.height],
                        left: sidebar?.left, right: header.right };
                });
                assert.equal(result.overflow, false, route + ' @ ' + zoom + ': no page overflow');
                assert.ok(Math.abs(result.header[0] - 8) <= 1 && Math.abs(result.right - (result.viewport - 8)) <= 1, route + ': header fills available width');
                if (result.left !== undefined) assert.ok(Math.abs(result.left - 8) <= 1, route + ': left menu stays at the edge');
                reference ||= result.header;
                assert.deepEqual(result.header, reference, route + ': same header at ' + zoom);
            }
            await page.locator('.site-header a[href="/feedback/"]').click();
            await page.waitForURL(origin + '/feedback/');
            await page.waitForFunction(() => !document.documentElement.hasAttribute('aria-busy'));
            assert.equal(await page.locator('.site-header nav a').count(), 6, 'shared menu survives SPA navigation');
        }
        console.log('PASS real browser zoom at 50/75/100/125/150/200%: shared header, anchored left menu, reflow and SPA navigation');
    } finally {
        await context?.close();
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
