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
    const spki = crypto.createHash('sha256').update(new crypto.X509Certificate(fs.readFileSync(cert)).publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
    return { client, activationKey, site, privateRoot, origin, spki, php: processPHP };
}


module.exports = { fixture, php };
