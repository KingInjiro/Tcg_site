const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./fixture.cjs');
test('Unsafe or incomplete PHP refuses activation while static HTML remains available', { timeout: 60000 }, async t => {
    // Apache tests exercise real permissions; startup ini overrides belong only to native fixtures.
    if (process.env.TCG_APACHE_IMAGE) { t.skip('Native-only disabled-function configuration; Apache permissions covered by API suite'); return; }
    const f = await fixture(t, { ini: ['disable_functions=imagecreatefromstring'] }), owner = f.client();
    assert.equal((await owner.session()).status, 200);
    const setup = await owner.call('setup', { activationKey: f.activationKey, username: 'site-owner', password: 'Missing extension test password 42' });
    assert.equal(setup.status, 503); assert.match(setup.data.error, /GD/); assert.equal(fs.existsSync(path.join(f.privateRoot, 'owner.json')), false);
    assert.equal((await owner.call('', undefined, { rawPath: '/' })).status, 200);
    const unsafe = await fixture(t, { ini: ['disable_functions=ini_set'] });
    assert.equal((await unsafe.client().session()).status, 503);
    assert.equal((await unsafe.client().call('', undefined, { rawPath: '/' })).status, 200);
});
