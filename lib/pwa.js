const crypto = require('node:crypto');

// The server build and portable ZIP receive the same versioned worker.
function addPWA(files, pageRoutes, aliases) {
    if (!files.has('sw.js')) return files;
    const entries = new Map(pageRoutes.map(([url, file]) => [url, files.get(file)]));
    for (const [name, data] of files) {
        if (/^(?:images|derived|themes|[\w.-]+\.files)\//.test(name) &&
            /\.(?:css|js|png|jpe?g|gif|webp|svg|woff2?)$/i.test(name)) entries.set('/' + name, data);
    }
    for (const name of ['manifest.json', 'favicon.ico', 'themes/offline.html', 'themes/search-index.json']) {
        if (files.has(name)) entries.set('/' + name, files.get(name));
    }
    const hash = crypto.createHash('sha256').update(files.get('sw.js'));
    for (const [url, data] of [...entries].sort(([a], [b]) => a.localeCompare(b))) hash.update(url).update(data);
    const config = { version: hash.digest('hex').slice(0, 20), urls: [...entries.keys()].map(encodeURI), aliases };
    // Hash the source first: the generated version must not hash itself.
    for (const [, file] of pageRoutes) {
        let html = files.get(file).toString('utf8').replace(/<\/head>/i,
            '<meta name="tcg-build" content="' + config.version + '">\n</head>');
        // Also works on static hosting and when service workers are disabled:
        // changed CSS/JS cannot reuse a fresh HTTP-cache entry from an old build.
        html = html.replace(/<(?:link|script)\b[^>]*>/gi, tag => tag.replace(/\b(href|src)="(\/[^"?]+\.(?:css|js))"/gi,
            (attribute, name, url) => entries.has(decodeURI(url)) ? name + '="' + url + '?v=' + config.version + '"' : attribute));
        files.set(file, Buffer.from(html));
    }
    files.set('site-version.json', Buffer.from(JSON.stringify({ version: config.version }) + '\n'));
    files.set('sw.js', Buffer.from(files.get('sw.js').toString('utf8').replace('/* TCG_BUILD_CONFIG */', 'self.TCG_PWA = ' + JSON.stringify(config) + ';')));
    return files;
}

module.exports = { addPWA };
