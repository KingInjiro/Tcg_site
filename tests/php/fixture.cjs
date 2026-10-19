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
const { readZip } = require('../zip-reader.cjs');
function extractRelease(site) {
    if (!process.env.TCG_PHP_ZIP) return preparePHP(site);
    const keyText = fs.readFileSync(process.env.TCG_ACTIVATION_KEY_FILE, 'utf8');
    const activationKey = keyText.trim().split('\n').find(line => /^[A-Za-z0-9_-]{43}$/.test(line));
    assert.ok(activationKey, 'Separate activation key is required');
    fs.mkdirSync(site);
    for (const [name, bytes] of readZip(fs.readFileSync(process.env.TCG_PHP_ZIP))) {
        assert.ok(!name.startsWith('/') && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..'));
        const target = path.join(site, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    }
    return { activationKey };
}
const php = process.env.TCG_PHP || 'php';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function fixture(t, { ini = [] } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-php-core-'));
    const site = path.join(directory, 'public');
    const { activationKey } = extractRelease(site);
    const key = path.join(directory, 'tls.key'), cert = path.join(directory, 'tls.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
    const port = async () => { const reserve = net.createServer(); await listen(reserve); const number = reserve.address().port; await new Promise(r => reserve.close(r)); return number; };
    let origin, plainOrigin, processPHP;
    if (process.env.TCG_APACHE_IMAGE) {
        const tlsPort = await port(), plainPort = await port(), name = 'tcg-test-' + crypto.randomBytes(8).toString('hex');
        execFileSync('docker', ['run', '-d', '--rm', '--name', name, '--network', 'host', '-v', directory + ':' + directory,
            '-e', 'TCG_PUBLIC_ROOT=' + site, '-e', 'TCG_TLS_CERT=' + cert, '-e', 'TCG_TLS_KEY=' + key,
            '-e', 'TCG_HTTP_PORT=' + plainPort, '-e', 'TCG_HTTPS_PORT=' + tlsPort, '-e', 'SSL_CERT_FILE=' + cert, process.env.TCG_APACHE_IMAGE], { stdio: 'pipe' });
        t.after(() => { execFileSync('docker', ['stop', '-t', '2', name], { stdio: 'pipe' }); fs.rmSync(directory, { recursive: true, force: true }); });
        await new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const attempt = () => { const socket = net.connect(tlsPort, '127.0.0.1'); socket.on('connect', () => { socket.destroy(); resolve(); }); socket.on('error', () => Date.now() > deadline ? reject(new Error('Apache did not start: ' + execFileSync('docker', ['logs', name]))) : setTimeout(attempt, 50)); }; attempt(); });
        origin = 'https://localhost:' + tlsPort; plainOrigin = 'http://localhost:' + plainPort;
    } else {
        const secret = crypto.randomBytes(32).toString('hex'), backendPort = await port();
        processPHP = spawn(php, [...ini.flatMap(value => ['-d', value]), '-S', '127.0.0.1:' + backendPort, '-t', site, path.join(__dirname, 'router.php')], { env: { ...process.env, TCG_FIXTURE_SECRET: secret, SSL_CERT_FILE: cert }, stdio: ['ignore', 'pipe', 'pipe'] });
        let log = ''; processPHP.stderr.on('data', chunk => { log += chunk; });
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('PHP did not start: ' + log)), 10000);
            processPHP.on('error', reject);
            processPHP.stderr.on('data', () => { if (log.includes('Development Server')) { clearTimeout(timeout); resolve(); } });
            processPHP.on('exit', code => { if (code) { clearTimeout(timeout); reject(new Error('PHP exited: ' + log)); } });
        });
        const proxy = (req, res) => {
            const headers = { ...req.headers }; delete headers['x-tcg-fixture-transport'];
            if (req.socket.encrypted) headers['x-tcg-fixture-transport'] = secret;
            const outgoing = http.request({ host: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
            outgoing.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(outgoing);
        };
        const tls = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, proxy), plain = http.createServer(proxy);
        await listen(tls); await listen(plain); origin = 'https://localhost:' + tls.address().port; plainOrigin = 'http://localhost:' + plain.address().port;
        t.after(async () => { processPHP.kill(); for (const server of [tls, plain]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } fs.rmSync(directory, { recursive: true, force: true }); });
    }
    const privateRoot = path.join(directory, '.tcg-' + crypto.createHash('sha256').update(fs.realpathSync(site)).digest('hex').slice(0, 20));
    const client = () => {
        let cookie = '', csrf = '';
        const call = (action, body, options = {}) => new Promise((resolve, reject) => {
            const insecure = options.insecure;
            const target = new URL((options.rawPath || '/admin/api.php?action=' + action), insecure ? plainOrigin : origin);
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
    return { client, activationKey, site, privateRoot, origin, spki, certificate: fs.readFileSync(cert), privateKey: fs.readFileSync(key), php: processPHP };
}


module.exports = { fixture, php };
