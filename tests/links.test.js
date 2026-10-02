const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');
const { websiteFiles } = require('../lib/site-export');
const { pageFiles, outputFile, pageURL } = require('../lib/site-routes');
const root = path.resolve(__dirname, '..');
function walk(node, visit) { visit(node); for (const child of node.childNodes || []) walk(child, visit); }
test('all public pages have working local links, fragments and download targets in the static export', () => {
    const files = new Map(websiteFiles(root).map(file => [file.path, file.content])), ids = new Map();
    function anchors(file) {
        if (!ids.has(file)) {
            const found = new Set();
            walk(parse5.parse(files.get(file).toString('utf8'), { scriptingEnabled: false }), node => {
                for (const attr of node.attrs || []) if (attr.name === 'id' || (node.tagName === 'a' && attr.name === 'name')) found.add(attr.value);
            }); ids.set(file, found);
        }
        return ids.get(file);
    }
    let links = 0, fragments = 0;
    for (const file of pageFiles(root)) {
        const doc = parse5.parse(files.get(outputFile(file)).toString('utf8'), { scriptingEnabled: false });
        walk(doc, node => {
            if (!['a', 'area'].includes(node.tagName)) return;
            const href = node.attrs.find(attr => attr.name === 'href')?.value;
            if (!href) return;
            const url = new URL(href, 'https://tcg.invalid' + pageURL(file));
            if (!['tcg.invalid', 'www.tcg.com.ua', 'tcg.com.ua'].includes(url.hostname)) return;
            let target = decodeURIComponent(url.pathname).slice(1);
            if (!target || target.endsWith('/')) target += 'index.html';
            assert.ok(files.has(target), file + ' → missing ' + href); links++;
            if (url.hash && /\.html?$/i.test(target)) {
                assert.ok(anchors(target).has(decodeURIComponent(url.hash.slice(1))), file + ' → missing fragment ' + href); fragments++;
            }
        });
    }
    console.log('Checked ' + links + ' local link placements and ' + fragments + ' fragment placements across ' + pageFiles(root).length + ' pages');
    for (const [name, content] of files) {
        if (name.endsWith('.chm')) assert.equal(content.subarray(0, 4).toString(), 'ITSF', name);
        if (name.endsWith('.ert')) assert.equal(content.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', name);
    }
});
