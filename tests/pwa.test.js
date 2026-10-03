const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { websiteFiles } = require('../lib/site-export');
const { cleanWebsite, pageFiles, outputFile, pageURL } = require('../lib/site-routes');
const root = path.resolve(__dirname, '..');
const config = files => JSON.parse(files.get('sw.js').toString().match(/^self\.TCG_PWA = (.+);$/m)[1]);

test('PWA export covers every public page and asset without editor/API/private data', () => {
    const files = new Map(websiteFiles(root).map(file => [file.path, file.content]));
    const worker = config(files);
    for (const file of pageFiles(root)) {
        assert.ok(worker.urls.includes(pageURL(file)), file);
        const html = files.get(outputFile(file)).toString();
        assert.match(html, /rel="manifest" href="\/manifest.json"/);
        assert.match(html, /src="\/themes\/navigation.js"/);
    }
    assert.equal(worker.aliases['/contacts.html'], '/contacts/');
    assert.ok(worker.urls.includes('/themes/search-index.json'));
    assert.ok(!worker.urls.some(url => /^\/(?:api|admin|\.tcg-editor)(?:\/|$)/.test(url) || url.includes('contact-config')));
    for (const url of worker.urls) {
        const file = decodeURI(url).slice(1) + (url.endsWith('/') ? 'index.html' : '');
        assert.ok(files.has(file), 'precache target must exist: ' + url);
    }
    assert.equal(new Set(worker.urls).size, worker.urls.length);
});

test('offline cache revision changes with page/assets and discovers new constructor pages', () => {
    const source = new Map([
        ['index.html', Buffer.from('<html><head><title>Home</title></head><body>Home</body></html>')],
        ['themes/site.css', Buffer.from('body{color:black}')],
        ['sw.js', fs.readFileSync(path.join(root, 'sw.js'))],
    ]);
    const first = config(cleanWebsite(source));
    assert.equal(config(cleanWebsite(source)).version, first.version);
    source.set('themes/site.css', Buffer.from('body{color:navy}'));
    assert.notEqual(config(cleanWebsite(source)).version, first.version);
    source.set('new-page.html', Buffer.from('<html><head><title>New</title></head><body>New</body></html>'));
    const updated = cleanWebsite(source);
    assert.ok(config(updated).urls.includes('/new-page/'));
    assert.ok(updated.get('themes/search-index.json').includes('/new-page/'));
});
