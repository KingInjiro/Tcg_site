const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { preparePHP } = require('./prepare-php');
const { zip } = require('../lib/zip');
function packagePHP(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-php-package-'));
    try {
        const stage = path.join(temporary, 'public'), { activationKey } = preparePHP(stage), files = [];
        const walk = (dir, prefix = '') => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
                if (entry.isSymbolicLink()) throw new Error('Release contains a symlink.');
                const file = prefix + entry.name, absolute = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(absolute, file + '/');
                else {
                    if (/(^|\/)(?:node_modules|\.git|\.env|tests|exports|\.tcg-editor)(?:\/|$)/.test(file) || /(?:owner|mail|state|attempts)\.json$/.test(file)) throw new Error('Private/development file in release: ' + file);
                    const content = fs.readFileSync(absolute);
                    if (content.includes(Buffer.from(activationKey))) throw new Error('Activation key leaked into public release.');
                    files.push({ path: file, content });
                }
            }
        }; walk(stage);
        for (const name of ['index.html', 'sw.js', 'site-version.json', 'admin/index.html', 'admin/api.php', 'admin/diagnostic.php', 'admin/compatibility.html', 'admin/contact.php', 'admin/_app/Publisher.php', 'admin/_app/seed.php', 'admin/_app/release.php', 'admin/vendor/grapes.min.js']) if (!files.some(file => file.path === name)) throw new Error('Required release file missing: ' + name);
        const archive = zip(files), sha256 = crypto.createHash('sha256').update(archive).digest('hex');
        const name = 'tcg-php-' + sha256.slice(0, 12), archivePath = path.join(directory, name + '.zip'), activationPath = path.join(directory, name + '-activation.txt');
        fs.writeFileSync(archivePath, archive, { flag: 'wx', mode: 0o600 });
        fs.writeFileSync(activationPath, 'Ключ початкового налаштування TCG:\n' + activationKey + '\n\nЦей файл НЕ завантажувати на хостинг і не публікувати. Вставте ключ лише у форму HTTPS /admin/ після розпакування ZIP. Логін і пароль створюються у браузері.\n', { flag: 'wx', mode: 0o600 });
        const manifest = { archive: path.basename(archivePath), sha256, archiveBytes: archive.length, unpackedBytes: files.reduce((sum, file) => sum + file.content.length, 0), files: files.length };
        fs.writeFileSync(path.join(directory, name + '-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
        return { ...manifest, archivePath, activationPath };
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (require.main === module) process.stdout.write(JSON.stringify(packagePHP(path.resolve(process.argv[2] || 'exports/php')), null, 2) + '\n');
module.exports = { packagePHP };
