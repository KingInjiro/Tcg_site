// Exercise the online editor without sending any real GitHub writes or mail.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { createApp } = require('../server');
(async () => {
    const root = path.resolve(__dirname, '..'), base = 'a'.repeat(40), head = 'b'.repeat(40);
    const app = express();
    app.get('/api/auth', (_req, res) => res.type('html').send('<script>opener.postMessage(\'authorization:github:success:{"token":"test-token"}\',location.origin)</script>'));
    app.post('/api/mail-status', (req, res) => { assert.equal(req.headers.authorization, 'Bearer test-token'); res.json({ ok: true, message: 'З’єднання перевірене; листів не надсилали.' }); });
    app.use(createApp());
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.TCG_BROWSER_EXECUTABLE || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
        const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } }), page = await context.newPage();
        let main = base, branch, entries = [{ path: 'index.html', type: 'blob', mode: '100644', sha: 'original' }], committed = new Map(), released = false, checks = 'in_progress';
        const errors = [], writes = [];
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin === origin || /^(data|blob):/.test(url.protocol)) return route.continue();
            if (url.origin !== 'https://api.github.com') return route.abort();
            const endpoint = url.pathname.replace('/repos/KingInjiro/Tcg_site', ''), body = request.postDataJSON();
            let result;
            if (request.method() === 'POST') writes.push({ endpoint, body });
            if (endpoint === '/git/ref/heads/main') result = { object: { sha: main } };
            else if (endpoint.startsWith('/git/commits/') && request.method() === 'GET') result = { tree: { sha: 'tree' } };
            else if (endpoint.startsWith('/git/trees/') && request.method() === 'GET') result = { tree: entries };
            else if (endpoint.startsWith('/git/blobs/')) result = { encoding: 'base64', content: Buffer.from(committed.get(endpoint.split('/').pop()) || fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toString('base64') };
            else if (endpoint === '/git/trees') {
                for (const file of body.tree) { committed.set(file.path, file.content); entries = entries.filter(entry => entry.path !== file.path); entries.push({ ...file, sha: file.path }); }
                result = { sha: 'new-tree' };
            } else if (endpoint === '/git/commits') result = { sha: head };
            else if (endpoint === '/git/refs') { branch = body.ref.replace('refs/heads/', ''); result = { object: { sha: head } }; }
            else if (endpoint.endsWith('/statuses')) result = released ? [{ context: 'TCG publication', state: 'success', target_url: 'https://github.com/test/run' }] : [];
            else if (endpoint.endsWith('/runs')) result = { workflow_runs: [{ head_sha: head, head_branch: branch, status: checks, conclusion: checks === 'completed' ? 'failure' : null, html_url: 'https://github.com/test/check' }] };
            else throw new Error('Unexpected GitHub request: ' + request.method() + ' ' + endpoint);
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
        });
        const login = async () => { await page.goto(origin + '/admin/'); await page.locator('#login').click(); await page.waitForFunction(() => !document.getElementById('app').hidden && document.getElementById('current-path').textContent === '/'); };
        await login();
        await page.locator('#check-mail').click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('листів не надсилали'));
        await page.locator('#page-title').fill('Перевірена публікація');
        await page.locator('#publish').click();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Тривають перевірки'));
        assert.equal(main, base); assert.equal(writes.filter(write => write.endpoint === '/git/refs').length, 1);
        assert.ok(writes.every(write => !write.endpoint.includes('/heads/main')));
        assert.equal(await page.locator('#publish').isDisabled(), true);
        assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('test-token'));
        // Closing/reopening restores the saved candidate, not the older public main.
        await login();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Тривають перевірки'));
        assert.equal(await page.locator('#page-title').inputValue(), 'Перевірена публікація');
        checks = 'completed';
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('перевірки не пройдено'), {}, { timeout: 15000 });
        assert.equal(main, base);
        await page.locator('#page-title').fill('Виправлена публікація');
        assert.equal(await page.locator('#publish').isEnabled(), true);
        // Simulate a successful server-side retry; the editor must clear only metadata.
        page.once('dialog', dialog => dialog.accept()); released = true; main = head;
        await login();
        await page.waitForFunction(() => document.getElementById('status').textContent.includes('Перевірки пройдено'));
        assert.equal(await page.evaluate(() => localStorage.getItem('tcg-publication')), null);
        assert.deepEqual(errors, []);
        console.log('PASS browser: online publish stages a draft, resumes after reload, reports failed checks and final handoff, checks mail without sending');
    } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
