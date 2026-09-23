const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { publicEntries } = require('./lib/site-files');
const { createOAuth } = require('./lib/github-oauth');
const { createLocalEditor } = require('./lib/editor-local');

function createApp({ dev = false, oauth = createOAuth(), root = __dirname } = {}) {
    const app = express();
    const publicPath = path.join(root, 'dist');
    const contentPath = dev ? root : publicPath;
    const allowed = new Set(publicEntries(contentPath));
    app.disable('x-powered-by');
    app.get('/api/auth', oauth.auth);
    app.get('/api/callback', oauth.callback);
    if (dev) app.use('/api/editor-local', express.json({ limit: '12mb' }), createLocalEditor(root));
    app.use('/api', (_req, res) => res.sendStatus(404));
    app.use('/admin', (_req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
        next();
    });
    app.use((req, res, next) => {
        let reqPath;
        try { reqPath = decodeURIComponent(req.path); }
        catch { return res.sendStatus(400); }
        if (reqPath === '/') reqPath = '/index.html';
        // Keep legacy .htm links and case-insensitive filenames working.
        const absolute = path.resolve(contentPath, '.' + reqPath);
        if (!absolute.startsWith(contentPath + path.sep)) return res.sendStatus(404);
        if (!fs.existsSync(absolute)) {
            const directory = path.dirname(absolute);
            try {
                const base = path.basename(reqPath).toLowerCase();
                const match = fs.readdirSync(directory).find(file =>
                    file.toLowerCase() === base || (base.endsWith('.htm') && file.toLowerCase() === base + 'l'));
                if (match) reqPath = path.posix.join(path.posix.dirname(reqPath), match);
            } catch { /* Let the static server return 404. */ }
        }
        if (!allowed.has(reqPath.split('/')[1]) && !(dev && publicEntries(contentPath).includes(reqPath.split('/')[1]))) return res.sendStatus(404);
        const queryIndex = req.url.indexOf('?');
        req.url = reqPath + (queryIndex < 0 ? '' : req.url.slice(queryIndex));
        if (reqPath === '/sw.js') res.set('Cache-Control', 'no-cache');
        next();
    });
    // In local editing mode, serve changed source content immediately.
    if (dev) app.use(express.static(contentPath, { dotfiles: 'deny' }));
    app.use(express.static(publicPath, { dotfiles: 'deny' }));
    return app;
}

if (require.main === module) {
    const dev = process.argv.includes('--dev');
    const port = process.env.PORT || 3000;
    createApp({ dev }).listen(port, dev ? '127.0.0.1' : '0.0.0.0', () => {
        console.log(`Server listening on http://localhost:${port}`);
    });
}
module.exports = { createApp };
