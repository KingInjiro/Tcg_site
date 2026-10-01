const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');
const { pageURL, outputFile, publishHTML, routeMap, pageFiles } = require('../lib/site-routes');
const { createApp } = require('../server');
const root = path.resolve(__dirname, '..');

test('page addresses retain their names and accept legacy case/extensions', () => {
    assert.equal(pageURL('index.html'), '/');
    assert.equal(pageURL('contacts.html'), '/contacts/');
    assert.equal(pageURL('ListPage/Pege01.html'), '/ListPage/Pege01/');
    assert.equal(outputFile('new-page.html'), 'new-page/index.html');
    const routes = routeMap(['index.html', 'contacts.html', 'ListPage/Pege01.html']);
    for (const url of ['/contacts', '/contacts/', '/contacts.html', '/contacts.htm', '/CONTACTS.HTM', '/contacts/index.html']) {
        assert.equal(routes.get(url.toLowerCase()).url, '/contacts/');
    }
    assert.equal(routes.has('/admin/index.html'), false);
});

test('publishing rewrites page links and relative assets, preserving downloads, scripts, query strings and anchors', () => {
    const html = '<!doctype html><html><head><title>Тест</title><style>p{background:url(../images/photo.png)}</style></head><body>' +
        '<a href="../CONTACTS.HTM?from=article#phone">Контакти</a><a href="#part">Тут</a><a href="../Docs/file.zip">ZIP</a>' +
        '<a href="https://example.com/page.html">Зовнішня</a><img src="../images/photo.png">' +
        '<img srcset="data:image/png;base64,aabbcc"><script>const old="contacts.html";</script></body></html>';
    const output = publishHTML(html, 'ListPage/Article.html', ['index.html', 'contacts.html', 'ListPage/Article.html']);
    assert.match(output, /href="\/contacts\/\?from=article#phone"/);
    assert.match(output, /href="#part"/);
    assert.match(output, /href="\/Docs\/file.zip"/);
    assert.match(output, /href="https:\/\/example.com\/page.html"/);
    assert.match(output, /src="\/images\/photo.png"/);
    assert.match(output, /srcset="data:image\/png;base64,aabbcc"/);
    assert.match(output, /const old="contacts.html"/);
    assert.equal(publishHTML(output, 'ListPage/Article.html', ['index.html', 'contacts.html', 'ListPage/Article.html']), output);
});

test('all source pages use HTML5, a language and UTF-8; obsolete presentational elements are gone', () => {
    const pages = pageFiles(root);
    assert.equal(pages.length, 51);
    for (const file of pages) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        const doc = parse5.parse(html);
        assert.equal(doc.mode, 'no-quirks', file);
        assert.match(html, /<html[^>]*\blang=/i, file);
        assert.match(html, /<meta charset="utf-8">/i, file);
        function check(node) {
            assert.ok(!['font', 'center', 'o:p'].includes(node.tagName), file + ': ' + node.tagName);
            for (const child of node.childNodes || []) check(child);
        }
        check(doc);
    }
});

test('local server redirects old addresses, preserves queries, serves nested pages and keeps private files inaccessible', async t => {
    const server = createApp({ dev: true }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    for (const [from, to] of [['/index.html?x=1', '/?x=1'], ['/CONTACTS.HTM?from=old', '/contacts/?from=old'], ['/contacts/index.html', '/contacts/'], ['/ListPage/Pege01.htm', '/ListPage/Pege01/']]) {
        const response = await fetch(origin + from, { redirect: 'manual' });
        assert.equal(response.status, 308);
        assert.equal(response.headers.get('location'), to);
        assert.equal((await fetch(origin + to)).status, 200);
    }
    for (const url of ['/server/', '/lib/site-routes.js', '/package.json', '/.tcg-editor/index.html.json', '/Docs/rp21q1.html']) {
        assert.equal((await fetch(origin + url)).status, 404, url);
    }
});
