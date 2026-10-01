const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { exportWebsite } = require('../lib/site-export');
const { createLocalEditor } = require('../lib/editor-local');
const { createApp } = require('../server');
const { Local } = require('../admin/repository');
const { readZip } = require('./zip-reader.cjs');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-export-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = {
        'index.html': '<html><body>Збережена сторінка</body></html>',
        'New.html': '<html><body>Нова</body></html>',
        'ListPage/Article.html': '<html><body>Стаття</body></html>',
        'images/editor/photo.png': Buffer.from([0, 255, 128, 127]),
        'Docs/Документ.txt': 'Документ — українською',
        'Docs/Sno_for_Buh_ua.ert': Buffer.from('d0cf11e0a1b11ae1', 'hex'),
        'Docs/Sno_for_Buh_ua.html': Buffer.from([0, 1, 2]),
        'Docs/missing.html': '<html><head><title>404 Not Found</title></head><body>The requested URL was not found</body></html>',
        'themes/navigation.css': 'a:hover{color:yellow}',
        '.env': 'SECRET_MUST_STAY_LOCAL',
        'server.js': 'PRIVATE_SERVER',
        'admin/index.html': '<html><body>Private editor</body></html>',
        '.tcg-editor/index.html.json': '{"private":"project"}',
        'images/.secret': 'HIDDEN',
        'images/.private/data.txt': 'HIDDEN_DIRECTORY',
    };
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), content);
    }
    return { root, files };
}
async function serve(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return 'http://127.0.0.1:' + server.address().port;
}

test('portable ZIP contains byte-identical public files, UTF-8 names and legacy URLs; excludes private/invalid content', t => {
    const { root, files } = fixture(t);
    fs.symlinkSync(path.join(root, '.env'), path.join(root, 'images', 'link.txt'));
    const result = exportWebsite(root);
    const archive = readZip(result.buffer);
    assert.ok(result.filename.startsWith('tcg-hosting-'));
    assert.deepEqual(fs.readFileSync(path.join(root, 'exports', result.filename)), result.buffer);
    for (const name of ['index.html', 'New.html', 'ListPage/Article.html', 'images/editor/photo.png', 'Docs/Документ.txt', 'themes/navigation.css', 'Docs/Sno_for_Buh_ua.ert']) assert.deepEqual(archive.get(name), Buffer.from(files[name]), name);
    for (const name of ['index', 'New', 'ListPage/Article']) assert.deepEqual(archive.get(name + '.htm'), archive.get(name + '.html'));
    assert.match(archive.get('Docs/Sno_for_Buh_ua.html').toString(), /href="Sno_for_Buh_ua.ert" download/);
    for (const name of ['.env', 'server.js', 'admin/index.html', '.tcg-editor/index.html.json', 'Docs/missing.html', 'images/.secret', 'images/.private/data.txt', 'images/link.txt']) assert.ok(!archive.has(name), name);
    for (const [name, content] of Object.entries(files)) assert.deepEqual(fs.readFileSync(path.join(root, name)), Buffer.from(content), 'source unchanged: ' + name);
    assert.ok(![...archive.values()].some(data => data.includes('SECRET_MUST_STAY_LOCAL')));
});

test('export refuses a symlink output directory and never follows it', t => {
    const { root } = fixture(t);
    fs.symlinkSync(path.join(root, 'images'), path.join(root, 'exports'), 'dir');
    assert.throws(() => exportWebsite(root), /символічним/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'images')).sort(), ['.private', '.secret', 'editor']);
});

test('local export requires same-origin POST, detects stale snapshots and serves current saved content only', async t => {
    const { root } = fixture(t);
    const app = express(); app.use(express.json()); app.use('/api/editor-local', createLocalEditor(root));
    const origin = await serve(t, app);
    const head = (await fetch(origin + '/api/editor-local?action=tree').then(r => r.json())).head;
    const request = (body, headers = {}) => fetch(origin + '/api/editor-local?action=export', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(body),
    });
    assert.equal((await fetch(origin + '/api/editor-local?action=export')).status, 405);
    assert.equal((await request({ head }, { Origin: 'https://foreign.example' })).status, 403);
    assert.equal((await request({ head }, { Origin: '' })).status, 403);
    assert.equal((await request({ head }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await request({ head: 'stale' })).status, 409);
    assert.ok(!fs.existsSync(path.join(root, 'exports')));
    const local = new Local((url, options) => fetch(origin + url, { ...options, headers: { ...options?.headers, Origin: origin } }));
    await local.list();
    await local.publish([{ path: 'new-page.html', content: '<html><body>Найновіша зміна</body></html>', encoding: 'utf-8' }]);
    const result = await local.export();
    assert.equal(result.blob.type, 'application/zip');
    assert.match(readZip(Buffer.from(await result.blob.arrayBuffer())).get('new-page.html').toString(), /Найновіша зміна/);
    const latest = await fetch(origin + '/api/editor-local?action=tree').then(r => r.json());
    assert.equal(latest.head, local.head, 'export itself does not change editor snapshot');
    fs.appendFileSync(path.join(root, 'index.html'), '<!-- concurrent -->');
    await assert.rejects(local.export(), /Сайт змінився/);
    assert.equal(fs.readdirSync(path.join(root, 'exports')).length, 1, 'no stale ZIP');
    fs.mkdirSync(path.join(root, 'dist'));
    const production = await serve(t, createApp({ root }));
    assert.equal((await fetch(production + '/api/editor-local?action=export', { method: 'POST' })).status, 404);
    assert.equal((await fetch(production + '/exports/' + result.filename)).status, 404);
});
