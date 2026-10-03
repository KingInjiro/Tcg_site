const fs = require('node:fs');
const path = require('node:path');
const { publicEntries, isPublicContent } = require('./site-files');
const { zip } = require('./zip');
const { cleanWebsite } = require('./site-routes');

function sourceWebsiteFiles(root) {
    const files = new Map();
    let size = 0;
    function walk(name) {
        const full = path.join(root, name), stat = fs.lstatSync(full);
        if (stat.isSymbolicLink() || path.basename(name).startsWith('.')) return;
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(full).sort()) walk(name + '/' + child);
        } else if (stat.isFile() && isPublicContent(full)) {
            size += stat.size;
            if (size > 64 * 1024 * 1024) throw new Error('Сайт завеликий для експорту (максимум 64 МБ вихідних файлів).');
            files.set(name, fs.readFileSync(full));
        }
    }
    // No login/backend, development files, drafts or secrets on a static host.
    for (const name of publicEntries(root).sort()) if (name !== 'admin') walk(name);
    if (!files.has('index.html')) throw new Error('Не знайдено головну сторінку index.html.');
    return files;
}

function websiteFiles(root) {
    const files = cleanWebsite(sourceWebsiteFiles(root));

    // This legacy URL is a server redirect in Express/Vercel. On an ordinary
    // static host provide a real HTML download page instead of the binary .html.
    if (files.has('Docs/Sno_for_Buh_ua.ert')) files.set('Docs/Sno_for_Buh_ua.html', Buffer.from(
        '<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=Sno_for_Buh_ua.ert"><title>Завантаження документа 1С</title></head><body><a href="Sno_for_Buh_ua.ert" download>Завантажити документ 1С (.ert)</a></body></html>'));

    // Preserve old .htm bookmarks without requiring rewrite rules or PHP.
    const existing = new Set([...files.keys()].map(name => name.toLowerCase()));
    for (const [name, content] of [...files]) if (/\.html$/i.test(name)) {
        const alias = name.slice(0, -1);
        if (!existing.has(alias.toLowerCase())) { files.set(alias, content); existing.add(alias.toLowerCase()); }
    }
    return [...files].map(([path, content]) => ({ path, content }));
}

function exportWebsite(root, date = new Date()) {
    const buffer = zip(websiteFiles(root), date);
    const filename = 'tcg-hosting-' + date.toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '') + '.zip';
    const directory = path.join(root, 'exports');
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Папка exports не може бути символічним посиланням.');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, filename), buffer, { flag: 'wx' });
    return { buffer, filename };
}

module.exports = { websiteFiles, exportWebsite, sourceWebsiteFiles };
