const fs = require('node:fs');
const path = require('node:path');
const { load } = require('cheerio');
const { publicEntries, isPublicContent } = require('./site-files');
const { isPage, pageProblem } = require('../admin/repository');
const routes = require('../themes/routes');

function sourcePages(root) {
    const files = [];
    function walk(dir, prefix = '') {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
            const name = prefix + entry.name;
            if (entry.isDirectory() && ['Docs', 'ListPage'].includes(name)) walk(path.join(dir, entry.name), name + '/');
            else if (entry.isFile() && isPage(name) && !pageProblem(fs.readFileSync(path.join(root, name), 'utf8'))) files.push(name);
        }
    }
    walk(root);
    const used = new Set();
    for (const file of files) {
        const url = routes.url(file).toLowerCase();
        if (!routes.available(file, files) || used.has(url)) throw new Error('Конфлікт адреси сторінки: ' + file);
        used.add(url);
    }
    return files.sort();
}
function preparePage(html, file, files) {
    const $ = load(html);
    $('link[rel="canonical"]').remove();
    $('head').append('<link rel="canonical" href="' + routes.url(file) + '">');
    $('a[href],form[action]').each((_, element) => {
        const node = $(element), attribute = element.name === 'form' ? 'action' : 'href', value = node.attr(attribute);
        if (!value || value.startsWith('#') || /^(mailto|tel|data):/i.test(value)) return;
        try {
            const url = new URL(value, 'https://site.invalid/' + file);
            if (!['site.invalid', 'www.tcg.com.ua', 'tcg.com.ua'].includes(url.hostname)) return;
            const source = routes.resolve(url.pathname, files);
            if (source) node.attr(attribute, routes.url(source) + url.search + url.hash);
        } catch { /* Preserve a user-entered value for correction in the editor. */ }
    });
    return $.html();
}
function redirectPage(url) {
    const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url=' + safe + '"><link rel="canonical" href="' + safe + '"><title>Страница переехала</title><script src="/themes/redirect.js" defer></script></head><body><p><a href="' + safe + '">Открыть страницу по новому адресу</a></p></body></html>\n';
}
function searchIndex(root, files = sourcePages(root)) {
    return files.filter(file => !['toc.html', 'search.html', 'feedback.html', 'header.html'].includes(file)).map(file => {
        const $ = load(fs.readFileSync(path.join(root, file), 'utf8'));
        const main = $('main').first().clone();
        main.find('script,style,nav,form,button,.archive-note,.document-toolbar').remove();
        main.find('p,h1,h2,h3,h4,li,td,th,summary').append(' ');
        return { url: routes.url(file), title: $('main h1').first().text().trim() || $('title').text(), text: main.text().replace(/\s+/g, ' ').trim() };
    });
}
function writePublicSite(root, output) {
    const pages = sourcePages(root), pageSet = new Set(pages);
    for (const name of publicEntries(root)) {
        if (pageSet.has(name)) continue;
        fs.cpSync(path.join(root, name), path.join(output, name), {
            recursive: true,
            filter: source => !fs.lstatSync(source).isSymbolicLink() && !path.basename(source).startsWith('.') &&
                !pageSet.has(path.relative(root, source).split(path.sep).join('/')) && isPublicContent(source),
        });
    }
    for (const file of pages) {
        const target = path.join(output, routes.entryPath(file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, preparePage(fs.readFileSync(path.join(root, file), 'utf8'), file, pages));
        for (const alias of [file, file.replace(/\.html$/, '.htm')]) {
            if (alias === 'index.html') continue;
            const destination = path.join(output, alias);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, redirectPage(routes.url(file)));
        }
    }
    fs.mkdirSync(path.join(output, 'Docs'), { recursive: true });
    fs.writeFileSync(path.join(output, 'Docs', 'Sno_for_Buh_ua.html'), redirectPage('/Docs/Sno_for_Buh_ua.ert'));
    fs.writeFileSync(path.join(output, 'search-index.json'), JSON.stringify(searchIndex(root, pages)));
    return pages;
}
module.exports = { sourcePages, preparePage, redirectPage, searchIndex, writePublicSite };
