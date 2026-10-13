'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { websiteFiles } = require('../lib/site-export');

function configuration(env) {
    const protocol = env.STATIC_PROTOCOL, host = env.STATIC_HOST, user = env.STATIC_USER, directory = env.STATIC_DIRECTORY;
    if (!['sftp', 'ftps'].includes(protocol)) throw new Error('Set STATIC_PROTOCOL to sftp or ftps.');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host || '') || !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/.test(user || '')) throw new Error('Invalid hosting hostname or username.');
    if (!directory || /[\x00-\x1f\x7f"\\*?\[\]]/.test(directory) || directory.split('/').includes('..') || !directory.replace(/[/.]/g, '').trim()) throw new Error('Set a dedicated STATIC_DIRECTORY, such as /public_html. The server root is not allowed.');
    const port = Number(env.STATIC_PORT || (protocol === 'sftp' ? 22 : 21));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid hosting port.');
    if (protocol === 'sftp' && (!env.STATIC_SSH_KEY || !env.STATIC_KNOWN_HOSTS)) throw new Error('SFTP requires STATIC_SSH_KEY and verified STATIC_KNOWN_HOSTS.');
    if (protocol === 'ftps' && (!env.STATIC_PASSWORD || /[\x00-\x1f\x7f]/.test(env.STATIC_PASSWORD))) throw new Error('FTPS requires STATIC_PASSWORD without control characters.');
    let endpoint;
    try { endpoint = new URL(env.CONTACT_FORM_ENDPOINT); } catch { throw new Error('Set CONTACT_FORM_ENDPOINT to the HTTPS address of the separate mail backend.'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw new Error('CONTACT_FORM_ENDPOINT must be a public HTTPS endpoint without credentials.');
    return { protocol, host, port, user, directory: directory.replace(/\/$/, '') };
}
const quoted = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function orderedFiles(files) {
    for (const file of files) if (file.path.startsWith('/') || file.path.split('/').includes('..') || /[\x00-\x1f\x7f\\*?\[\]]/.test(file.path)) throw new Error('Unsupported export filename.');
    const rank = file => file.path === 'sw.js' ? 2 : /\.html?$/i.test(file.path) ? 1 : 0;
    return [...files].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

function upload(files, env = process.env, execute = execFileSync) {
    const config = configuration(env), ordered = orderedFiles(files);
    if (!/^[a-f0-9]{40}$/.test(env.SITE_REVISION || '')) throw new Error('A checked SITE_REVISION is required.');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-upload-'));
    const suffix = '.tcg-' + env.SITE_REVISION.slice(0, 12) + '.tmp';
    try {
        const local = path.join(temporary, 'public'); fs.mkdirSync(local);
        for (const file of ordered) { const target = path.join(local, file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content); }
        const childEnv = { PATH: process.env.PATH, LANG: 'C.UTF-8' };
        if (config.protocol === 'sftp') {
            const key = path.join(temporary, 'key'), known = path.join(temporary, 'known_hosts'), batch = path.join(temporary, 'batch');
            fs.writeFileSync(key, env.STATIC_SSH_KEY.trim() + '\n', { mode: 0o600 });
            fs.writeFileSync(known, env.STATIC_KNOWN_HOSTS.trim() + '\n', { mode: 0o600 });
            const commands = ['cd ' + quoted(config.directory)], directories = new Set();
            for (const file of ordered) {
                const parts = file.path.split('/'); parts.pop(); let dir = '';
                for (const part of parts) { dir = dir ? dir + '/' + part : part; if (!directories.has(dir)) { directories.add(dir); commands.push('-mkdir ' + quoted(dir)); } }
                commands.push('put ' + quoted(path.join(local, file.path)) + ' ' + quoted(file.path + suffix));
                commands.push('rename ' + quoted(file.path + suffix) + ' ' + quoted(file.path));
            }
            fs.writeFileSync(batch, commands.join('\n') + '\n', { mode: 0o600 });
            execute('sftp', ['-F', '/dev/null', '-b', batch, '-i', key, '-P', String(config.port), '-oBatchMode=yes', '-oIdentitiesOnly=yes', '-oStrictHostKeyChecking=yes', '-oUserKnownHostsFile=' + known, '-oConnectTimeout=15', '-oServerAliveInterval=15', '-oServerAliveCountMax=3', '--', config.user + '@' + config.host], { env: childEnv, stdio: 'pipe', timeout: 1200000, maxBuffer: 8 * 1024 * 1024 });
        } else {
            const commands = [];
            for (const file of ordered) {
                if (commands.length) commands.push('next');
                const remote = config.directory + '/' + file.path + suffix;
                commands.push('silent', 'show-error', 'globoff', 'ssl-reqd', 'ftp-create-dirs', 'connect-timeout = 15', 'max-time = 90', 'proto = "=ftp"',
                    'user = ' + quoted(config.user + ':' + env.STATIC_PASSWORD),
                    'url = ' + quoted('ftp://' + config.host + ':' + config.port + '/' + remote.split('/').map(encodeURIComponent).join('/')),
                    'upload-file = ' + quoted(path.join(local, file.path)),
                    'quote = ' + quoted('-RNFR ' + path.posix.basename(file.path) + suffix),
                    'quote = ' + quoted('-RNTO ' + path.posix.basename(file.path)));
            }
            const settings = path.join(temporary, 'curl.conf'); fs.writeFileSync(settings, commands.join('\n') + '\n', { mode: 0o600 });
            execute('curl', ['-q', '--fail-early', '--config', settings], { env: childEnv, stdio: 'pipe', timeout: 1200000, maxBuffer: 1024 * 1024 });
        }
        return ordered.length;
    } catch (error) {
        // Transfer tools may echo credentials or server banners in raw errors.
        if (error.status !== undefined || error.code) throw new Error('Hosting upload failed. Check credentials, host verification, directory permissions and workflow settings. Earlier uploaded files may already be updated; retry this checked release.');
        throw error;
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (require.main === module) {
    try {
        configuration(process.env);
        if (!process.env.SITE_SOURCE) throw new Error('SITE_SOURCE must point to the checked release.');
        const count = upload(websiteFiles(process.env.SITE_SOURCE));
        console.log('Uploaded ' + count + ' public files. The service worker was uploaded last.');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { configuration, orderedFiles, upload };
