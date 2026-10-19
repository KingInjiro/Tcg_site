const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { websiteFiles, sourceWebsiteFiles } = require('../lib/site-export');
const { isPage, pageProblem } = require('../admin/repository');
const { outputFile } = require('../themes/routes');
const root = path.resolve(__dirname, '..');
const phpArray = value => "<?php\nif (!defined('TCG_ENTRY')) { http_response_code(404); exit; }\nreturn json_decode(base64_decode('" + Buffer.from(JSON.stringify(value)).toString('base64') + "'), true, 128, JSON_THROW_ON_ERROR);\n";

// Development/release preparation only. No build tools are required on hosting.
function preparePHP(destination, { activationKey = crypto.randomBytes(32).toString('base64url') } = {}) {
    if (fs.existsSync(destination)) throw new Error('Destination must be a new directory.');
    fs.mkdirSync(destination, { recursive: true });
    const initial = websiteFiles(root);
    fs.copyFileSync(path.join(root, 'php/public/INSTALL.txt'), path.join(destination, 'INSTALL.txt'));
    for (const file of initial) {
        const target = path.join(destination, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content);
    }
    fs.cpSync(path.join(root, 'php/public/admin'), path.join(destination, 'admin'), { recursive: true });
    fs.cpSync(path.join(root, 'php/runtime'), path.join(destination, 'admin/_app'), { recursive: true });
    fs.cpSync(path.join(root, 'php/vendor'), path.join(destination, 'admin/_app/vendor'), { recursive: true });
    for (const file of ['builder.css', 'builder.js', 'repository.js', 'document.js']) fs.copyFileSync(path.join(root, 'admin', file), path.join(destination, 'admin', file));
    const editor = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8').replace('<html lang="uk">', '<html lang="uk" data-tcg-backend="php">').replace('<script defer src="/admin/builder.js"></script>', '<script defer src="/admin/php-repository.js"></script><script defer src="/admin/php-controls.js"></script><script defer src="/admin/grapes-uk.js"></script><script defer src="/admin/builder.js"></script>');
    fs.writeFileSync(path.join(destination, 'admin/index.html'), editor);
    const grapes = path.dirname(require.resolve('grapesjs'));
    fs.mkdirSync(path.join(destination, 'admin/vendor'), { recursive: true });
    for (const [from, to] of [['grapes.min.js', 'grapes.min.js'], ['css/grapes.min.css', 'grapes.min.css'], ['../LICENSE', 'LICENSE.txt']]) fs.copyFileSync(path.join(grapes, from), path.join(destination, 'admin/vendor', to));
    const source = sourceWebsiteFiles(root);
    const seed = Object.fromEntries([...source].filter(([file, content]) => isPage(file) && !pageProblem(content.toString('utf8'))).map(([file, content]) => [file, content.toString('utf8')]));
    const managedPaths = new Set(['sw.js', 'site-version.json', 'themes/search-index.json', 'themes/contact-config.json']);
    for (const file of Object.keys(seed)) for (const name of [file, outputFile(file)]) { managedPaths.add(name); managedPaths.add(name.replace(/\.html?$/i, '.htm')); }
    const contact = initial.find(file => file.path === 'themes/contact-config.json');
    if (!contact) throw new Error('Contact configuration missing.');
    contact.content = Buffer.from(JSON.stringify({ endpoint: '/admin/contact.php' }));
    fs.writeFileSync(path.join(destination, contact.path), contact.content);
    const hashes = initial.map(file => [file.path, crypto.createHash('sha256').update(file.content).digest('hex')]);
    const managed = Object.fromEntries(hashes.filter(([name]) => managedPaths.has(name)));
    const staticFiles = Object.fromEntries(hashes.filter(([name]) => !managedPaths.has(name)));
    const compilerHash = crypto.createHash('sha256');
    const fingerprint = directory => { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const file = path.join(directory, entry.name); if (entry.isDirectory()) fingerprint(file); else compilerHash.update(entry.name).update(fs.readFileSync(file)); } };
    fingerprint(path.join(root, 'php/runtime')); fingerprint(path.join(root, 'php/vendor'));
    fs.copyFileSync(path.join(root, 'sw.js'), path.join(destination, 'admin/_app/worker.txt'));
    fs.writeFileSync(path.join(destination, 'admin/_app/release.php'), phpArray({ activationHash: crypto.createHash('sha256').update(activationKey).digest('hex'), format: 1, assets: [...source.keys()].filter(file => /^(?:images|derived|themes|[\w.-]+\.files)\//.test(file)), managed, staticFiles, compiler: compilerHash.digest('hex') }));
    fs.writeFileSync(path.join(destination, 'admin/_app/seed.php'), phpArray(seed));
    // Deliberately never write the activation key anywhere under the web root.
    return { destination, activationKey };
}
if (require.main === module) {
    const destination = process.argv[2]; if (!destination) throw new Error('Pass a new staging directory.');
    const result = preparePHP(path.resolve(destination));
    process.stdout.write('PHP staging prepared. Use scripts/package-php.js for a validated distributable ZIP.\n');
    const keyPath = path.join(path.dirname(result.destination), 'tcg-activation-' + crypto.randomBytes(8).toString('hex') + '.txt');
    fs.writeFileSync(keyPath, result.activationKey + '\n', { mode: 0o600, flag: 'wx' });
    process.stdout.write('Activation key stored outside staging: ' + keyPath + '\n');
}
module.exports = { preparePHP, phpArray };
