const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isPage, isImage, isProject, validateChanges, conflict } = require('../admin/repository');

// Mounted only by the explicit development server, never by a Vercel function.
function createLocalEditor(root) {
    function safePath(name) {
        if (!(isPage(name) || isImage(name) || isProject(name))) throw new Error('Недозволений файл.');
        const full = path.resolve(root, name);
        if (!full.startsWith(root + path.sep)) throw new Error('Недозволений шлях.');
        let current = root;
        for (const part of name.split('/')) {
            current = path.join(current, part);
            if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Символічні посилання заборонені.');
        }
        return full;
    }
    function snapshot() {
        const files = [];
        function walk(dir, prefix = '') {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) continue;
                const name = prefix + entry.name;
                if (entry.isDirectory()) {
                    if (prefix || ['Docs', 'ListPage', 'images', 'derived', '.tcg-editor'].includes(name) || name.endsWith('.files')) walk(path.join(dir, entry.name), name + '/');
                } else if (isPage(name) || isProject(name) || isImage(name)) {
                    const stat = fs.statSync(path.join(root, name));
                    const sha = isImage(name) ? stat.size + '-' + stat.mtimeMs : crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
                    files.push({ path: name, sha, type: 'blob' });
                }
            }
        }
        walk(root);
        files.sort((a, b) => a.path.localeCompare(b.path));
        return { files, head: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex') };
    }
    return function editorLocal(req, res) {
        res.set('Cache-Control', 'no-store');
        const host = req.headers.host;
        const peer = req.socket.remoteAddress;
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host || '') || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) ||
            (req.headers.origin && req.headers.origin !== 'http://' + host) || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Локальний доступ заборонений.' });
        try {
            if (req.method === 'GET' && req.query.action === 'tree') return res.json(snapshot());
            if (req.method === 'GET' && req.query.action === 'read') {
                const file = safePath(req.query.path);
                if (isImage(req.query.path)) return res.status(400).json({ error: 'Очікується HTML або проєкт.' });
                return res.json({ content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null });
            }
            if (req.method !== 'POST') return res.sendStatus(405);
            if (req.headers.origin !== 'http://' + host || !req.is('application/json')) return res.status(403).json({ error: 'Неправильне джерело запиту.' });
            validateChanges(req.body?.changes);
            if (req.body.head !== snapshot().head) return res.status(409).json({ error: conflict });
            const writes = req.body.changes.map(file => ({ ...file, full: safePath(file.path) }));
            const originals = writes.map(file => fs.existsSync(file.full) ? fs.readFileSync(file.full) : null);
            // Validate all paths before writing; roll back the batch on a filesystem error.
            try {
                for (const file of writes) {
                    fs.mkdirSync(path.dirname(file.full), { recursive: true });
                    fs.writeFileSync(file.full, Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8'));
                }
            } catch (error) {
                writes.forEach((file, i) => {
                    if (originals[i] === null) fs.rmSync(file.full, { force: true });
                    else fs.writeFileSync(file.full, originals[i]);
                });
                throw error;
            }
            return res.json({ head: snapshot().head });
        } catch (error) { return res.status(400).json({ error: error.message }); }
    };
}
module.exports = { createLocalEditor };
