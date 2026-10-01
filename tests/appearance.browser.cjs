// Compare against a separate checkout of the version before the changes. Never modify it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const { chromium } = require('playwright');
const { pageFiles, pageURL } = require('../lib/site-routes');
const { build } = require('../scripts/build');
const root = path.resolve(__dirname, '..');
const baseline = process.env.TCG_BASELINE_DIR;
assert.ok(baseline, 'Set TCG_BASELINE_DIR to the baseline checkout');

function snapshot() {
    const text = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (!walker.currentNode.parentElement.closest('script,style')) text.push(walker.currentNode.textContent);
    }
    const boxes = [...document.querySelectorAll('body,table,td,p,div.legacy-paragraph,img,h1,h2,h3,h4,h5,h6,li,input,textarea,select,button')].map(node => {
        const rect = node.getBoundingClientRect();
        return { tag: node.classList.contains('legacy-paragraph') ? 'p' : node.localName,
            name: node.getAttribute('name') || node.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }).filter(rect => rect.width && rect.height);
    const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
        'color', 'backgroundColor', 'backgroundImage', 'listStyleImage', 'textAlign', 'textDecorationLine',
        'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
        'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
    const styles = [...document.body.querySelectorAll('*')].filter(node => !node.matches('script,style,link,meta')).map(node => {
        const style = getComputedStyle(node);
        return Object.fromEntries(properties.map(name => [name, style[name].replaceAll(location.origin, 'https://tcg.invalid')]));
    });
    return { text: text.join('').replace(/\s+/gu, ' ').trim(), boxes, styles,
        links: [...document.querySelectorAll('a[href]')].map(link => link.getAttribute('href')),
        buttons: [...document.querySelectorAll('a > img')].map(img => img.getAttribute('src')).filter(src => /_[HV]BTN\.GIF$/i.test(src)),
        images: [...document.images].map(img => img.getAttribute('src')) };
}

(async () => {
    const output = build();
    const servers = [baseline, output].map(dir => express().use(express.static(dir)).listen(0, '127.0.0.1'));
    await Promise.all(servers.map(server => new Promise(resolve => server.once('listening', resolve))));
    const origins = servers.map(server => 'http://127.0.0.1:' + server.address().port);
    const browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const pages = pageFiles(root), buttons = new Map();
        for (const width of [1440, 390]) {
            const deviations = [];
            const views = await Promise.all(origins.map(async origin => {
                const page = await browser.newPage({ viewport: { width, height: 1100 }, javaScriptEnabled: false, serviceWorkers: 'block' });
                await page.route('**/*', route => {
                    if (new URL(route.request().url()).origin === origin || route.request().url().startsWith('data:')) return route.continue();
                    // Freeze third-party counters/logos; their availability is not a layout change.
                    if (route.request().resourceType() === 'image') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="88" height="31"/>' });
                    return route.abort();
                });
                return page;
            }));
            for (const file of pages) {
                await views[0].goto(origins[0] + '/' + file);
                await views[1].goto(origins[1] + pageURL(file));
                const [before, after] = await Promise.all(views.map(page => page.evaluate(snapshot)));
                assert.equal(after.text, before.text, file + ': page text changed');
                assert.deepEqual(after.links, before.links, file + ': page links changed');
                assert.equal(after.styles.length, before.styles.length, file + ': styled element count');
                for (let i = 0; i < before.styles.length; i++) for (const prop of Object.keys(before.styles[i])) {
                    if (before.styles[i][prop] !== after.styles[i][prop]) deviations.push({ file, width, index: i,
                        property: prop, before: before.styles[i][prop], after: after.styles[i][prop] });
                }
                for (const src of after.buttons) if (!buttons.has(src)) buttons.set(src, file);
                // Source URLs are rooted during publishing; compare resolved paths and embedded data.
                const normalize = src => src.startsWith('data:') || /^https?:/.test(src) ? src : new URL(src, 'https://tcg.invalid/' + file).pathname;
                assert.deepEqual(after.images.map(normalize), before.images.map(normalize), file + ': image artwork changed');
                assert.equal(after.boxes.length, before.boxes.length, `${file} @ ${width}: visible element count`);
                for (let i = 0; i < before.boxes.length; i++) {
                    const a = before.boxes[i], b = after.boxes[i];
                    assert.equal(b.tag, a.tag, `${file} @ ${width}, element ${i}`);
                    for (const prop of ['x', 'y', 'width', 'height']) {
                        if (Math.abs(a[prop] - b[prop]) > 1) deviations.push({ file, width, index: i, tag: a.tag, name: a.name, property: prop, before: a[prop], after: b[prop] });
                    }
                }
                if (file === 'index.html' && process.env.TCG_SCREENSHOT_DIR) {
                    fs.mkdirSync(process.env.TCG_SCREENSHOT_DIR, { recursive: true });
                    for (let i = 0; i < views.length; i++) await views[i].screenshot({ path: path.join(process.env.TCG_SCREENSHOT_DIR, ['before', 'after'][i] + '-' + width + '.png') });
                }
            }
            await Promise.all(views.map(page => page.close()));
            if (process.env.TCG_APPEARANCE_REPORT && deviations.length) fs.writeFileSync(process.env.TCG_APPEARANCE_REPORT, JSON.stringify(deviations, null, 2));
            assert.equal(deviations.length, 0, 'Layout changed: ' + JSON.stringify(deviations.slice(0, 3)));
            console.log(`PASS ${pages.length} pages @ ${width}px: original text, links, images, fonts, colours and layout (1px rounding tolerance)`);
        }
        const page = await browser.newPage({ serviceWorkers: 'block' });
        await page.route('**/*', route => new URL(route.request().url()).origin === origins[1] ? route.continue() : route.abort());
        await page.goto(origins[1] + '/contacts.html?from=old#phone');
        await page.waitForURL(origins[1] + '/contacts/?from=old#phone');
        await page.goto(origins[1] + '/index.html?from=old');
        await page.waitForURL(origins[1] + '/?from=old');
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let currentFile;
        for (const [src, file] of buttons) {
            if (file !== currentFile) await page.goto(origins[1] + pageURL(file));
            currentFile = file;
            const menu = page.locator('a > img[src="' + src + '"]').first();
            const expected = src.replace(/\.GIF$/i, '_A.GIF');
            await menu.hover();
            assert.ok((await menu.evaluate(img => getComputedStyle(img).content)).includes(expected), src + ': hover');
            await page.mouse.move(0, 0);
            await page.keyboard.press('Tab');
            await menu.locator('..').focus();
            assert.ok((await menu.evaluate(img => getComputedStyle(img).content)).includes(expected), src + ': keyboard focus');
        }
        assert.deepEqual(errors, [], 'navigation must not call removed legacy scripts');
        console.log(`PASS ${buttons.size} original GIF buttons: hover and keyboard focus; legacy redirects preserve query/hash`);

        const offline = await browser.newPage();
        await offline.route('**/*', route => new URL(route.request().url()).origin === origins[1] ? route.continue() : route.abort());
        await offline.goto(origins[1] + '/');
        await offline.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active), {}, { timeout: 10000 });
        assert.ok(await offline.evaluate(async () => Boolean(await caches.match('/'))), 'the shared registration must install the offline homepage');
        console.log('PASS shared service-worker registration and offline homepage cache');
    } finally {
        await browser.close();
        await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
