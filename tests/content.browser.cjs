// Verify the actual static build, with exact filenames and no Express legacy aliases.
const { chromium } = require('playwright');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { build } = require('../scripts/build');
const { isPage, pageProblem } = require('../admin/repository');

(async () => {
    const output = build();
    const files = fs.readdirSync(output, { recursive: true }).filter(name => fs.statSync(path.join(output, name)).isFile() && !name.startsWith('admin/'));
    const pages = files.filter(name => /\.html?$/i.test(name));
    const assets = files.filter(name => /\.(?:png|jpe?g|gif|webp)$/i.test(name));
    for (const name of pages) assert.equal(pageProblem(fs.readFileSync(path.join(output, name), 'utf8')), null, name);
    const server = express().use(express.static(output)).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const page = await browser.newPage({ javaScriptEnabled: false, serviceWorkers: 'block' });
        // External counters are not local site assets and must not make this test flaky.
        await page.route('**/*', route => new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        const failed = [];
        page.on('response', response => { if (new URL(response.url()).origin === origin && response.status() >= 400) failed.push(response.url()); });
        page.on('requestfailed', request => { if (new URL(request.url()).origin === origin) failed.push(request.url()); });
        let imageCount = 0;
        for (const name of pages) {
            const response = await page.goto(origin + '/' + name, { waitUntil: 'load' });
            assert.equal(response.status(), 200, name);
            const result = await page.evaluate(async () => {
                const images = [...document.images].filter(image => !image.closest('noscript') && (image.src.startsWith(location.origin + '/') || image.src.startsWith('data:')));
                await Promise.all(images.map(image => image.decode().catch(() => {})));
                return { count: images.length, broken: images.filter(image => !image.naturalWidth).map(image => image.getAttribute('src')), charset: document.characterSet };
            });
            assert.deepEqual(result.broken, [], name + ': broken image');
            assert.equal(result.charset, 'UTF-8', name + ': wrong encoding');
            imageCount += result.count;
        }
        assert.deepEqual([...new Set(failed)], [], 'all local resources, including CSS backgrounds, must load');
        const brokenAssets = await page.evaluate(async paths => {
            const failures = [];
            let next = 0;
            await Promise.all(Array.from({ length: 8 }, async () => {
                while (next < paths.length) {
                    const path = paths[next++], image = new Image();
                    image.src = '/' + path.split('/').map(encodeURIComponent).join('/');
                    try { await image.decode(); if (!image.naturalWidth) failures.push(path); }
                    catch { failures.push(path); }
                }
            }));
            return failures;
        }, assets);
        assert.deepEqual(brokenAssets, [], 'every image offered by the asset library must decode');
        console.log(`PASS ${pages.filter(isPage).length} editable pages + ${pages.filter(name => !isPage(name)).length} support pages: UTF-8, ${imageCount} image placements and all local resources`);
        console.log(`PASS all ${assets.length} image files decode in Chromium`);
    } finally {
        await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
