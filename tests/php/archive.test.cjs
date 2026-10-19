const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { packagePHP } = require('../../scripts/package-php');
const { readZip } = require('../zip-reader.cjs');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
test('Ready PHP ZIP: public root, private activation sidecar, complete owned files and local dependencies', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-archive-test-')); t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const release = process.env.TCG_PHP_ZIP ? { archivePath: process.env.TCG_PHP_ZIP, activationPath: process.env.TCG_ACTIVATION_KEY_FILE } : packagePHP(temporary);
    const key = fs.readFileSync(release.activationPath, 'utf8').split('\n').find(line => /^[A-Za-z0-9_-]{43}$/.test(line)); assert.ok(key);
    const files = readZip(fs.readFileSync(release.archivePath));
    const config = JSON.parse(Buffer.from(files.get('admin/_app/release.php').toString().match(/base64_decode\('([^']+)'/)[1], 'base64'));
    assert.equal(config.activationHash, hash(key));
    for (const [file, sha] of Object.entries({ ...config.staticFiles, ...config.managed })) assert.equal(hash(files.get(file)), sha, file + ': hash');
    for (const name of ['index.html', 'contacts/index.html', 'contacts.html', 'sw.js', 'site-version.json', 'INSTALL.txt', 'admin/index.html', 'admin/api.php', 'admin/contact.php', 'admin/diagnostic.php', 'admin/_app/Environment.php', 'admin/_app/Publisher.php', 'admin/_app/vendor/phpmailer/LICENSE', 'admin/vendor/grapes.min.js', 'admin/vendor/grapes.min.css']) assert.ok(files.has(name), name);
    assert.deepEqual(JSON.parse(files.get('themes/contact-config.json')), { endpoint: '/admin/contact.php' });
    let bytes = 0;
    for (const [name, data] of files) {
        assert.ok(!/(^|\/)(?:\.git|node_modules|tests|dist|exports|\.env|\.tcg-editor|\.tcg-[a-f0-9]+)(?:\/|$)/.test(name), name);
        assert.ok(!/(?:activation\.txt|owner\.json|mail\.json|state\.json|attempts\.json)$/.test(name), name);
        assert.ok(!data.includes(Buffer.from(key)), 'activation key stays outside ZIP');
        if (name.endsWith('.php')) assert.ok(/^admin\/(?:api|contact|diagnostic)\.php$/.test(name) || name.startsWith('admin/_app/'), name);
        bytes += data.length;
    }
    assert.ok(bytes < 40 * 1024 * 1024, 'small-hosting release has room for private snapshots and publication');
});
