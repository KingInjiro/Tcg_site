const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSearchIndex } = require('../lib/search-index');
const { search } = require('../themes/search');
const { cleanWebsite } = require('../lib/site-routes');
test('search indexes saved content, ignores scripts/forms, normalizes case and ranks titles', () => {
    const index = buildSearchIndex(new Map([
        ['ListPage/Article.html', '<html><title>Резервное копирование</title><body><div class="site-content">Учёт архивов Windows<script>secret</script><form>private</form></div></body></html>'],
        ['index.html', '<html><title>TCG</title><body>Резервное копирование архивов</body></html>'],
        ['search.html', '<html><title>Search</title></html>'],
    ]));
    assert.equal(index.length, 2);
    assert.equal(search(index, 'КОПИРОВАНИЕ')[0].url, '/ListPage/Article/');
    assert.equal(search(index, 'учет windows').length, 1);
    for (const query of ['', 'неттакогослова', 'secret', 'private']) assert.equal(search(index, query).length, 0);
});
test('static exports regenerate the index, including new pages, without exposing mail credentials', () => {
    const files = new Map([['index.html', Buffer.from('<html><title>TCG</title><body>Исходный текст</body></html>')]]);
    let output = cleanWebsite(files);
    assert.deepEqual(Object.keys(JSON.parse(output.get('themes/contact-config.json'))), ['endpoint']);
    files.set('New.html', Buffer.from('<html><title>Новое</title><body>Уникальный текст</body></html>'));
    output = cleanWebsite(files);
    assert.equal(search(JSON.parse(output.get('themes/search-index.json')), 'Уникальный')[0].url, '/New/');
});
