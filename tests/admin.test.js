const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { createOAuth } = require('../lib/github-oauth');
const { build } = require('../scripts/build');
const { createApp } = require('../server');
const formatter = require('../admin/raw-format');
const root = path.resolve(__dirname, '..');

async function serve(t, handler) {
    const server = http.createServer(handler).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, fetchImpl, overrides = {}) {
    const env = { CMS_ORIGIN: 'https://cms.example', GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret', ...overrides };
    let time = 1000000;
    // A fresh handler per request reproduces stateless serverless invocations.
    const origin = await serve(t, (req, res) => {
        const oauth = createOAuth({ env, fetchImpl, now: () => time });
        return req.url.startsWith('/api/callback') ? oauth.callback(req, res) : oauth.auth(req, res);
    });
    const start = async (query = '') => {
        const response = await fetch(origin + '/api/auth' + query, { redirect: 'manual' });
        const location = response.headers.get('location');
        return { response, url: location && new URL(location), cookie: response.headers.get('set-cookie')?.split(';')[0] };
    };
    const finish = (session, query = '') => fetch(`${origin}/api/callback?state=${session.url.searchParams.get('state')}&code=code${query}`, { headers: { Cookie: session.cookie } });
    return { env, origin, start, finish, expire: () => { time += 600001; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('OAuth redirects to GitHub with PKCE, fixed origin and public-repo scope', async t => {
    const f = await fixture(t, () => { throw new Error('must not fetch'); });
    const { response, url } = await f.start('?provider=github&site_id=evil.example&scope=repo');
    assert.equal(response.status, 302);
    assert.equal(url.origin, 'https://github.com');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://cms.example/api/callback');
    assert.equal(url.searchParams.get('scope'), 'public_repo');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('code_challenge').length, 43);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!url.href.includes('test-secret'));
});

test('OAuth fails closed without credentials and rejects unsupported requests', async t => {
    const f = await fixture(t, undefined, { GITHUB_CLIENT_SECRET: '' });
    assert.equal((await f.start()).response.status, 503);
    const valid = await fixture(t);
    assert.equal((await valid.start('?provider=gitlab')).response.status, 400);
    assert.equal((await fetch(valid.origin + '/api/auth', { method: 'POST' })).status, 405);
});

test('OAuth refuses insecure or malformed public origins', async t => {
    for (const origin of ['http://cms.example', 'https://cms.example/admin/', 'https://user:pass@cms.example', 'not a URL']) {
        const f = await fixture(t, undefined, { CMS_ORIGIN: origin });
        assert.equal((await f.start()).response.status, 503, origin);
    }
});

test('OAuth rejects missing, tampered, mismatched and expired state before token exchange', async t => {
    let calls = 0;
    const f = await fixture(t, () => { calls++; throw new Error('must not fetch'); });
    const s = await f.start();
    assert.equal((await fetch(f.origin + '/api/callback?code=x&state=x')).status, 400);
    assert.equal((await fetch(f.origin + '/api/callback?code=x&state=wrong', { headers: { Cookie: s.cookie } })).status, 400);
    assert.equal((await f.finish({ ...s, cookie: s.cookie + 'x' })).status, 400);
    f.expire();
    assert.equal((await f.finish(s)).status, 400);
    assert.equal(calls, 0);
});

test('OAuth exchanges the code, checks push permission and limits the popup receiver', async t => {
    const calls = [];
    const f = await fixture(t, async (url, options) => {
        calls.push({ url, options });
        return calls.length === 1 ? json({ access_token: 'test-token</script>' }) : json({ permissions: { push: true } });
    });
    const s = await f.start();
    const response = await f.finish(s);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.body.get('client_secret'), 'test-secret');
    assert.equal(crypto.createHash('sha256').update(calls[0].options.body.get('code_verifier')).digest('base64url'), s.url.searchParams.get('code_challenge'));
    assert.equal(calls[1].url, 'https://api.github.com/repos/KingInjiro/Tcg_site');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token</script>');
    assert.match(body, /authorization:github:success:/);
    assert.match(body, /event.origin !== origin/);
    assert.match(body, /event.source !== window.opener/);
    assert.ok(!body.includes('postMessage(message, "*")'));
    assert.ok(!body.includes('test-token</script>'));
    assert.ok(!body.includes('test-secret'));
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
    assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-/);
});

test('OAuth never gives a token to a user without repository write access', async t => {
    let calls = 0;
    const f = await fixture(t, async () => ++calls === 1 ? json({ access_token: 'secret-token' }) : json({ permissions: { push: false } }));
    const response = await f.finish(await f.start());
    assert.equal(response.status, 403);
    const body = await response.text();
    assert.match(body, /authorization:github:error:/);
    assert.ok(!body.includes('secret-token'));
});

test('OAuth cancellation and upstream failures return safe, actionable errors', async t => {
    const f = await fixture(t, async () => { throw new Error('test-secret from upstream'); });
    const cancelled = await f.finish(await f.start(), '&error=access_denied');
    assert.match(await cancelled.text(), /authorization:github:error:/);
    const failed = await f.finish(await f.start());
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes('test-secret'));
});

test('every configured HTML file survives raw-format round trip byte for byte', () => {
    const config = yaml.load(fs.readFileSync(path.join(root, 'admin/config.yml'), 'utf8'));
    assert.equal(config.backend.repo, 'KingInjiro/Tcg_site');
    assert.equal(config.backend.branch, 'main');
    let count = 0;
    for (const collection of config.collections) {
        assert.equal(collection.format, 'raw');
        for (const entry of collection.files) {
            const input = fs.readFileSync(path.join(root, entry.file));
            const output = Buffer.from(formatter.toFile(formatter.fromFile(input.toString('utf8'))));
            assert.deepEqual(output, input, entry.file);
            count++;
        }
    }
    assert.ok(count > 50);
    assert.throws(() => formatter.toFile({}), /HTML/);
});

test('build serves the CMS, website and legacy links without exposing server files', async t => {
    const output = build();
    for (const name of ['server.js', 'package.json', 'package-lock.json', 'README.md', 'api', 'lib', 'scripts', 'tests', '.env', '.git', 'test_admin.html', 'temp.html']) {
        assert.equal(fs.existsSync(path.join(output, name)), false, name);
    }
    assert.ok(fs.existsSync(path.join(output, 'admin/vendor/decap-cms.js')));
    const origin = await serve(t, createApp());
    for (const name of ['/', '/admin/', '/admin/config.yml', '/admin/vendor/decap-cms.js', '/CONTACTS.HTM?from=test']) {
        assert.equal((await fetch(origin + name)).status, 200, name);
    }
    for (const name of ['/server.js', '/package.json', '/lib/github-oauth.js', '/.env', '/test_admin.html']) {
        assert.equal((await fetch(origin + name)).status, 404, name);
    }
    assert.equal((await fetch(origin + '/admin/')).headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(origin + '/api/auth')).status, 503);
});
