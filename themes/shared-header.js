(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('parse5'));
    else root.TCGHeader = factory(null);
})(typeof window === 'undefined' ? globalThis : window, function (parse5) {
    'use strict';
    // One transform for the static build, portable export and visual editor.
    const parse = html => parse5 ? parse5.parse(html) : new DOMParser().parseFromString(html, 'text/html');
    const children = node => Array.from(node.childNodes || []);
    const tag = node => (node.tagName || '').toLowerCase();
    const attr = (node, name) => parse5 ? node.attrs?.find(a => a.name === name)?.value || '' : node.getAttribute?.(name) || '';
    const hasClass = (node, name) => attr(node, 'class').split(/\s+/).includes(name);
    function set(node, name, value) {
        if (!parse5) return node.setAttribute(name, value);
        node.attrs = (node.attrs || []).filter(a => a.name !== name).concat({ name, value });
    }
    function find(node, predicate) {
        if (predicate(node)) return node;
        for (const child of children(node)) { const found = find(child, predicate); if (found) return found; }
        return null;
    }
    function remove(node) {
        if (!node?.parentNode) return;
        if (!parse5) return node.remove();
        node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
        node.parentNode = null;
    }
    function insert(parent, node, before = null) {
        remove(node);
        if (!parse5) return parent.insertBefore(node, before);
        parent.childNodes.splice(before ? parent.childNodes.indexOf(before) : parent.childNodes.length, 0, node);
        node.parentNode = parent;
    }
    const outer = node => parse5 ? parse5.serialize({ childNodes: [node] }) : node.outerHTML;
    const textContent = node => children(node).map(child => child.value ?? child.textContent ?? '').join('');
    // Include the header itself, but stop before every sibling subtree.
    const scopedCSS = css => '@scope (:has(> .site-header)) to (:scope > :not(.site-header)) {\n' + css + '\n}';
    function fragment(html, doc) {
        if (parse5) return parse5.parseFragment(html).childNodes;
        const template = doc.createElement('template'); template.innerHTML = html;
        return Array.from(template.content.childNodes);
    }
    const shared = node => tag(node) === 'header' && hasClass(node, 'site-header');
    const logoTable = doc => find(doc, node => tag(node) === 'table' && attr(node, 'id') === 'table2');
    function globalRow(logo) {
        const siblings = children(logo?.parentNode || {}).filter(node => tag(node));
        const next = siblings[siblings.indexOf(logo) + 1];
        return next && ['p', 'nav'].includes(tag(next)) && find(next, node => tag(node) === 'img' &&
            (/_GBTN\.GIF$/i.test(attr(node, 'src')) || hasClass(node, 'top-nav-icon'))) ? next : null;
    }
    function getHeader(homeHTML) {
        if (!homeHTML) return '';
        const doc = parse(homeHTML), existing = find(doc, shared);
        const editorStyle = find(doc, node => tag(node) === 'style' && (parse5 ? node.attrs.some(a => a.name === 'data-tcg-editor-css') : node.hasAttribute('data-tcg-editor-css')));
        const headerStyle = find(doc, node => tag(node) === 'style' && attr(node, 'id') === 'tcg-header-style');
        const css = editorStyle ? scopedCSS(textContent(editorStyle)) : headerStyle ? textContent(headerStyle) : '';
        if (existing) return { html: outer(existing), css };
        const logo = logoTable(doc), navigation = logo && globalRow(logo);
        if (!logo || !navigation) return '';
        const links = children(navigation).map(node => node.nodeType === 3 || node.nodeName === '#text' ? ' ' : outer(node)).join('');
        return { html: '<header class="site-header">' + outer(logo) +
            '<nav class="legacy-top-navigation" aria-label="Основная навигация">' + links + '</nav></header>', css };
    }
    function applyHeader(html, header) {
        if (!header) return html;
        const doc = parse(html), body = find(doc, node => tag(node) === 'body'), head = find(doc, node => tag(node) === 'head');
        const existing = find(body, shared);
        if (existing) remove(existing);
        else {
            const logo = logoTable(body), navigation = logo && globalRow(logo);
            if (navigation) {
                const up = find(navigation, node => tag(node) === 'a' && find(node, image => tag(image) === 'img' && attr(image, 'alt') === 'Вверх'));
                if (up) {
                    const section = find(logo.parentNode, node => node !== navigation && ['p', 'nav'].includes(tag(node)) &&
                        find(node, image => tag(image) === 'img' && /_HBTN\.GIF$/i.test(attr(image, 'src'))));
                    if (section) insert(section, up, section.firstChild || children(section)[0]);
                    else {
                        for (const child of children(navigation)) if (child !== up) remove(child);
                    }
                }
                if (!up || up.parentNode !== navigation) remove(navigation);
            }
            if (logo) {
                let parent = logo.parentNode;
                remove(logo);
                // Word price lists had an otherwise empty nested header table.
                while (parent && parent !== body && !children(parent).some(node => tag(node) || (node.value || node.textContent || '').trim())) {
                    const next = parent.parentNode; remove(parent); parent = next;
                }
            }
        }
        const first = children(body).find(node => tag(node) && !hasClass(node, 'skip-link')) || null;
        for (const node of fragment(header.html, doc)) insert(body, node, first);
        if (!hasClass(body, 'site-page')) set(body, 'class', (attr(body, 'class') + ' site-page').trim());
        for (const href of ['/themes/html5.css', '/themes/banner.css', '/themes/layout.css', '/themes/navigation.css']) {
            if (!find(head, node => tag(node) === 'link' && attr(node, 'href') === href)) {
                for (const node of fragment('<link rel="stylesheet" href="' + href + '">', doc)) insert(head, node);
            }
        }
        const previousStyle = find(head, node => tag(node) === 'style' && attr(node, 'id') === 'tcg-header-style');
        if (previousStyle) remove(previousStyle);
        if (header.css) {
            // Scope editor-generated selectors to the shared header, so homepage
            // styling cannot leak into another page's article or price table.
            for (const node of fragment('<style id="tcg-header-style">' + header.css.replace(/<\/style/gi, '<\\/style') + '</style>', doc)) insert(head, node);
        }
        return '<!DOCTYPE html>\n' + (parse5 ? parse5.serialize(doc).replace(/<!DOCTYPE[^>]*>/i, '') : doc.documentElement.outerHTML);
    }
    return { getHeader, applyHeader };
});
