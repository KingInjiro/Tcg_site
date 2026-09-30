const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const routes = require('../themes/routes');
const { sourcePages, searchIndex } = require('../lib/published-site');
const { build } = require('../scripts/build');
const { createApp } = require('../server');
const root = path.resolve(__dirname, '..');

test('published pages, all local links, images and fragment targets exist in a plain static build', () => {
    const output = build(), pages = sourcePages(root), cache = new Map();
    const document = name => {
        if (!cache.has(name)) cache.set(name, load(fs.readFileSync(name, 'utf8')));
        return cache.get(name);
    };
    for (const file of pages) {
        const $ = document(path.join(output, routes.entryPath(file)));
        assert.equal($('main').length, 1, file);
        assert.equal($('main h1').length, 1, file);
        assert.equal($('iframe,object,applet,font,v\\:imagedata').length, 0, file);
        assert.equal($('link[rel="canonical"]').attr('href'), routes.url(file));
        $('a[href],img[src],link[href],script[src]').each((_, element) => {
            const value = $(element).attr('href') || $(element).attr('src');
            const url = new URL(value, 'https://site.invalid' + routes.url(file));
            if (url.origin !== 'https://site.invalid') return;
            const target = path.join(output, decodeURIComponent(url.pathname), url.pathname.endsWith('/') ? 'index.html' : '');
            assert.ok(fs.existsSync(target), file + ': ' + value);
            if (url.hash) {
                const id = decodeURIComponent(url.hash.slice(1)), doc = document(target);
                assert.ok(doc('[id],[name]').toArray().some(node => doc(node).attr('id') === id || doc(node).attr('name') === id), file + ': missing ' + value);
            }
            if (element.name === 'a') assert.ok(!/\.html?$/i.test(url.pathname), file + ': old page link ' + value);
        });
    }
    assert.equal(searchIndex(root).length, pages.length - 4);
});

test('old filenames and directory aliases redirect without losing the query', async t => {
    const server = createApp().listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const file of sourcePages(root)) {
        const canonical = routes.url(file);
        for (const alias of ['/' + file, '/' + file.replace(/\.html$/i, '.htm').toUpperCase(), canonical + 'index.html']) {
            const response = await fetch(origin + alias + '?from=old', { redirect: 'manual' });
            assert.equal(response.status, 308, alias);
            assert.equal(response.headers.get('location'), canonical + '?from=old');
        }
        assert.equal((await fetch(origin + canonical)).status, 200, canonical);
    }
    for (const file of ['admin.html', 'api.html', 'documents.html', 'articles.html', 'INDEX.html']) assert.equal(routes.available(file, sourcePages(root)), false, file);
    assert.equal(routes.available('new-service.html', sourcePages(root)), true);
});

test('readable contracts retain the original document text and recovered CHMs keep their verified bytes', () => {
    for (const [source, file] of [['Doc1CBase.xml', 'contract-1c.html'], ['DocCompStand.xml', 'contract-computers.html'], ['Doc1CFackt.xml', 'contract-consulting.html']]) {
        const $ = load(fs.readFileSync(path.join(root, 'Docs', source), 'utf8'), { xml: true });
        $('w\\:sectPr').remove();
        const expected = $('w\\:body w\\:t').map((_, node) => $(node).text()).get().join('').replace(/\s/g, '');
        const page = load(fs.readFileSync(path.join(root, 'Docs', file), 'utf8'));
        assert.equal(page('.document-content').text().replace(/\s/g, ''), expected, file);
    }
    const crypto = require('node:crypto');
    for (const [file, hash] of [['UniversTCG.chm', 'c844fe0069795e4e124e8308db4a791755b9053057b8206f5b7e145a1defdc7a'], ['NalogNaReklTCG.chm', '91605c43ed7ebd782ced652a00bcaedaad79cd81290ba4dfcf6a05d11c1923cb']]) {
        assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'Docs', file))).digest('hex'), hash);
    }
});
