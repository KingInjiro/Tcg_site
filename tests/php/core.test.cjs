const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { preparePHP } = require('../../scripts/prepare-php');
const php = process.env.TCG_PHP || 'php';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-php-core-'));
    const site = path.join(directory, 'public');
    const { activationKey } = preparePHP(site);
    const secret = crypto.randomBytes(32).toString('hex');
    const reserve = net.createServer(); await listen(reserve); const backendPort = reserve.address().port; await new Promise(r => reserve.close(r));
    const processPHP = spawn(php, ['-S', '127.0.0.1:' + backendPort, '-t', site, path.join(__dirname, 'router.php')], { env: { ...process.env, TCG_FIXTURE_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; processPHP.stderr.on('data', chunk => { log += chunk; });
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('PHP did not start: ' + log)), 10000);
        processPHP.on('error', reject);
        processPHP.stderr.on('data', () => { if (log.includes('Development Server')) { clearTimeout(timeout); resolve(); } });
        processPHP.on('exit', code => { if (code) { clearTimeout(timeout); reject(new Error('PHP exited: ' + log)); } });
    });
    const key = path.join(directory, 'tls.key'), cert = path.join(directory, 'tls.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    const proxy = (req, res) => {
        const headers = { ...req.headers }; delete headers['x-tcg-fixture-transport'];
        if (req.socket.encrypted) headers['x-tcg-fixture-transport'] = secret;
        const outgoing = http.request({ host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
        outgoing.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(outgoing);
    };
    const tls = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, proxy), plain = http.createServer(proxy);
    await listen(tls); await listen(plain);
    const origin = 'https://localhost:' + tls.address().port;
    const privateRoot = path.join(directory, '.tcg-' + crypto.createHash('sha256').update(fs.realpathSync(site)).digest('hex').slice(0, 20));
    t.after(async () => { processPHP.kill(); for (const server of [tls, plain]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(directory, { recursive: true, force: true }); });
    const client = () => {
        let cookie = '', csrf = '';
        const call = (action, body, options = {}) => new Promise((resolve, reject) => {
            const insecure = options.insecure;
            const target = new URL((options.rawPath || '/admin/api.php?action=' + action), insecure ? 'http://localhost:' + plain.address().port : origin);
            const data = body === undefined ? null : JSON.stringify(body);
            const headers = { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Origin: origin, 'X-TCG-CSRF': csrf } : {}), ...options.headers };
            for (const [key, value] of Object.entries(headers)) if (value === null) delete headers[key];
            const req = (insecure ? http : https).request(target, { method: options.method || (data ? 'POST' : 'GET'), ca: fs.readFileSync(cert), headers }, res => {
                let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
                res.on('end', () => {
                    if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
                    let result; try { result = JSON.parse(text); } catch { result = { text }; }
                    if (result.csrf) csrf = result.csrf;
                    resolve({ status: res.statusCode, data: result, headers: res.headers, cookie, csrf });
                });
            }); req.on('error', reject); req.end(data);
        });
        return { call, session: () => call('session'), get cookie() { return cookie; } };
    };
    return { client, activationKey, site, privateRoot, origin, php: processPHP };
}

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
    const changes = [{ path: 'index.html', content: home.data.content.replace('</body>', '<p>Чернетка M1</p></body>'), encoding: 'utf-8' }, { path: '.tcg-editor/index.html.json', content: JSON.stringify({ version: 1 }), encoding: 'utf-8' }];
    assert.equal((await owner.call('save', { head: original.head, changes }, { headers: { 'X-TCG-CSRF': 'forged' } })).status, 403);
    const saved = await owner.call('save', { head: original.head, changes }); assert.equal(saved.status, 200); assert.equal(saved.data.published, false); assert.notEqual(saved.data.head, original.head);
    assert.equal((await owner.call('save', { head: saved.data.head, changes: [{ ...changes[0], path: 'INDEX.htm' }] })).status, 409, 'case/legacy extensions cannot create conflicting routes');
    assert.equal((await owner.call('save', { head: saved.data.head, changes: ['new.html', 'new.htm'].map(path => ({ path, content: '<html><body>new</body></html>', encoding: 'utf-8' })) })).status, 409, 'two new pages cannot occupy the same URL');
    assert.equal((await owner.call('save', { head: original.head, changes })).status, 409);
    assert.match((await owner.call('read&path=index.html')).data.content, /Чернетка M1/);
    assert.equal(fs.readFileSync(path.join(f.site, 'index.html'), 'utf8'), before, 'draft save never pretends to publish');
    const invalid = [{ ...changes[0], content: '<html><body>allowed</body></html>' }, { path: 'server.php', content: 'bad', encoding: 'utf-8' }];
    assert.equal((await owner.call('save', { head: saved.data.head, changes: invalid })).status, 403);
    assert.match((await owner.call('read&path=index.html')).data.content, /Чернетка M1/, 'invalid batch makes no partial changes');
    assert.equal((await owner.call('save', { head: saved.data.head, changes: [{ ...changes[0], content: '<html><body><?php echo 1; ?></body></html>' }] })).status, 400);
    const caps = await owner.call('capabilities'); assert.equal(caps.status, 200); assert.equal(caps.data.privateStorage, true); assert.ok(!JSON.stringify(caps.data).includes(f.privateRoot));
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
    assert.equal((await owner.call('logout', {})).status, 200); assert.equal((await owner.call('tree')).status, 401);
    await owner.session();
    for (let i = 0; i < 8; i++) await owner.call('login', { username: credentials.username, password: 'invalid' });
    assert.equal((await owner.call('login', credentials)).status, 429, 'rate limiter is server-side');
});
