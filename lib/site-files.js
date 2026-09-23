const fs = require('node:fs');

// Only website content belongs in the public build, never server code or secrets.
const directories = new Set(['admin', 'images', 'derived', 'themes', 'Docs', 'ListPage']);
const files = new Set(['sw.js', 'manifest.json']);

function publicEntries(root) {
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => {
        if (entry.isSymbolicLink() || entry.name.startsWith('.')) return false;
        if (entry.isDirectory()) return directories.has(entry.name) || entry.name.endsWith('.files');
        return files.has(entry.name) || (
            /\.html?$/i.test(entry.name) && !/^(test_|temp\.)/i.test(entry.name)
        );
    }).map(entry => entry.name);
}

module.exports = { publicEntries };
