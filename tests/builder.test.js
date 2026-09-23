const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { GitHub, isPage, isProject, validateChanges } = require('../admin/repository');
const { createLocalEditor } = require('../lib/editor-local');
const { createApp } = require('../server');
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const changes = [{ path: 'hello.html', content: '<html><body>Привіт</body></html>', encoding: 'utf-8' }, { path: '.tcg-editor/hello.html.json', content: '{"version":1}', encoding: 'utf-8' }];

test('editor limits writes to pages, project metadata and uploaded raster images', () => {
    for (const name of ['hello.html', 'Docs/rp21q1.html', 'ListPage/Pege01.html']) assert.ok(isPage(name));
    for (const name of ['../index.html', 'admin/index.html', 'test_admin.html', 'temp.html', 'api/auth.js', '.env', 'x/y.html', 'Docs/../../server.js']) assert.ok(!isPage(name));
    assert.ok(isProject('.tcg-editor/Docs/rp21q1.html.json'));
    validateChanges(changes);
    for (const name of ['.github/workflows/deploy.yml', 'server.js', '../new.html', 'images/editor/attack.svg', '.tcg-editor/../x.json']) {
        assert.throws(() => validateChanges([{ path: name, content: 'bad', encoding: 'utf-8' }]));
    }
    assert.throws(() => validateChanges([changes[0], { ...changes[0], path: 'HELLO.html' }]));
    assert.throws(() => validateChanges([{ ...changes[0], content: 'x'.repeat(8000001) }]));
});

test('GitHub publishing creates one atomic commit for HTML and project data', async () => {
    const requests = [];
    const responses = [
        { object: { sha: 'head-1' } }, { tree: { sha: 'tree-1' } }, { tree: [{ path: 'index.html', type: 'blob', mode: '100644', sha: 'blob-1' }, { path: 'symlink.html', type: 'blob', mode: '120000', sha: 'blob-2' }] },
        { encoding: 'base64', content: Buffer.from('Привіт').toString('base64') },
        { object: { sha: 'head-1' } }, { sha: 'tree-2' }, { sha: 'head-2' }, { object: { sha: 'head-2' } },
    ];
    const github = new GitHub('private-token', async (url, options) => { requests.push({ url, ...options, body: options.body && JSON.parse(options.body) }); return json(responses.shift()); });
    const list = await github.list();
    assert.equal(list.files.length, 1, 'symlinks must not appear as editable pages');
    assert.equal(await github.read('index.html'), 'Привіт');
    assert.equal(await github.read('absent.html'), null);
    const result = await github.publish(changes);
    assert.equal(result.head, 'head-2');
    const tree = requests.find(request => request.url.endsWith('/git/trees'));
    assert.equal(tree.body.base_tree, 'tree-1');
    assert.deepEqual(tree.body.tree.map(file => file.path), changes.map(file => file.path));
    const commit = requests.find(request => request.url.endsWith('/git/commits') && request.method === 'POST');
    assert.deepEqual(commit.body.parents, ['head-1']);
    const ref = requests.at(-1);
    assert.equal(ref.method, 'PATCH');
    assert.deepEqual(ref.body, { sha: 'head-2', force: false });
    assert.ok(requests.every(request => request.url.startsWith('https://api.github.com/repos/KingInjiro/Tcg_site/')));
    assert.ok(!JSON.stringify(result).includes('private-token'));
});

test('GitHub rejects concurrent edits before writing and does not force a racing update', async () => {
    let calls = 0;
    const stale = new GitHub('token', async () => { calls++; return json({ object: { sha: 'newer' } }); });
    stale.head = 'old';
    await assert.rejects(stale.publish(changes), /Сайт змінився/);
    assert.equal(calls, 1);
    const responses = [{ object: { sha: 'old' } }, { sha: 'tree-next' }, { sha: 'commit-next' }, { error: 'race' }];
    const raced = new GitHub('token', async () => { const body = responses.shift(); return json(body, body.error ? 422 : 200); });
    raced.head = 'old'; raced.tree = 'tree-old';
    await assert.rejects(raced.publish(changes), /Сайт змінився/);
    assert.equal(raced.head, 'old');
    assert.equal(responses.length, 0, 'no force retry');
});

test('truncated GitHub tree and expired authentication fail closed', async () => {
    const truncated = new GitHub('token', async url => json(url.includes('/git/ref/') ? { object: { sha: 'head' } } : url.includes('/git/commits/') ? { tree: { sha: 'tree' } } : { truncated: true, tree: [] }));
    await assert.rejects(truncated.list(), /неповний список/);
    const expired = new GitHub('token', async () => json({}, 401));
    await assert.rejects(expired.list(), /Вхід закінчився/);
});

async function serve(t, app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return 'http://127.0.0.1:' + server.address().port;
}

test('local editor creates discoverable pages and rejects conflicts, cross-site writes and symlinks', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-editor-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'index.html'), '<html><body>Original</body></html>');
    const app = express(); app.use(express.json()); app.use('/api/editor-local', createLocalEditor(root));
    const origin = await serve(t, app);
    const listing = await fetch(origin + '/api/editor-local?action=tree').then(response => response.json());
    const publish = (body, override = {}) => fetch(origin + '/api/editor-local', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...override }, body: JSON.stringify(body) });
    assert.equal((await publish({ head: listing.head, changes }, { Origin: 'https://evil.example' })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
        const req = require('node:http').get(origin + '/api/editor-local?action=tree', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
    });
    assert.equal(badHost, 403);
    assert.equal((await publish({ head: listing.head, changes })).status, 200);
    assert.equal(fs.readFileSync(path.join(root, 'hello.html'), 'utf8'), changes[0].content);
    assert.equal(fs.readFileSync(path.join(root, '.tcg-editor/hello.html.json'), 'utf8'), changes[1].content);
    assert.equal((await publish({ head: listing.head, changes })).status, 409);
    const next = await fetch(origin + '/api/editor-local?action=tree').then(response => response.json());
    assert.ok(next.files.some(file => file.path === 'hello.html'));
    fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'symlink.html'));
    const response = await publish({ head: next.head, changes: [{ ...changes[0], path: 'symlink.html' }] });
    assert.equal(response.status, 400);
    assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), '<html><body>Original</body></html>');
    assert.equal((await fetch(origin + '/api/editor-local?action=read&path=../server.js')).status, 400);
});

test('local write API and private editor data are unavailable in production', async t => {
    const origin = await serve(t, createApp());
    for (const path of ['/api/editor-local?action=tree', '/.tcg-editor/index.html.json']) assert.equal((await fetch(origin + path)).status, 404);
    assert.equal((await fetch(origin + '/api/editor-local', { method: 'POST' })).status, 404);
});
