const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { prepareRelease } = require('../scripts/release-site');
const { configuration, orderedFiles, upload } = require('../scripts/publish-static');
const { GitHub } = require('../admin/repository');
const { checkMail } = require('../lib/mail-settings');
const { createMailStatus } = require('../lib/mail-status');
const base = 'a'.repeat(40), head = 'b'.repeat(40), repository = 'KingInjiro/Tcg_site';
const event = { workflow_run: { id: 123, head_sha: head } };
function releaseAPI(overrides = {}) {
    const writes = [];
    const values = {
        '/actions/runs/123': { path: '.github/workflows/site-checks.yml', event: 'push', conclusion: 'success', head_sha: head, head_branch: 'cms/draft-123', head_repository: { full_name: repository } },
        '/git/ref/heads/main': { object: { sha: base } },
        ['/git/commits/' + head]: { parents: [{ sha: base }], tree: { sha: 'tree' } },
        ['/compare/' + base + '...' + head]: { total_commits: 1, status: 'ahead', files: [{ filename: 'index.html', status: 'modified' }, { filename: '.tcg-editor/index.html.json', status: 'added' }] },
        '/git/trees/tree?recursive=1': { tree: [{ path: 'index.html', type: 'blob', mode: '100644' }, { path: '.tcg-editor/index.html.json', type: 'blob', mode: '100644' }] }, ...overrides,
    };
    return { writes, api: async (path, body, method) => { if (body) { writes.push({ path, body, method }); if (overrides.race) throw new Error('non-fast-forward'); return {}; } assert.ok(Object.hasOwn(values, path), path); return values[path]; } };
}
test('release promotes only the checked content commit, with no force or replay of obsolete main', async () => {
    const { api, writes } = releaseAPI();
    assert.equal(await prepareRelease(event, api, repository), head);
    assert.deepEqual(writes, [{ path: '/git/refs/heads/main', method: 'PATCH', body: { sha: head, force: false } }]);
    const retry = releaseAPI({ '/git/ref/heads/main': { object: { sha: head } } });
    assert.equal(await prepareRelease(event, retry.api, repository), head);
    assert.equal(retry.writes.length, 0, 'upload retry does not rewrite main');
    const raced = releaseAPI({ race: true });
    await assert.rejects(prepareRelease(event, raced.api, repository), /non-fast-forward/);
    assert.equal(raced.writes.length, 1, 'no force retry');
});
test('release refuses failed, foreign or PR checks, changed main, code, symlinks and deletions', async () => {
    const original = await releaseAPI().api('/actions/runs/123');
    for (const change of [{ conclusion: 'failure' }, { event: 'pull_request' }, { path: '.github/workflows/other.yml' }, { head_sha: base }, { head_branch: 'feature/test' }, { head_repository: { full_name: 'other/repo' } }]) {
        const scenario = releaseAPI({ '/actions/runs/123': { ...original, ...change } });
        await assert.rejects(prepareRelease(event, scenario.api, repository)); assert.equal(scenario.writes.length, 0);
    }
    const scenarios = [
        { '/git/ref/heads/main': { object: { sha: 'c'.repeat(40) } } },
        { ['/compare/' + base + '...' + head]: { total_commits: 1, status: 'ahead', files: [{ filename: 'server.js', status: 'modified' }] } },
        { ['/compare/' + base + '...' + head]: { total_commits: 1, status: 'ahead', files: [{ filename: 'index.html', status: 'removed' }] } },
        { '/git/trees/tree?recursive=1': { truncated: true, tree: [] } },
        { '/git/trees/tree?recursive=1': { tree: [{ path: 'index.html', type: 'blob', mode: '120000' }] } },
    ];
    for (const scenario of scenarios) { const { api, writes } = releaseAPI(scenario); await assert.rejects(prepareRelease(event, api, repository)); assert.equal(writes.length, 0); }
});
const json = data => new Response(JSON.stringify(data));
test('editor resumes a checked draft without storing credentials and waits for publication success', async () => {
    const memory = new Map(), storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
    let completed = false;
    const routes = [];
    const fetcher = async url => {
        const route = url.split(repository)[1]; routes.push(route);
        if (route === '/git/ref/heads/main') return json({ object: { sha: base } });
        if (route === '/git/commits/' + head) return json({ tree: { sha: 'draft-tree' } });
        if (route.includes('/git/trees/')) return json({ tree: [{ type: 'blob', mode: '100644', path: 'new-page.html', sha: 'draft-page' }] });
        if (route.includes('/statuses')) return json(completed ? [{ context: 'TCG publication', state: 'success', target_url: 'https://github.com/run' }] : []);
        if (route.includes('/runs?')) return json({ workflow_runs: [{ head_sha: head, head_branch: 'cms/draft-123', status: 'completed', conclusion: 'success', html_url: 'https://github.com/check' }] });
        throw new Error('Unexpected route ' + route);
    };
    const first = new GitHub('secret-token', fetcher, storage);
    first.remember({ head, base, branch: 'cms/draft-123' });
    assert.ok(![...memory.values()].join().includes('secret-token'));
    const resumed = new GitHub('new-token', fetcher, storage);
    assert.equal((await resumed.list()).files[0].path, 'new-page.html');
    assert.ok(routes.includes('/git/commits/' + head));
    assert.equal((await resumed.publicationStatus()).state, 'pending', 'checks passing is not publication completion');
    assert.equal(resumed.head, base);
    completed = true;
    assert.equal((await resumed.publicationStatus()).state, 'success');
    assert.equal(resumed.head, head); assert.equal(memory.size, 0);
});
const smtp = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'user', SMTP_PASSWORD: 'private-password', CONTACT_FROM: 'site@example.com', CONTACT_TO: 'owner@example.com', CONTACT_TOKEN_SECRET: 'private-secret', VERCEL: '1' };
test('mail diagnostics verify TLS/authentication but never send or expose credentials', async () => {
    let options, verifies = 0, closes = 0;
    assert.equal((await checkMail({})).stage, 'configuration');
    const result = await checkMail(smtp, value => { options = value; return { verify: async () => verifies++, close: () => closes++ }; });
    assert.equal(result.ok, true); assert.equal(verifies, 1); assert.equal(closes, 1);
    assert.equal(options.requireTLS, true); assert.equal(options.secure, true); assert.match(result.message, /не підтверджує/);
    const error = await checkMail({ ...smtp, SMTP_PORT: '587' }, value => { assert.equal(value.secure, false); assert.equal(value.requireTLS, true); return { verify: async () => { throw Object.assign(new Error('private-password'), { code: 'EAUTH' }); }, close() {} }; });
    assert.equal(error.ok, false); assert.ok(!JSON.stringify(error).includes('private-password'));
});
test('mail diagnostics require a repository writer before touching SMTP', async () => {
    let diagnosed = 0, allowed = false;
    const handler = createMailStatus({ env: {}, fetchImpl: async () => json({ permissions: { push: allowed } }), diagnose: async () => { diagnosed++; return { ok: true }; } });
    async function call(method, authorization) {
        const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handler({ method, headers: { authorization } }, res); return res;
    }
    assert.equal((await call('GET', 'Bearer token')).statusCode, 405);
    assert.equal((await call('POST', '')).statusCode, 401);
    assert.equal((await call('POST', 'Bearer token')).statusCode, 403); assert.equal(diagnosed, 0);
    allowed = true;
    assert.equal((await call('POST', 'Bearer token')).body.ok, true); assert.equal(diagnosed, 1);
});
const hosting = { STATIC_PROTOCOL: 'sftp', STATIC_HOST: 'host.example.com', STATIC_USER: 'owner', STATIC_DIRECTORY: '/public_html', STATIC_SSH_KEY: 'private-key', STATIC_KNOWN_HOSTS: 'verified-host-key', CONTACT_FORM_ENDPOINT: 'https://admin.example.com/api/contact', SITE_REVISION: head };
test('hosting rejects insecure or ambiguous settings and exports assets before HTML, service worker last', () => {
    for (const patch of [{ STATIC_PROTOCOL: 'ftp' }, { STATIC_DIRECTORY: '/' }, { STATIC_DIRECTORY: '../other' }, { STATIC_HOST: '-options' }, { STATIC_SSH_KEY: '' }, { STATIC_KNOWN_HOSTS: '' }, { CONTACT_FORM_ENDPOINT: 'http://example.com/contact' }]) assert.throws(() => configuration({ ...hosting, ...patch }));
    assert.throws(() => orderedFiles([{ path: '../private' }]));
    const files = [{ path: 'site-version.json', content: 'version' }, { path: 'sw.js', content: 'worker' }, { path: 'page/index.html', content: 'page' }, { path: 'images/editor/photo.png', content: 'image' }];
    assert.deepEqual(orderedFiles(files).map(file => file.path), ['images/editor/photo.png', 'page/index.html', 'site-version.json', 'sw.js']);
    let batchPath;
    assert.equal(upload(files, hosting, (command, args, options) => {
        assert.equal(command, 'sftp'); assert.ok(args.includes('-oStrictHostKeyChecking=yes')); assert.ok(!JSON.stringify(args).includes('private-key'));
        assert.equal(options.env.STATIC_SSH_KEY, undefined);
        batchPath = args[args.indexOf('-b') + 1];
        const batch = fs.readFileSync(batchPath, 'utf8');
        assert.ok(batch.indexOf('photo.png') < batch.indexOf('index.html')); assert.match(batch, /rename .*sw\.js/);
        assert.doesNotMatch(batch, /(?:^|\n)(?:rm|rmdir) /);
    }), 4);
    assert.equal(fs.existsSync(batchPath), false);
    upload(files, { ...hosting, STATIC_PROTOCOL: 'ftps', STATIC_PASSWORD: 'private-password' }, (command, args) => {
        assert.equal(command, 'curl'); assert.ok(args.includes('--fail-early'));
        const config = fs.readFileSync(args.at(-1), 'utf8');
        assert.match(config, /ssl-reqd/); assert.doesNotMatch(config, /insecure/); assert.match(config, /quote = "-RNTO/);
        assert.match(config, /ftp:\/\/host.example.com:21\/\/public_html/);
        assert.equal(fs.statSync(args.at(-1)).mode & 0o777, 0o600);
    });
    assert.throws(() => upload(files, hosting, () => { throw Object.assign(new Error('private-password'), { status: 1 }); }), error => /Hosting upload failed/.test(error.message) && !error.message.includes('private-password'));
});
