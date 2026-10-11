const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');
const { getHeader, applyHeader } = require('../themes/shared-header');
const { pageFiles, publishHTML } = require('../lib/site-routes');
const root = path.resolve(__dirname, '..');
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
function find(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.childNodes || []) { const result = find(child, predicate); if (result) return result; }
}

test('all pages share the homepage header without changing their main content', () => {
    const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), header = getHeader(home);
    const pages = pageFiles(root);
    assert.ok(header.html.includes('aria-label="Основная навигация"'));
    for (const file of pages) {
        const html = fs.readFileSync(path.join(root, file), 'utf8'), normalized = applyHeader(html, header);
        assert.ok(getHeader(normalized).html === header.html, file + ': identical header');
        assert.ok(applyHeader(normalized, header) === normalized, file + ': idempotent normalization');
        const before = parse5.parse(html), after = parse5.parse(normalized);
        const main = doc => find(doc, node => attr(node, 'role') === 'main' || node.tagName === 'main');
        if (main(before)) assert.ok(parse5.serialize(main(before)) === parse5.serialize(main(after)), file + ': article, prices, forms and widgets unchanged');
        assert.ok(!find(after, node => node.tagName === 'img' && /UP_CMP_-1-010_GBTN\.GIF$/i.test(attr(node, 'src') || '')), file + ': yellow Up button is removed');
        const up = find(before, node => node.tagName === 'a' && find(node, image => image.tagName === 'img' && attr(image, 'alt') === 'Вверх' && !/_GBTN\.GIF$/i.test(attr(image, 'src') || '')));
        if (up) assert.ok(find(after, node => node.tagName === 'a' && attr(node, 'href') === attr(up, 'href') && find(node, image => image.tagName === 'img' && attr(image, 'alt') === 'Вверх')), file + ': section parent remains reachable');
        const published = publishHTML(html, file, pages, header);
        assert.equal((published.match(/class="site-header"/g) || []).length, 1, file + ': one shared header');
    }
});

test('a homepage edit propagates to nested pages and newly created pages', () => {
    const home = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const header = getHeader(home.replace('4005850', '1234567'));
    for (const html of [fs.readFileSync(path.join(root, 'ListPage/Pege05.html'), 'utf8'), '<!doctype html><html><head><title>New</title></head><body><main><h1>New</h1></main></body></html>']) {
        const output = applyHeader(html, header);
        assert.ok(getHeader(output).html.includes('1234567'));
        assert.ok(!getHeader(output).html.includes('4005850'));
        assert.ok(output.includes('href="/themes/navigation.css"'));
    }
});
