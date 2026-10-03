const test = require('node:test');
const assert = require('node:assert/strict');
const { createContact } = require('../lib/contact');
const { createApp } = require('../server');
async function setup(t, options = {}) {
    const received = [];
    const contact = createContact({ env: { CONTACT_FROM: 'site@example.com', CONTACT_TO: 'owner@example.com', ...options.env },
        sendMail: options.disabled ? undefined : async mail => { received.push(mail); return options.result || { accepted: ['owner@example.com'] }; } });
    const server = createApp({ contact }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    async function submit(body, headers = {}) {
        const { token } = await (await fetch(origin + '/api/contact', { headers: { Referer: origin + '/feedback/' } })).json();
        return fetch(origin + '/api/contact', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-TCG-Token': token, ...headers }, body: JSON.stringify(body) });
    }
    return { origin, submit, received };
}
const message = () => ({ page: '/feedback/', fields: { Name: 'Тест', Email: 'visitor@example.com', 'Заметки': 'Без реальної пошти' } });
test('contact succeeds only after mail acceptance and sends only to the configured owner', async t => {
    const { submit, received } = await setup(t);
    const response = await submit(message());
    assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
    assert.equal(received[0].to, 'owner@example.com'); assert.equal(received[0].replyTo, 'visitor@example.com');
    assert.equal((await submit(message())).status, 429); assert.equal(received.length, 1);
});
test('invalid fields, header injection, honeypots, tokens and cross-site requests cannot send mail', async t => {
    const { submit, received, origin } = await setup(t);
    for (const value of [{ ...message(), page: '/admin/' }, { ...message(), website: 'bot' },
        { ...message(), fields: { ...message().fields, to: 'other@example.com' } },
        { ...message(), fields: { ...message().fields, Email: 'v@example.com\r\nBcc:other@example.com' } },
        { ...message(), fields: { Email: 'v@example.com' } }]) assert.equal((await submit(value)).status, 400);
    assert.equal((await submit(message(), { 'X-TCG-Token': 'fake' })).status, 403);
    assert.equal((await fetch(origin + '/api/contact', { headers: { Origin: 'https://other.example.com' } })).status, 403);
    assert.equal((await submit({ ...message(), fields: { ...message().fields, 'Заметки': 'x'.repeat(20000) } })).status, 413);
    assert.equal(received.length, 0);
});
test('missing configuration and rejected mail return errors without a false success', async t => {
    const a = await setup(t, { disabled: true });
    assert.equal((await fetch(a.origin + '/api/contact', { headers: { Origin: a.origin } })).status, 503);
    const b = await setup(t, { result: { accepted: [], rejected: ['owner@example.com'] } });
    const response = await b.submit(message()); assert.equal(response.status, 502); assert.equal((await response.json()).ok, undefined);
});
test('an explicitly configured static-host origin receives CORS access', async t => {
    const { origin } = await setup(t, { env: { CONTACT_ALLOWED_ORIGINS: 'https://static.example.com' } });
    const response = await fetch(origin + '/api/contact', { headers: { Origin: 'https://static.example.com' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), 'https://static.example.com');
    const preflight = await fetch(origin + '/api/contact', { method: 'OPTIONS', headers: { Origin: 'https://static.example.com' } });
    assert.equal(preflight.status, 204);
});
