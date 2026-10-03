const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

function ensureDependencies(directory = root) {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Потрібен Node.js 24 LTS. Встановіть його з https://nodejs.org/en/download і запустіть редактор знову.');
    const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'package-lock.json'))).update(process.platform + process.arch + process.versions.node).digest('hex');
    const stamp = path.join(directory, 'node_modules', '.tcg-editor-dependencies');
    const present = ['express', 'grapesjs', 'nodemailer'].every(name => fs.existsSync(path.join(directory, 'node_modules', name, 'package.json')));
    if (present && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === fingerprint) return;
    console.log('Перший запуск або оновлення: встановлюю компоненти редактора. Потрібен інтернет; зачекайте завершення.');
    // Arguments are fixed; no credentials, paths or user input enter a shell command.
    const install = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: directory, stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (install.error || install.status !== 0) throw new Error('Не вдалося встановити компоненти. Перевірте інтернет і вільне місце, потім запустіть ще раз. Деталі помилки — вище.');
    fs.writeFileSync(stamp, fingerprint);
}

function openBrowser(url) {
    const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'start "" "' + url + '"'] : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log('Браузер не відкрився автоматично. Скопіюйте адресу вище у браузер.'));
    child.on('exit', code => { if (code) console.log('Відкрийте адресу редактора вище у браузері.'); });
    child.unref();
}

async function startEditor({ directory = root, browser = true } = {}) {
    const { build } = require('./build');
    const { createApp } = require('../server');
    build(directory);
    // A free loopback port avoids conflicts with an existing site or another app.
    // Never bind the unauthenticated editor to the network, even if PORT is set.
    const server = createApp({ dev: true, root: directory }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const url = 'http://127.0.0.1:' + server.address().port + '/admin/?local=true';
    console.log('\nРедактор готовий: ' + url);
    console.log('Робоча папка: ' + directory);
    console.log('Залишайте це вікно відкритим під час редагування.');
    console.log('Перед завершенням збережіть зміни. Для зупинки натисніть Ctrl+C або закрийте це вікно.\n');
    if (browser) openBrowser(url);
    return server;
}

if (require.main === module) {
    (async () => {
        ensureDependencies();
        const server = await startEditor({ browser: !process.argv.includes('--no-open') });
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
            server.closeAllConnections(); server.close(() => process.exit(0));
        });
    })().catch(error => { console.error('\n' + error.message); process.exitCode = 1; });
}
module.exports = { ensureDependencies, startEditor };
