const test = require('node:test');
const assert = require('node:assert/strict');
const tls = require('node:tls');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./fixture.cjs');
async function smtp(t, key, cert) {
    const delivered = [], envelopes = [], sockets = new Set(); let rejected = false;
    const server = tls.createServer({ key, cert }, socket => {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {}); socket.setEncoding('utf8'); socket.write('220 localhost TCG fixture\r\n');
        let buffer = '', receiving = false, authenticating = false, message = '', recipient = '';
        socket.on('data', chunk => { buffer += chunk; let end;
            while ((end = buffer.indexOf('\r\n')) >= 0) {
                const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
                if (receiving) { if (line === '.') { delivered.push(message); envelopes.push(recipient); receiving = false; socket.write('250 queued fixture message\r\n'); } else message += line + '\n'; continue; }
                if (authenticating) { authenticating = false; socket.write(Buffer.from(line, 'base64').toString() === '\0smtp-owner\0smtp-fixture-password' ? '235 authenticated\r\n' : '535 rejected\r\n'); }
                else if (line === 'AUTH PLAIN') { authenticating = true; socket.write('334 \r\n'); }
                else if (/^EHLO /i.test(line)) socket.write('250-localhost\r\n250-AUTH PLAIN\r\n250 SIZE 40000\r\n');
                else if (/^AUTH PLAIN /i.test(line)) socket.write(Buffer.from(line.slice(11), 'base64').toString() === '\0smtp-owner\0smtp-fixture-password' ? '235 authenticated\r\n' : '535 rejected\r\n');
                else if (/^MAIL FROM:/i.test(line)) socket.write('250 sender accepted\r\n');
                else if (/^RCPT TO:/i.test(line)) { recipient = line; socket.write(rejected ? '550 refused\r\n' : '250 recipient accepted\r\n'); }
                else if (line === 'DATA') { receiving = true; message = ''; socket.write('354 end with dot\r\n'); }
                else if (line === 'QUIT') { socket.end('221 bye\r\n'); }
                else socket.write('250 ok\r\n');
            }
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
    return { port: server.address().port, delivered, envelopes, reject: () => { rejected = true; } };
}
test('PHP mail: protected browser settings, strict TLS/auth, real SMTP acceptance, no false success', { timeout: 60000 }, async t => {
    const f = await fixture(t), owner = f.client(), visitor = f.client(); await owner.session();
    const credentials = { activationKey: f.activationKey, username: 'site-owner', password: 'Secure mail administration test 42' };
    await owner.call('setup', credentials); await owner.call('login', credentials);
    const publicOptions = { rawPath: '/admin/contact.php', headers: { Origin: f.origin } };
    assert.equal((await visitor.call('', undefined, publicOptions)).status, 503, 'no unconfigured mail pretends to work');
    assert.equal((await visitor.call('mail-settings')).status, 401);
    const server = await smtp(t, f.privateKey, f.certificate);
    const config = { enabled: true, host: 'localhost', port: server.port, security: 'smtps', username: 'smtp-owner', password: 'smtp-fixture-password', from: 'webmaster@example.test', to: 'owner@example.test' };
    assert.equal((await owner.call('mail-settings', config, { headers: { 'X-TCG-CSRF': 'forged' } })).status, 403);
    assert.equal((await owner.call('mail-settings', config)).status, 200);
    const verify = await owner.call('mail-verify', {}); assert.equal(verify.status, 200, verify.data.error); assert.equal(server.delivered.length, 0, 'connection check sends no mail');
    const shown = (await owner.call('mail-settings')).data; assert.equal(shown.hasPassword, true); assert.ok(!JSON.stringify(shown).includes(config.password));
    const prepare = await visitor.call('', undefined, publicOptions); assert.equal(prepare.status, 200);
    const fields = { Name: 'Fixture visitor', Email: 'visitor@example.test', Address: 'Local SMTP end-to-end test' };
    const postOptions = { rawPath: '/admin/contact.php', headers: { 'X-TCG-Token': prepare.data.token } };
    const accepted = await visitor.call('', { page: '/feedback/', website: '', fields }, postOptions); assert.equal(accepted.status, 200, accepted.data.error); assert.equal(accepted.data.ok, true);
    assert.equal(server.delivered.length, 1); assert.match(server.delivered[0], /Reply-To: visitor@example.test/); assert.match(server.delivered[0], /Local SMTP end-to-end test/); assert.equal(server.envelopes[0], 'RCPT TO:<owner@example.test>');
    assert.equal((await visitor.call('', { page: '/feedback/', fields }, postOptions)).status, 429, 'public token cannot be replayed');
    const token2 = (await visitor.call('', undefined, publicOptions)).data.token;
    assert.equal((await visitor.call('', { page: '/feedback/', fields: { ...fields, Email: 'visitor@example.test\r\nBcc: other@example.test' } }, { ...postOptions, headers: { 'X-TCG-Token': token2 } })).status, 400);
    server.reject(); const rejected = await visitor.call('', { page: '/feedback/', fields }, { ...postOptions, headers: { 'X-TCG-Token': token2 } }); assert.equal(rejected.status, 502); assert.equal(rejected.data.ok, undefined); assert.equal(server.delivered.length, 1);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-untrusted-mail-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'key'), '-out', path.join(directory, 'cert'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const untrusted = await smtp(t, fs.readFileSync(path.join(directory, 'key')), fs.readFileSync(path.join(directory, 'cert')));
    await owner.call('mail-settings', { ...config, port: untrusted.port });
    const badTLS = await owner.call('mail-verify', {}); assert.equal(badTLS.status, 502, 'an untrusted certificate cannot disable TLS verification'); assert.equal(untrusted.delivered.length, 0);
    assert.ok(!JSON.stringify(badTLS.data).includes(config.password));
});
