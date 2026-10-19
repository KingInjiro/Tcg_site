const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fixture, php } = require('./fixture.cjs');

test('M1 real PHP: TLS, protected setup, sessions, authorization, CSRF and atomic private documents', { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = f.client(), attacker = f.client();
    const before = fs.readFileSync(path.join(f.site, 'index.html'), 'utf8');
    const diagnostics = await attacker.call('', undefined, { rawPath: '/admin/diagnostic.php', insecure: true });
    assert.equal(diagnostics.status, 200); assert.equal(diagnostics.data.supported, true); assert.match(diagnostics.data.php, /^8\.[2-5]\./);
    assert.equal((await attacker.call('session', undefined, { insecure: true, headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Ssl': 'on' } })).status, 403);
    const session = await owner.session(); assert.equal(session.status, 200); assert.equal(session.data.setupRequired, true); assert.equal(session.data.authenticated, false);
    assert.match(session.headers['set-cookie'][0], /secure/i); assert.match(session.headers['set-cookie'][0], /HttpOnly/i); assert.match(session.headers['set-cookie'][0], /SameSite=Strict/i);
    assert.equal((await owner.call('tree')).status, 401);
    const credentials = { activationKey: f.activationKey, username: 'site-owner', password: 'Correct horse battery staple 42' };
    assert.equal((await owner.call('setup', credentials, { headers: { 'X-TCG-CSRF': null } })).status, 403);
    assert.equal((await owner.call('setup', credentials, { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await owner.call('setup', { ...credentials, activationKey: 'wrong' })).status, 403);
    assert.equal((await owner.call('setup', credentials)).status, 200);
    assert.equal((await owner.call('setup', credentials)).status, 409, 'setup cannot replace an existing owner');
    const ownerData = fs.readFileSync(path.join(f.privateRoot, 'owner.json'), 'utf8');
    assert.ok(!ownerData.includes(credentials.password) && !ownerData.includes(f.activationKey));
    const cookieBefore = owner.cookie;
    assert.equal((await owner.call('login', { username: credentials.username, password: 'wrong' })).status, 401);
    assert.equal((await owner.call('login', credentials)).status, 200); assert.notEqual(owner.cookie, cookieBefore, 'login rotates session id');
    const original = (await owner.call('tree')).data;
    assert.ok(original.files.length >= 51); assert.equal((await attacker.call('tree')).status, 401);
    const home = await owner.call('read&path=index.html'); assert.equal(home.status, 200); assert.match(home.data.content, /<html/);
    for (const forbidden of ['../index.html', 'admin/api.php', '.tcg-editor/../index.html.json', 'images/editor/exploit.php', 'Docs/../../x.html', 'admin.html']) {
        assert.equal((await owner.call('read&path=' + encodeURIComponent(forbidden))).status, 403, forbidden);
        assert.equal((await owner.call('save', { head: original.head, changes: [{ path: forbidden, content: '<html>bad</html>', encoding: 'utf-8' }] })).status, 403, forbidden);
    }
    const png = fs.readFileSync(path.join(__dirname, '../../images/favicon-32.png')).toString('base64');
    const changes = [{ path: 'index.html', content: home.data.content.replace('</body>', '<p>Чернетка M1</p></body>'), encoding: 'utf-8' }, { path: '.tcg-editor/index.html.json', content: JSON.stringify({ version: 1 }), encoding: 'utf-8' }, { path: 'images/editor/core-test.png', content: png, encoding: 'base64' }];
    assert.equal((await owner.call('save', { head: original.head, changes }, { headers: { 'X-TCG-CSRF': 'forged' } })).status, 403);
    const saved = await owner.call('save', { head: original.head, changes }); assert.equal(saved.status, 200); assert.equal(saved.data.published, false); assert.notEqual(saved.data.head, original.head);
    assert.equal((await owner.call('save', { head: saved.data.head, changes: [{ ...changes[0], path: 'INDEX.htm' }] })).status, 409, 'case/legacy extensions cannot create conflicting routes');
    assert.equal((await owner.call('save', { head: saved.data.head, changes: ['new.html', 'new.htm'].map(path => ({ path, content: '<html><body>new</body></html>', encoding: 'utf-8' })) })).status, 409, 'two new pages cannot occupy the same URL');
    assert.equal((await owner.call('save', { head: original.head, changes })).status, 409);
    const image = await owner.call('image&path=images/editor/core-test.png'); assert.equal(image.status, 200); assert.equal(image.data.base64, png);
    assert.equal((await attacker.call('image&path=images/editor/core-test.png')).status, 401);
    assert.equal(fs.existsSync(path.join(f.site, 'images/editor/core-test.png')), false, 'draft uploads stay outside the web root');
    for (const file of [{ path: 'images/editor/forged.jpg', content: png, encoding: 'base64' }, { path: 'images/editor/hidden-code.png', content: Buffer.from('<?php echo 1; ?>').toString('base64'), encoding: 'base64' }]) {
        assert.equal((await owner.call('save', { head: saved.data.head, changes: [file] })).status, 400, 'server validates decoded image content and MIME');
    }
    assert.match((await owner.call('read&path=index.html')).data.content, /Чернетка M1/);
    assert.equal(fs.readFileSync(path.join(f.site, 'index.html'), 'utf8'), before, 'draft save never pretends to publish');
    const invalid = [{ ...changes[0], content: '<html><body>allowed</body></html>' }, { path: 'server.php', content: 'bad', encoding: 'utf-8' }];
    assert.equal((await owner.call('save', { head: saved.data.head, changes: invalid })).status, 403);
    assert.match((await owner.call('read&path=index.html')).data.content, /Чернетка M1/, 'invalid batch makes no partial changes');
    assert.equal((await owner.call('save', { head: saved.data.head, changes: [{ ...changes[0], content: '<html><body><?php echo 1; ?></body></html>' }] })).status, 400);
    const caps = await owner.call('capabilities'); assert.equal(caps.status, 200); assert.equal(caps.data.privateStorage, true); assert.equal(caps.data.read, true); assert.equal(caps.data.write, true); assert.ok(!JSON.stringify(caps.data).includes(f.privateRoot));
    for (const rawPath of ['/.tcg-editor/index.html.json', '/admin/_app/release.php', '/admin/_app/seed.php', '/' + path.basename(f.privateRoot) + '/owner.json']) {
        const result = await attacker.call('', undefined, { rawPath });
        assert.ok((result.status >= 400 && result.status < 500) || (result.status === 200 && result.data.text === before), rawPath + ': unexpected HTTP ' + result.status);
        assert.ok(!JSON.stringify(result).includes(f.activationKey));
        assert.ok(!JSON.stringify(result).includes(f.privateRoot));
        assert.ok(!JSON.stringify(result.data).includes('<?php'), 'PHP source cannot be downloaded');
    }
    const state = JSON.parse(fs.readFileSync(path.join(f.privateRoot, 'state.json'))), object = path.join(f.privateRoot, 'objects', state.files['index.html']);
    const content = fs.readFileSync(object); fs.unlinkSync(object); fs.symlinkSync(path.join(f.site, 'index.html'), object);
    assert.ok([403, 503].includes((await owner.call('read&path=index.html')).status), 'symlink read disables access safely');
    fs.unlinkSync(object); fs.writeFileSync(object, content);
    const lockProcess = spawn(php, ['-r', '$h=fopen($argv[1], "c+b"); flock($h, LOCK_EX); echo "locked\\n"; fflush(STDOUT); usleep(4000000);', path.join(f.privateRoot, 'operation.lock')]);
    await new Promise((resolve, reject) => { lockProcess.stdout.once('data', resolve); lockProcess.once('error', reject); });
    try { assert.equal((await owner.call('save', { head: saved.data.head, changes })).status, 409, 'parallel mutation cannot enter the locked transaction'); }
    finally { lockProcess.kill(); await new Promise(resolve => lockProcess.once('exit', resolve)); }
    const objects = path.join(f.privateRoot, 'objects'), oldMode = fs.statSync(objects).mode;
    fs.chmodSync(objects, 0o500);
    try {
        // Root can bypass mode bits. CI runs PHP as its ordinary runner account.
        if (process.getuid?.() !== 0) assert.equal((await owner.call('save', { head: saved.data.head, changes: [{ ...changes[0], content: home.data.content + '<!-- permission test -->' }] })).status, 503);
    } finally { fs.chmodSync(objects, oldMode); }
    const filler = path.join(f.privateRoot, 'quota-fixture'); fs.writeFileSync(filler, Buffer.alloc(40 * 1024 * 1024));
    try { assert.equal((await owner.call('save', { head: saved.data.head, changes })).status, 507, 'quota failure preserves the draft and public site'); }
    finally { fs.unlinkSync(filler); }
    assert.equal((await owner.call('tree')).data.head, saved.data.head);
    fs.chmodSync(f.privateRoot, 0o755);
    try { assert.equal((await owner.call('tree')).status, 503, 'world-accessible private storage disables administration'); }
    finally { fs.chmodSync(f.privateRoot, 0o700); }
    const sessionDirectory = path.join(f.privateRoot, 'sessions'), synthetic = [];
    const existingSessions = fs.readdirSync(sessionDirectory).filter(name => name.startsWith('sess_')).length;
    for (let i = existingSessions; i < 512; i++) { const file = path.join(sessionDirectory, 'sess_fixture' + String(i).padStart(20, '0')); fs.writeFileSync(file, ''); synthetic.push(file); }
    try { assert.equal((await f.client().session()).status, 429, 'anonymous sessions cannot grow without a bound'); assert.equal((await owner.call('tree')).status, 200, 'existing owner session remains usable'); }
    finally { for (const file of synthetic) fs.unlinkSync(file); }
    assert.equal((await owner.call('logout', {})).status, 200); assert.equal((await owner.call('tree')).status, 401);
    await owner.session();
    for (let i = 0; i < 8; i++) await owner.call('login', { username: credentials.username, password: 'invalid' });
    assert.equal((await owner.call('login', credentials)).status, 429, 'rate limiter is server-side');
});
