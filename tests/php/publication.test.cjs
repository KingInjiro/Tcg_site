const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');
const { fixture } = require('./fixture.cjs');
const { cleanWebsite, outputFile } = require('../../lib/site-routes');
const { sourceWebsiteFiles } = require('../../lib/site-export');
const root = path.resolve(__dirname, '../..');
function snapshot(html) {
    const doc = parse5.parse(html.replace(/\?v=[a-f0-9]{20}/g, ''));
    function map(node) {
        if (node.nodeName === '#documentType') return null;
        if (node.tagName === 'meta' && node.attrs.some(a => a.name === 'name' && a.value === 'tcg-build')) return null;
        if (node.nodeName === '#text') return node.value.trim() ? { text: node.value.replace(/\s+/gu, ' ').trim() } : null;
        return { tag: node.tagName || node.nodeName, attrs: (node.attrs || []).map(a => [a.name, a.value]).sort(([a], [b]) => a.localeCompare(b)), children: (node.childNodes || []).map(map).filter(Boolean) };
    } return map(doc);
}
test('M4 PHP compiler and transactional publication preserve existing documents, assets, routes and PWA', { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = f.client(); await owner.session();
    const credentials = { activationKey: f.activationKey, username: 'site-owner', password: 'Secure publication test 42' };
    assert.equal((await owner.call('setup', credentials)).status, 200); assert.equal((await owner.call('login', credentials)).status, 200);
    let head = (await owner.call('tree')).data.head;
    const published = await owner.call('publish', { head }); assert.equal(published.status, 200, published.data.error); assert.equal(published.data.published, true);
    const sources = sourceWebsiteFiles(root), expected = cleanWebsite(sources);
    for (const [file] of sources) {
        if (!/^(?:(Docs|ListPage)\/)?[\w-]+\.html?$/.test(file)) continue;
        const target = outputFile(file), actual = fs.readFileSync(path.join(f.site, target), 'utf8');
        assert.deepEqual(snapshot(actual), snapshot(expected.get(target).toString()), file + ': PHP vs Node HTML structure/content/attributes');
    }
    const index = JSON.parse(fs.readFileSync(path.join(f.site, 'themes/search-index.json')));
    assert.deepEqual(index, JSON.parse(expected.get('themes/search-index.json')), 'search index parity');
    const worker = fs.readFileSync(path.join(f.site, 'sw.js'), 'utf8');
    const config = JSON.parse(worker.match(/^self\.TCG_PWA = (.+);$/m)[1]);
    assert.equal(config.version, JSON.parse(fs.readFileSync(path.join(f.site, 'site-version.json'))).version);
    assert.ok(config.urls.includes('/contacts/')); assert.ok(!config.urls.some(url => /^\/(admin|api)\//.test(url)));
    for (const url of config.urls) assert.ok(fs.existsSync(path.join(f.site, decodeURI(url), url.endsWith('/') ? 'index.html' : '')), url);
    assert.equal((await owner.call('publish', { head })).data.version, config.version, 'unchanged publication is deterministic');
    const metadata = await owner.call('save', { head, changes: [{ path: '.tcg-editor/index.html.json', encoding: 'utf-8', content: JSON.stringify({ version: 1, test: 'project-only update' }) }] });
    assert.equal(metadata.status, 200); head = metadata.data.head;
    assert.equal((await owner.call('publish', { head })).status, 200);
    assert.equal((await owner.call('tree')).data.unpublished, false, 'project-only changes finish publication without unnecessary public writes');
    const leftover = path.join(f.privateRoot, 'transaction', 'new'); fs.mkdirSync(leftover, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(leftover, 'incomplete-staging'), 'disposable');
    assert.equal((await owner.call('publish', { head })).status, 200); assert.equal(fs.existsSync(path.join(f.privateRoot, 'transaction')), false, 'uncommitted staging leftovers are reclaimed');
    const html = '<!doctype html><html lang="uk"><head><title>Публікація</title></head><body><h1>Живий PHP сайт</h1></body></html>';
    const changed = await owner.call('save', { head, changes: [{ path: 'php-publication.html', content: html, encoding: 'utf-8' }] }); assert.equal(changed.status, 200); head = changed.data.head;
    const next = await owner.call('publish', { head }); assert.equal(next.status, 200, next.data.error); assert.notEqual(next.data.version, config.version);
    assert.match(fs.readFileSync(path.join(f.site, 'php-publication/index.html'), 'utf8'), /Живий PHP сайт/);
    const deleted = await owner.call('delete', { head, path: 'php-publication.html', confirm: 'php-publication.html' }); head = deleted.data.head;
    assert.equal((await owner.call('publish', { head })).status, 200);
    assert.equal(fs.existsSync(path.join(f.site, 'php-publication/index.html')), false); assert.equal(fs.existsSync(path.join(f.site, 'php-publication.html')), false);
    assert.equal(fs.existsSync(path.join(f.site, 'php-publication')), false, 'deleted routes cannot become directory listings');
    const tampered = path.join(f.site, 'contacts/index.html'), original = fs.readFileSync(tampered); fs.appendFileSync(tampered, '<!-- external edit -->');
    const failed = await owner.call('publish', { head }); assert.equal(failed.status, 409, 'external edits are not overwritten'); fs.writeFileSync(tampered, original);
    const digest = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    const partial = Buffer.from(original.toString().replace('</body>', '<p>Interrupted release</p></body>'));
    const stage = path.join(f.privateRoot, 'transaction'); fs.mkdirSync(path.join(stage, 'old'), { recursive: true, mode: 0o700 }); fs.mkdirSync(path.join(stage, 'new'), { mode: 0o700 });
    fs.writeFileSync(path.join(stage, 'old', digest(original)), original);
    const oldManifest = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'published.json'))), oldState = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'published-state.json')));
    fs.writeFileSync(path.join(f.privateRoot, 'publication.json'), JSON.stringify({ phase: 'applying', files: { 'contacts/index.html': digest(original) }, next: { 'contacts/index.html': digest(partial) }, oldManifest, oldState }));
    fs.writeFileSync(tampered, partial);
    assert.equal((await owner.call('tree')).status, 200, 'next authorized request recovers an interrupted publication');
    assert.deepEqual(fs.readFileSync(tampered), original); assert.equal(fs.existsSync(stage), false); assert.equal(fs.existsSync(path.join(f.privateRoot, 'publication.json')), false);
    if (process.getuid?.() !== 0) {
        const unchangedHome = fs.readFileSync(path.join(f.site, 'index.html'));
        const parent = path.dirname(tampered), mode = fs.statSync(parent).mode; fs.chmodSync(parent, 0o500);
        try { assert.equal((await owner.call('publish', { head })).status, 503); assert.deepEqual(fs.readFileSync(path.join(f.site, 'index.html')), unchangedHome); }
        finally { fs.chmodSync(parent, mode); }
    }
});
