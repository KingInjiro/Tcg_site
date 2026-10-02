// Compare visible text and image geometry, not obsolete markup structure.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { pageFiles, pageURL } = require('../lib/site-routes');

(async () => {
    const root = path.resolve(__dirname, '..'), baseline = process.env.TCG_BASELINE_DIR;
    assert.ok(baseline && fs.existsSync(path.join(baseline, 'index.html')), 'Set TCG_BASELINE_DIR to the pre-change checkout');
    const servers = [baseline, path.join(root, 'dist')].map(dir => express().use(express.static(dir)).listen(0, '127.0.0.1'));
    await Promise.all(servers.map(server => new Promise(resolve => server.once('listening', resolve))));
    const origins = servers.map(server => 'http://127.0.0.1:' + server.address().port);
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const pages = await Promise.all(origins.map(() => browser.newPage({ serviceWorkers: 'block' })));
        for (const page of pages) await page.route('**/*', route => {
            if (route.request().resourceType() === 'script') return route.abort();
            return origins.includes(new URL(route.request().url()).origin) || route.request().url().startsWith('data:') ? route.continue() : route.abort();
        });
        const snapshot = page => page.evaluate(() => {
            const texts = [], rect = r => [r.x, r.y, r.width, r.height];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                if (!node.textContent.trim() || node.parentElement.closest('script,style,noscript,.skip-link,.form-trap,[role="status"]')) continue;
                const range = document.createRange(); range.selectNodeContents(node);
                const rects = [...range.getClientRects()].filter(r => r.width && r.height).map(rect);
                if (!rects.length) continue;
                const style = getComputedStyle(node.parentElement);
                texts.push({ text: node.textContent.replace(/\s+/g, ' ').trim(), rects, font: style.font, color: style.color,
                    background: style.backgroundColor, inForm: !!node.parentElement.closest('form') });
            }
            const images = [...document.images].filter(n => n.checkVisibility()).map(n => ({ src: n.getAttribute('src'), rect: rect(n.getBoundingClientRect()) }));
            return { texts, images };
        });
        const failures = [], sources = pageFiles(root);
        const near = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) <= 1);
        for (const width of [1440, 390]) {
            for (const page of pages) await page.setViewportSize({ width, height: 1000 });
            for (const file of sources) {
                await Promise.all(pages.map((page, i) => page.goto(origins[i] + (i ? pageURL(file) : '/' + file), { waitUntil: 'load' })));
                const [before, after] = await Promise.all(pages.map(snapshot)), changes = [];
                if (before.texts.length !== after.texts.length) changes.push({ kind: 'text-count', before: before.texts.length, after: after.texts.length });
                for (let i = 0; i < Math.min(before.texts.length, after.texts.length); i++) {
                    const a = before.texts[i], b = after.texts[i];
                    for (const key of ['text', 'font', 'color', 'background']) if (a[key] !== b[key]) changes.push({ kind: key, index: i, text: a.text.slice(0, 80), before: a[key], after: b[key] });
                    // This form previously had captions but no inputs/buttons. Restoring them necessarily changes its height.
                    if (file === 'price1C.html' && a.inForm && b.inForm) continue;
                    if (a.rects.length !== b.rects.length || a.rects.some((r, j) => !b.rects[j] || !near(r, b.rects[j]))) changes.push({ kind: 'text-geometry', index: i, text: a.text.slice(0, 80), before: a.rects, after: b.rects });
                }
                if (before.images.length !== after.images.length) changes.push({ kind: 'image-count', before: before.images.length, after: after.images.length });
                for (let i = 0; i < Math.min(before.images.length, after.images.length); i++) {
                    const a = before.images[i], b = after.images[i];
                    if (a.src !== b.src || !near(a.rect, b.rect)) changes.push({ kind: 'image', index: i, before: a, after: b });
                }
                if (changes.length) failures.push({ file, width, changes });
            }
        }
        if (process.env.TCG_APPEARANCE_REPORT) fs.writeFileSync(process.env.TCG_APPEARANCE_REPORT, JSON.stringify(failures, null, 2));
        if (failures.length) console.log('PRESERVATION_REPORT ' + JSON.stringify(failures));
        assert.deepEqual(failures, [], 'visible content, fonts, colours and geometry must remain unchanged (1px rounding tolerance)');
        console.log('PASS appearance preservation: ' + sources.length + ' pages at 1440 and 390px; only restored price1C form geometry is excluded');
    } finally {
        await browser?.close();
        await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
