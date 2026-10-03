const parse5 = require('parse5');
const { pageURL } = require('../themes/routes');
const attribute = (node, name) => node.attrs?.find(attr => attr.name === name)?.value || '';
function walk(node, visit) { visit(node); for (const child of node.childNodes || []) walk(child, visit); }
function textContent(node) {
    if (['script', 'style', 'noscript', 'form', 'nav'].includes(node.tagName) || /legacy-top-navigation/.test(attribute(node, 'class'))) return '';
    if (node.nodeName === '#text') return node.value;
    const text = (node.childNodes || []).map(textContent).join('');
    return ['p', 'div', 'td', 'th', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br'].includes(node.tagName) ? text + ' ' : text;
}
function buildSearchIndex(files) {
    const result = [];
    for (const [file, html] of files) {
        if (['search.html', 'header.html', 'toc.html'].includes(file)) continue;
        const doc = parse5.parse(String(html));
        let title = '', body, content;
        walk(doc, node => {
            if (node.tagName === 'title') title = textContent(node);
            if (node.tagName === 'body') body = node;
            if (!content && /(?:^|\s)(?:site-content|WordSection1)(?:\s|$)/.test(attribute(node, 'class'))) content = node;
        });
        result.push({ url: pageURL(file), title: title.replace(/\s+/gu, ' ').trim(), text: textContent(content || body || doc).replace(/\s+/gu, ' ').trim() });
    }
    return result;
}
module.exports = { buildSearchIndex };
