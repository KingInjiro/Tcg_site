const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { websiteFiles, sourceWebsiteFiles } = require('../lib/site-export');
const { isPage, pageProblem } = require('../admin/repository');
const root = path.resolve(__dirname, '..');
const phpArray = value => "<?php\nif (!defined('TCG_ENTRY')) { http_response_code(404); exit; }\nreturn json_decode(base64_decode('" + Buffer.from(JSON.stringify(value)).toString('base64') + "'), true, 128, JSON_THROW_ON_ERROR);\n";

// Development/release preparation only. No build tools are required on hosting.
function preparePHP(destination, { activationKey = crypto.randomBytes(32).toString('base64url') } = {}) {
    if (fs.existsSync(destination)) throw new Error('Destination must be a new directory.');
    fs.mkdirSync(destination, { recursive: true });
    for (const file of websiteFiles(root)) {
        const target = path.join(destination, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content);
    }
    fs.cpSync(path.join(root, 'php/public/admin'), path.join(destination, 'admin'), { recursive: true });
    fs.cpSync(path.join(root, 'php/runtime'), path.join(destination, 'admin/_app'), { recursive: true });
    for (const file of ['builder.css', 'builder.js', 'repository.js', 'document.js']) fs.copyFileSync(path.join(root, 'admin', file), path.join(destination, 'admin', file));
    const editor = fs.readFileSync(path.join(root, 'admin/index.html'), 'utf8').replace('<html lang="uk">', '<html lang="uk" data-tcg-backend="php">').replace('<script defer src="/admin/builder.js"></script>', '<script defer src="/admin/php-repository.js"></script><script defer src="/admin/builder.js"></script>');
    fs.writeFileSync(path.join(destination, 'admin/index.html'), editor);
    const grapes = path.dirname(require.resolve('grapesjs'));
    fs.mkdirSync(path.join(destination, 'admin/vendor'), { recursive: true });
    for (const [from, to] of [['grapes.min.js', 'grapes.min.js'], ['css/grapes.min.css', 'grapes.min.css'], ['../LICENSE', 'LICENSE.txt']]) fs.copyFileSync(path.join(grapes, from), path.join(destination, 'admin/vendor', to));
    const source = sourceWebsiteFiles(root);
    const seed = Object.fromEntries([...source].filter(([file, content]) => isPage(file) && !pageProblem(content.toString('utf8'))).map(([file, content]) => [file, content.toString('utf8')]));
    fs.writeFileSync(path.join(destination, 'admin/_app/release.php'), phpArray({ activationHash: crypto.createHash('sha256').update(activationKey).digest('hex'), format: 1, assets: [...source.keys()].filter(file => /^(?:images|derived|themes|[\w.-]+\.files)\//.test(file)) }));
    fs.writeFileSync(path.join(destination, 'admin/_app/seed.php'), phpArray(seed));
    // Deliberately never write the activation key anywhere under the web root.
    return { destination, activationKey };
}
if (require.main === module) {
    const destination = process.argv[2]; if (!destination) throw new Error('Pass a new staging directory.');
    const result = preparePHP(path.resolve(destination));
    process.stdout.write('M2 staging only — autonomous PHP publishing is not complete.\n');
    const keyPath = path.join(path.dirname(result.destination), 'tcg-activation-' + crypto.randomBytes(8).toString('hex') + '.txt');
    fs.writeFileSync(keyPath, result.activationKey + '\n', { mode: 0o600, flag: 'wx' });
    process.stdout.write('Activation key stored outside staging: ' + keyPath + '\n');
}
module.exports = { preparePHP, phpArray };
