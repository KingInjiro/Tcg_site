// Preserve desktop content geometry and the content/artwork/typography at both sizes.
// Narrow layouts intentionally reflow; responsive.browser.cjs checks their fit and usability.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { pageFiles, pageURL } = require('../lib/site-routes');

(async () => {
    const root = path.resolve(__dirname, '..'), baseline = process.env.TCG_BASELINE_DIR;
    assert.ok(baseline && fs.existsSync(path.join(baseline, 'index.html')), 'Set TCG_BASELINE_DIR to the pre-change checkout');
    // The client approved larger menus and softer upper buttons. Apply only that
    // shared menu presentation to the reference page too: the rest of the desktop
    // layout must still match, including the content displaced by taller menus.
    // Responsive checks exercise the real published layout without this adjustment.
    const menuPresentation = fs.readFileSync(path.join(root, 'themes/navigation.css'), 'utf8').split('/* Original FrontPage rollover')[0];
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
            const images = [...document.images].filter(n => n.checkVisibility() && n.getBoundingClientRect().width && n.getBoundingClientRect().height)
                .map(n => ({ src: n.getAttribute('src'), rect: rect(n.getBoundingClientRect()) }));
            return { texts, images };
        });
        const failures = [], sources = pageFiles(root);
        const near = (a, b) => a.length === b.length && a.every((n, i) => Math.abs(n - b[i]) <= 1);
        for (const width of [1440, 390]) {
            for (const page of pages) await page.setViewportSize({ width, height: 1000 });
            for (const file of sources) {
                await Promise.all(pages.map((page, i) => page.goto(origins[i] + (i ? pageURL(file) : '/' + file), { waitUntil: 'load' })));
                await pages[0].addStyleTag({ content: menuPresentation });
                const [before, after] = await Promise.all(pages.map(snapshot)), changes = [];
                if (before.texts.length !== after.texts.length) changes.push({ kind: 'text-count', before: before.texts.length, after: after.texts.length });
                for (let i = 0; i < Math.min(before.texts.length, after.texts.length); i++) {
                    const a = before.texts[i], b = after.texts[i];
                    for (const key of ['text', 'font', 'color', 'background']) if (a[key] !== b[key]) changes.push({ kind: key, index: i, text: a.text.slice(0, 80), before: a[key], after: b[key] });
                    // This form previously had captions but no inputs/buttons. Restoring them necessarily changes its height.
                    if (file === 'price1C.html' && a.inForm && b.inForm) continue;
                    if (width >= 1100 && (a.rects.length !== b.rects.length || a.rects.some((r, j) => !b.rects[j] || !near(r, b.rects[j])))) changes.push({ kind: 'text-geometry', index: i, text: a.text.slice(0, 80), before: a.rects, after: b.rects });
                }
                if (before.images.length !== after.images.length) changes.push({ kind: 'image-count', before: before.images.length, after: after.images.length });
                for (let i = 0; i < Math.min(before.images.length, after.images.length); i++) {
                    const a = before.images[i], b = after.images[i];
                    if (a.src !== b.src || (width >= 1100 && !near(a.rect, b.rect))) changes.push({ kind: 'image', index: i, before: a, after: b });
                }
                if (changes.length) failures.push({ file, width, changes });
            }
        }
        if (process.env.TCG_APPEARANCE_REPORT) fs.writeFileSync(process.env.TCG_APPEARANCE_REPORT, JSON.stringify(failures, null, 2));
        if (failures.length) console.log('PRESERVATION_REPORT ' + JSON.stringify(failures));
        assert.deepEqual(failures, [], 'visible content, fonts, colours and artwork remain unchanged; desktop geometry has 1px tolerance');
        console.log('PASS appearance preservation: ' + sources.length + ' pages; desktop content geometry at 1440px with approved menu sizing, content/fonts/colours/artwork at 1440/390px; restored price1C form geometry is excluded');

        // Keep the original image replacement on hover and keyboard focus.
        const buttons = new Map();
        for (const file of sources) {
            const html = fs.readFileSync(path.join(root, file), 'utf8');
            for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+_[GHV]BTN\.GIF)"/gi)) if (!buttons.has(match[1])) buttons.set(match[1], file);
        }
        const interactive = await browser.newPage({ serviceWorkers: 'block' }), errors = [];
        interactive.on('pageerror', error => errors.push(error.message));
        await interactive.route('**/*', route => new URL(route.request().url()).origin === origins[1] || route.request().url().startsWith('data:') ? route.continue() : route.abort());
        await interactive.goto(origins[1] + '/contacts.html?from=old#phone');
        await interactive.waitForURL(origins[1] + '/contacts/?from=old#phone');
        await interactive.goto(origins[1] + '/index.html?from=old');
        await interactive.waitForURL(origins[1] + '/?from=old');
        let currentFile;
        for (const [src, file] of buttons) {
            if (file !== currentFile) await interactive.goto(origins[1] + pageURL(file));
            currentFile = file;
            const menu = interactive.locator('a > img[src="' + src + '"]').first();
            const expected = src.replace(/\.GIF$/i, '_A.GIF');
            const globalButton = /_GBTN\.GIF$/i.test(src);
            await interactive.mouse.move(0, 0);
            await interactive.evaluate(() => document.activeElement?.blur());
            const normal = await menu.evaluate(img => ({ filter: getComputedStyle(img).filter, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height }));
            await menu.hover();
            if (globalButton) {
                assert.notEqual(await menu.evaluate(img => getComputedStyle(img).filter), normal.filter, src + ': upper background changes on hover');
                assert.ok(normal.width > 90, src + ': upper lettering is enlarged');
            } else assert.ok((await menu.evaluate(img => getComputedStyle(img).content)).includes(expected), src + ': hover');
            await interactive.mouse.move(0, 0);
            await interactive.keyboard.press('Tab');
            await menu.locator('..').focus();
            if (globalButton) assert.notEqual(await menu.evaluate(img => getComputedStyle(img).filter), normal.filter, src + ': upper background changes on keyboard focus');
            else assert.ok((await menu.evaluate(img => getComputedStyle(img).content)).includes(expected), src + ': keyboard focus');
            assert.deepEqual(await menu.evaluate(img => ({ width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })), { width: normal.width, height: normal.height }, src + ': no resizing on hover/focus');
        }
        assert.deepEqual(errors, []);
        console.log('PASS ' + buttons.size + ' original GIF buttons: upper background/legacy rollover on hover and keyboard focus, no resizing; legacy redirects preserve query/hash');
        const offline = await browser.newPage();
        await offline.route('**/*', route => new URL(route.request().url()).origin === origins[1] ? route.continue() : route.abort());
        await offline.goto(origins[1] + '/');
        await offline.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {}, { timeout: 30000 });
        assert.ok(await offline.evaluate(async () => Boolean(await caches.match('/'))), 'offline homepage is cached');
        console.log('PASS shared service-worker registration and homepage cache');
    } finally {
        await browser?.close();
        await Promise.all(servers.map(server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
