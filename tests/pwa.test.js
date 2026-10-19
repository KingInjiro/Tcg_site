const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { websiteFiles } = require('../lib/site-export');
const { cleanWebsite, pageFiles, outputFile } = require('../lib/site-routes');
const root = path.resolve(__dirname, '..');
const version = files => JSON.parse(files.get('site-version.json')).version;

test('online export versions every page and CSS/JS without PWA installation or offline resources', () => {
    const files = new Map(websiteFiles(root).map(file => [file.path, file.content]));
    const revision = version(files);
    for (const file of pageFiles(root)) {
        const html = files.get(outputFile(file)).toString();
        assert.doesNotMatch(html, /rel=["']manifest["']/);
        assert.ok(html.includes('src="/themes/navigation.js?v=' + revision + '"'));
        assert.ok(html.includes('<meta name="tcg-build" content="' + revision + '">'));
    }
    assert.equal(files.has('manifest.json'), false);
    assert.equal(files.has('themes/offline.html'), false);
    assert.deepEqual(files.get('sw.js'), fs.readFileSync(path.join(root, 'sw.js')));
    assert.doesNotMatch(files.get('themes/service-worker.js').toString(), /\.register\s*\(|TCG_WARM_CACHE/);
    assert.ok(files.has('contacts.html'), 'old links remain available');
    assert.ok(files.has('contacts/index.html'), 'directory URLs need no rewrite module');
});

test('online publication revision changes with page/assets and indexes new constructor pages', () => {
    const source = new Map([
        ['index.html', Buffer.from('<html><head><title>Home</title></head><body>Home</body></html>')],
        ['themes/site.css', Buffer.from('body{color:black}')],
        ['sw.js', fs.readFileSync(path.join(root, 'sw.js'))],
    ]);
    const first = version(cleanWebsite(source));
    assert.equal(version(cleanWebsite(source)), first);
    source.set('themes/site.css', Buffer.from('body{color:navy}'));
    assert.notEqual(version(cleanWebsite(source)), first);
    source.set('new-page.html', Buffer.from('<html><head><title>New</title></head><body>New</body></html>'));
    const updated = cleanWebsite(source);
    assert.ok(updated.has('new-page/index.html'));
    assert.ok(updated.get('themes/search-index.json').includes('/new-page/'));
});

test('retirement worker has no fetch handler and removes only TCG caches and its own registration without navigating clients', async () => {
    const handlers = new Map(), deleted = [], messages = []; let skipped = false, unregistered = false, claimed = false;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), {
        self: {
            addEventListener: (type, fn) => handlers.set(type, fn),
            skipWaiting: async () => { skipped = true; },
            registration: { unregister: async () => { unregistered = true; return true; } },
            clients: { claim: async () => { claimed = true; }, matchAll: async () => [{ postMessage: msg => messages.push(msg.type), navigate: () => assert.fail('unsaved documents must not be navigated by the worker') }] },
        },
        caches: { keys: async () => ['tgroup-pwa-old', 'other-application', 'tgroup-pwa-new'], delete: async key => { deleted.push(key); return true; } },
    });
    assert.deepEqual([...handlers.keys()].sort(), ['activate', 'install']);
    for (const type of ['install', 'activate']) { let done; handlers.get(type)({ waitUntil: promise => { done = promise; } }); await done; }
    assert.ok(skipped && claimed && unregistered);
    assert.deepEqual(deleted, ['tgroup-pwa-old', 'tgroup-pwa-new']);
    assert.deepEqual(messages, ['TCG_PWA_RETIRED', 'TCG_UPDATE']);
});

test('re-exported HTML receives current owned CSS/JS versions and one build marker/helper', () => {
    const source = new Map([
        ['index.html', Buffer.from('<html><head><meta name="tcg-build" content="old"><link rel="stylesheet" href="/themes/site.css?v=old"><script src="/themes/service-worker.js?v=old" defer></script></head><body>Home</body></html>')],
        ['themes/site.css', Buffer.from('body{color:black}')],
        ['themes/service-worker.js', fs.readFileSync(path.join(root, 'themes/service-worker.js'))],
        ['sw.js', fs.readFileSync(path.join(root, 'sw.js'))],
    ]);
    const result = cleanWebsite(source), html = result.get('index.html').toString();
    assert.ok(html.includes('/themes/site.css?v=' + version(result)));
    assert.doesNotMatch(html, /\?v=old/);
    assert.equal((html.match(/name="tcg-build"/g) || []).length, 1);
    assert.equal((html.match(/src="\/themes\/service-worker.js/g) || []).length, 1);
});
