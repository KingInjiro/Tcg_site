const fs = require('node:fs');
const path = require('node:path');
const parse5 = require('parse5');
const { isPage } = require('../admin/repository');
const { publicEntries, isPublicContent } = require('./site-files');
const { pageURL, outputFile } = require('../themes/routes');
const { buildSearchIndex } = require('./search-index');
const { addPWA } = require('./pwa');

// Leave size hints unset so the last supported format (GIF) is preferred.
// Browsers that cannot animate it may display its first frame instead.
const faviconLinks = '<link rel="icon" href="/favicon.ico">' +
    '<link rel="icon" type="image/png" href="/images/favicon-32.png">' +
    '<link rel="icon" type="image/gif" href="/images/tcg_log3.gif">';

function pageFiles(root) {
    const pages = [];
    function walk(name) {
        const full = path.join(root, name), stat = fs.lstatSync(full);
        if (stat.isSymbolicLink() || path.basename(name).startsWith('.')) return;
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(full)) walk(name + '/' + child);
        } else if (isPage(name) && isPublicContent(full)) pages.push(name);
    }
    for (const name of publicEntries(root)) if (name !== 'admin') walk(name);
    return pages;
}

function routeMap(pages) {
    const routes = new Map();
    for (const file of pages) {
        const url = pageURL(file);
        for (const alias of ['/' + file, '/' + file.replace(/\.html?$/i, '.htm'), url, url === '/' ? '/' : url.slice(0, -1), '/' + outputFile(file)]) {
            routes.set(alias.toLowerCase(), { file, url });
        }
    }
    return routes;
}

// Use the parsed HTML tree, so script bodies, text, and document downloads are
// never mistaken for page links. Root-relative resources also work in the editor.
function publishHTML(html, file, pages) {
    const routes = routeMap(pages), base = new URL('/' + file, 'https://tcg.invalid');
    const absolute = (value, pageLink = false) => {
        if (!value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return value;
        const url = new URL(value, base);
        let pathname;
        try { pathname = decodeURIComponent(url.pathname); } catch { return value; }
        const target = pageLink && routes.get(pathname.toLowerCase());
        return (target ? target.url : url.pathname) + url.search + url.hash;
    };
    const css = value => value.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (_, quote, url) => 'url("' + absolute(url.trim()).replace(/"/g, '%22') + '")');
    const doc = parse5.parse(html);
    let head;
    function walk(node) {
        if (node.tagName === 'head') head = node;
        for (const attr of node.attrs || []) {
            if (['href', 'src', 'action', 'poster', 'background'].includes(attr.name)) attr.value = absolute(attr.value, ['a', 'area', 'form'].includes(node.tagName));
            if (attr.name === 'style') attr.value = css(attr.value);
            if (attr.name === 'srcset' && !/data:/i.test(attr.value)) attr.value = attr.value.replace(/(^|,\s*)([^\s,]+)(?=\s|$)/g, (_, sep, url) => sep + absolute(url));
        }
        if (node.tagName === 'style') for (const child of node.childNodes || []) if (child.nodeName === '#text') child.value = css(child.value);
        if (['a', 'area'].includes(node.tagName)) {
            node.attrs = node.attrs.filter(attr => attr.name !== 'data-tcg-page');
            const href = node.attrs.find(attr => attr.name === 'href')?.value;
            if (href && routes.has(new URL(href, base).pathname.toLowerCase())) {
                node.attrs.push({ name: 'data-tcg-page', value: '' });
            }
        }
        for (const child of node.childNodes || []) walk(child);
    }
    walk(doc);
    head.childNodes = head.childNodes.filter(node =>
        !(node.tagName === 'link' && node.attrs.some(a => a.name === 'rel' && a.value.toLowerCase().split(/\s+/).some(rel => ['canonical', 'manifest', 'icon'].includes(rel)))) &&
        !(node.tagName === 'meta' && node.attrs.some(a => a.name === 'name' && ['tcg-page', 'theme-color'].includes(a.value))) &&
        !(node.tagName === 'script' && node.attrs.some(a => a.name === 'src' && ['/themes/clean-urls.js', '/themes/service-worker.js', '/themes/navigation.js'].includes(a.value))));
    head.childNodes.push(...parse5.parseFragment('<link rel="canonical" data-tcg-canonical href="' + pageURL(file) + '">' +
        '<meta name="tcg-page" content="1"><link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#000000">' + faviconLinks +
        '<script src="/themes/clean-urls.js" defer></script><script src="/themes/service-worker.js" defer></script><script src="/themes/navigation.js" defer></script>').childNodes);
    return '<!DOCTYPE html>\n' + parse5.serialize(doc).replace(/<!DOCTYPE[^>]*>/i, '');
}

function redirectHTML(url) {
    const attr = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const scriptURL = JSON.stringify(url).replace(/</g, '\\u003c');
    return '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>TCG</title>' + faviconLinks +
        '<script>location.replace(' + scriptURL + '+location.search+location.hash)</script><meta http-equiv="refresh" content="0;url=' + attr + '"></head><body><a href="' + attr + '">Перейти на сторінку</a></body></html>';
}

function cleanWebsite(files) {
    const result = new Map(files), pages = [...files.keys()].filter(isPage);
    for (const file of pages) {
        const target = outputFile(file);
        if (target !== file && files.has(target)) throw new Error('Конфлікт адреси сторінки: ' + target);
        result.set(target, Buffer.from(publishHTML(files.get(file).toString('utf8'), file, pages)));
        if (target !== file) result.set(file, Buffer.from(redirectHTML(pageURL(file))));
        const alias = file.replace(/\.html?$/i, '.htm');
        if (alias !== target) result.set(alias, Buffer.from(redirectHTML(pageURL(file))));
    }
    result.set('themes/search-index.json', Buffer.from(JSON.stringify(buildSearchIndex(new Map(pages.map(file => [file, files.get(file)]))))));
    const endpoint = process.env.CONTACT_FORM_ENDPOINT || '/api/contact';
    if (endpoint !== '/api/contact') {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('CONTACT_FORM_ENDPOINT must be an HTTPS endpoint without credentials or a fragment.');
    }
    result.set('themes/contact-config.json', Buffer.from(JSON.stringify({ endpoint })));
    return addPWA(result, pages.map(file => [pageURL(file), outputFile(file)]), Object.fromEntries([...routeMap(pages)].map(([alias, target]) => [alias, target.url])));
}

module.exports = { pageFiles, routeMap, pageURL, outputFile, publishHTML, redirectHTML, cleanWebsite };
