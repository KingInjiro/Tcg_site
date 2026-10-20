const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture, php } = require('./fixture.cjs');

test('Account-scoped open_basedir: session, activation, edit, publish and restore', { timeout: 60000 }, async t => {
    const f = await fixture(t, { openBasedir: true }), owner = f.client(), visitor = f.client();
    const probe = path.join(f.site, 'fixture-basedir.php');
    fs.writeFileSync(probe, '<?php echo json_encode(["restricted" => ini_get("open_basedir") === dirname(__DIR__)]);');
    assert.equal((await visitor.call('', undefined, { rawPath: '/fixture-basedir.php' })).data.restricted, true, 'real PHP request has an account-only restriction');
    fs.unlinkSync(probe);
    const session = await owner.session();
    assert.equal(session.status, 200, 'session must not probe /tmp or other ancestors outside open_basedir');
    assert.equal(session.data.setupRequired, true);
    assert.equal(fs.statSync(f.privateRoot).mode & 0o777, 0o700);
    assert.equal(path.dirname(f.privateRoot), path.dirname(f.site));
    assert.equal(f.privateRoot.startsWith(f.site + '/'), false, 'private storage stays outside document root');
    const credentials = { activationKey: f.activationKey, username: 'site-owner', password: 'Restricted account test password 42' };
    assert.equal((await owner.call('setup', credentials)).status, 200);
    assert.equal((await owner.call('login', credentials)).status, 200);
    assert.equal((await visitor.call('tree')).status, 401);
    let head = (await owner.call('tree')).data.head;
    const home = (await owner.call('read&path=index.html')).data.content;
    const content = home.replace('</body>', '<p>open_basedir publication check</p></body>');
    const saved = await owner.call('save', { head, changes: [{ path: 'index.html', content, encoding: 'utf-8' }] });
    assert.equal(saved.status, 200); head = saved.data.head;
    assert.equal((await owner.call('read&path=index.html')).data.content, content);
    assert.equal((await owner.call('publish', { head })).status, 200);
    assert.match(fs.readFileSync(path.join(f.site, 'index.html'), 'utf8'), /open_basedir publication check/);
    const versions = (await owner.call('versions')).data.versions;
    assert.ok(versions.length > 0);
    const restored = await owner.call('restore', { head, version: versions[0].id });
    assert.equal(restored.status, 200); head = restored.data.head;
    assert.equal((await owner.call('read&path=index.html')).data.content, home);
    assert.equal((await owner.call('publish', { head })).status, 200);
    assert.doesNotMatch(fs.readFileSync(path.join(f.site, 'index.html'), 'utf8'), /open_basedir publication check/);
    assert.equal(fs.statSync(f.privateRoot).mode & 0o777, 0o700);
    assert.equal((await owner.call('logout', {})).status, 200);
    assert.equal((await owner.call('tree')).status, 401);
});

test('Path checks preserve symlink/traversal rejection inside an open_basedir account', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-basedir-paths-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const account = path.join(directory, 'home', 'account'), publicRoot = path.join(account, 'domains', 'tcg.com.ua', 'public_html');
    fs.mkdirSync(publicRoot, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../../php/runtime/Files.php'), path.join(account, 'Files.php'));
    const file = path.join(publicRoot, 'page.html'); fs.writeFileSync(file, 'public');
    const inside = path.join(account, 'inside'); fs.mkdirSync(inside);
    const outside = path.join(directory, 'account-neighbour'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'secret'), 'private');
    const aliases = [
        ['file-link', file], ['dir-link', inside], ['outside-link', outside],
        ['dangling-in', path.join(inside, 'missing')], ['dangling-out', path.join(outside, 'missing')],
    ];
    for (const [name, target] of aliases) fs.symlinkSync(target, path.join(publicRoot, name));
    const parentAlias = path.join(directory, 'account-alias'); fs.symlinkSync(account, parentAlias);
    const accepted = [publicRoot, file, path.join(account, '.tcg-new', 'objects', 'future'), path.join(inside, 'new.html')];
    const rejected = [
        '', '/', 'relative/file', '\0invalid', file + '/', publicRoot + '//page.html', publicRoot + '/./page.html', publicRoot + '/../other',
        ...aliases.map(([name]) => path.join(publicRoot, name)),
        path.join(publicRoot, 'dir-link', 'missing'), path.join(publicRoot, 'outside-link', 'secret'), path.join(publicRoot, 'dangling-in', 'child'), path.join(publicRoot, 'dangling-out', 'child'),
        path.join(parentAlias, 'domains', 'tcg.com.ua', 'public_html', 'page.html'),
    ];
    const outsidePaths = [path.join(outside, 'secret'), path.join(outside, 'new', 'missing'), path.join(account + '-sibling', 'future')];
    fs.writeFileSync(path.join(account, 'cases.json'), JSON.stringify({ accepted, rejected, outside: outsidePaths }));
    const script = path.join(account, 'check.php');
    fs.writeFileSync(script, `<?php
define('TCG_ENTRY', true); require __DIR__ . '/Files.php';
set_error_handler(function ($severity, $message, $file, $line) {
    if (error_reporting() & $severity) throw new ErrorException($message, 0, $severity, $file, $line);
    return false;
});
$cases = json_decode(file_get_contents(__DIR__ . '/cases.json'), true, 128, JSON_THROW_ON_ERROR);
$result = [];
foreach ($cases as $group => $paths) foreach ($paths as $path) {
    try { TCG\\Files::noLinks($path); $result[$group][] = true; }
    catch (Throwable $error) { $result[$group][] = false; }
}
$flip = __DIR__ . '/flip-' . bin2hex(random_bytes(4));
mkdir($flip); file_put_contents($flip . '/item', 'test');
realpath($flip . '/item'); TCG\\Files::noLinks($flip . '/item');
rename($flip, $flip . '-old'); symlink($flip . '-old', $flip);
try { TCG\\Files::noLinks($flip . '/item'); $result['replacedParentRejected'] = false; }
catch (Throwable $error) { $result['replacedParentRejected'] = true; }
echo json_encode($result);
`);
    // Also exercise multi-entry restrictions and the PHP special current-directory entry.
    for (const settings of [[], ['-d', 'open_basedir=' + account], ['-d', 'open_basedir=' + inside + path.delimiter + account + path.delimiter + account + '/'], ['-d', 'open_basedir=.']]) {
        const result = JSON.parse(execFileSync(php, [...settings, script], { cwd: account, encoding: 'utf8' }));
        assert.deepEqual(result.accepted, accepted.map(() => true), 'all canonical account paths, including future directories, must pass');
        assert.deepEqual(result.rejected, rejected.map(() => false), 'links and ambiguous paths must fail');
        assert.deepEqual(result.outside, outsidePaths.map(() => settings.length === 0), 'PHP scope stays enforced when open_basedir is enabled');
        assert.equal(result.replacedParentRejected, true, 'a previously canonical parent cannot become an accepted symlink');
    }
});
