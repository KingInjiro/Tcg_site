// Build-only. Do not run the production packager or create production secrets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { preparePHP } = require('./prepare-php');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2]);
const expected = JSON.parse(fs.readFileSync(path.join(root, 'windows-demo/release-manifest.json')));
// No known seed password/key exists, even if boot configuration is interrupted.
preparePHP(target, { activationKey: crypto.randomBytes(32).toString('base64url') });
const files = {};
function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else {
            const relative = path.relative(target, file).split(path.sep).join('/');
            let data = fs.readFileSync(file);
            if (relative === 'admin/_app/release.php') {
                const value = JSON.parse(Buffer.from(data.toString().match(/base64_decode\('([^']+)'\)/)[1], 'base64'));
                delete value.activationHash;
                data = Buffer.from(JSON.stringify(value));
            }
            files[relative] = crypto.createHash('sha256').update(data).digest('hex');
        }
    }
}
visit(target);
if (JSON.stringify(Object.entries(files).sort()) !== JSON.stringify(Object.entries(expected.files).sort())) {
    const different = [...new Set([...Object.keys(files), ...Object.keys(expected.files)])].filter(name => files[name] !== expected.files[name]);
    throw new Error('Demo differs from immutable production ZIP (activation hash excluded): ' + different.join(', '));
}
console.log(`Verified ${Object.keys(files).length} release files against ${expected.archiveSha256}. Only the demo activation hash differs.`);
