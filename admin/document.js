(function () {
    'use strict';
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const parse = html => new DOMParser().parseFromString(html, 'text/html');
    const attrs = node => Object.fromEntries([...node.attributes].map(attr => [attr.name, attr.value]));
    function importHTML(html, path) {
        const problem = window.TCGRepository.pageProblem(html);
        if (problem) throw new Error(problem);
        const doc = parse(html);
        const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1] || doc.head.innerHTML;
        const meta = {
            head, title: doc.title || path.replace(/\.html?$/i, ''),
            htmlAttributes: attrs(doc.documentElement), bodyAttributes: attrs(doc.body),
            doctype: html.match(/<!doctype[^>]*>/i)?.[0] || '', events: {},
        };
        let id = 0;
        const raw = {};
        const preserve = (node, source) => {
            const key = 'p' + (++id);
            raw[key] = source;
            const replacement = doc.createElement('tcg-preserved');
            replacement.setAttribute('data-key', key);
            node.replaceWith(replacement);
        };
        // Keep original scripts/embeds/comments in the published page, but never run them in the editor.
        doc.body.querySelectorAll('script,iframe,object,embed,noscript,base,meta').forEach(node => preserve(node, node.outerHTML));
        const comments = [];
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
        while (walker.nextNode()) comments.push(walker.currentNode);
        comments.forEach(node => preserve(node, '<!--' + node.data + '-->'));
        doc.body.querySelectorAll('*').forEach(node => {
            const saved = {};
            for (const attr of [...node.attributes]) {
                if (/^on/i.test(attr.name) || (['href', 'src', 'action', 'formaction'].includes(attr.name) && /^\s*javascript:/i.test(attr.value))) {
                    saved[attr.name] = attr.value;
                    node.removeAttribute(attr.name);
                }
            }
            if (Object.keys(saved).length) {
                const key = 'e' + (++id);
                meta.events[key] = saved;
                node.setAttribute('data-tcg-event-ref', key);
            }
        });
        const css = [...doc.head.querySelectorAll('style[data-tcg-editor-css]')].map(node => node.textContent).join('\n');
        return { meta, body: doc.body.innerHTML, raw, css };
    }
    function register(editor) {
        editor.DomComponents.addType('tcg-preserved', {
            isComponent: el => el.tagName === 'TCG-PRESERVED',
            model: {
                defaults: { name: 'Службовий елемент', droppable: false, draggable: false, selectable: false, hoverable: false, removable: false, copyable: false, layerable: false, raw: '' },
                toHTML() { return this.get('raw') || ''; },
            },
            view: { onRender() { this.el.style.display = 'none'; } },
        });
    }
    function titleHead(meta) {
        const title = '<title>' + escape(meta.title) + '</title>';
        return /<title\b/i.test(meta.head) ? meta.head.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/i, () => title) : meta.head + title;
    }
    function exportHTML(editor, meta) {
        let body = editor.getHtml({ cleanId: false });
        // Restore legacy event handlers only in the exported document.
        for (const [key, attributes] of Object.entries(meta.events || {})) {
            const value = Object.entries(attributes).map(([name, content]) => name + '="' + escape(content) + '"').join(' ');
            body = body.replace('data-tcg-event-ref="' + key + '"', () => value);
        }
        if (!/^\s*<body[\s>]/i.test(body)) body = '<body>' + body + '</body>';
        // Body handlers were deliberately excluded from the canvas.
        const unsafeBodyAttrs = Object.entries(meta.bodyAttributes || {}).filter(([name]) => /^on/i.test(name));
        if (unsafeBodyAttrs.length) body = body.replace(/<body\b/, match => match + ' ' + unsafeBodyAttrs.map(([name, value]) => name + '="' + escape(value) + '"').join(' '));
        const css = editor.getCss({ keepUnusedStyles: true });
        const htmlAttrs = Object.entries(meta.htmlAttributes || {}).map(([name, value]) => name + '="' + escape(value) + '"').join(' ');
        const head = titleHead(meta).replace(/<style\b[^>]*data-tcg-editor-css[^>]*>[\s\S]*?<\/style>/gi, '');
        return meta.doctype + '\n<html' + (htmlAttrs ? ' ' + htmlAttrs : '') + '><head>' + head +
            (css ? '\n<style data-tcg-editor-css>' + css.replace(/<\/style/gi, '<\\/style') + '</style>' : '') + '</head>' + body + '</html>\n';
    }
    function canvasHead(editor, meta, path) {
        const doc = editor.Canvas.getDocument();
        if (!doc) return;
        doc.head.querySelectorAll('[data-tcg-head]').forEach(node => node.remove());
        const base = doc.createElement('base');
        base.href = new URL('/' + path, location.origin).href;
        base.dataset.tcgHead = '';
        doc.head.prepend(base);
        const source = parse('<head>' + meta.head + '</head>');
        let previous = base;
        source.head.querySelectorAll('style:not([data-tcg-editor-css]),link[rel="stylesheet"]').forEach(node => {
            const copy = doc.importNode(node, true);
            copy.dataset.tcgHead = '';
            previous.after(copy);
            previous = copy;
        });
        // No scripts, submissions, top navigation, or embedded active documents in the canvas.
        const iframe = editor.Canvas.getFrameEl();
        iframe?.setAttribute('sandbox', 'allow-same-origin');
    }
    function safeModel(value) {
        if (Array.isArray(value)) return value.map(safeModel);
        if (!value || typeof value !== 'object') return value;
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (['__proto__', 'prototype', 'constructor', 'script', 'script-export'].includes(key)) continue;
            out[key] = safeModel(item);
        }
        if (out.attributes) for (const key of Object.keys(out.attributes)) if (/^on/i.test(key)) delete out.attributes[key];
        return out;
    }
    function template(title, kind, path) {
        const content = kind === 'services'
            ? '<div class="content-sections"><section><h2>Перша послуга</h2><p>Опишіть, що ви пропонуєте.</p></section><section><h2>Друга послуга</h2><p>Додайте інформацію для клієнта.</p></section></div>'
            : '<p>Двічі натисніть на цей текст, щоб написати свій. Додавайте блоки з панелі ліворуч.</p>';
        return window.TCGPage.render({ file: path, title, content, language: 'uk' });
    }
    function rebaseCopy(html, sourcePath, targetPath) {
        const doc = parse(html), base = new URL('/' + sourcePath, location.origin);
        const absolute = value => {
            if (!value || value.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return value;
            const url = new URL(value, base);
            return url.pathname + url.search + url.hash;
        };
        const css = value => value.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (_, quote, url) => 'url("' + absolute(url.trim()).replace(/"/g, '%22') + '")');
        doc.querySelectorAll('*').forEach(node => {
            for (const name of ['href', 'src', 'action', 'poster', 'background']) if (node.hasAttribute(name)) node.setAttribute(name, absolute(node.getAttribute(name)));
            if (node.hasAttribute('style')) node.setAttribute('style', css(node.getAttribute('style')));
        });
        doc.querySelectorAll('style').forEach(node => { node.textContent = css(node.textContent); });
        if (targetPath) doc.querySelector('link[rel="canonical"]')?.setAttribute('href', window.TCGRoutes.url(targetPath));
        return (html.match(/<!doctype[^>]*>/i)?.[0] || '') + doc.documentElement.outerHTML;
    }
    function slug(title) {
        const map = { а:'a',б:'b',в:'v',г:'h',ґ:'g',д:'d',е:'e',є:'ye',ж:'zh',з:'z',и:'y',і:'i',ї:'yi',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ь:'',ю:'yu',я:'ya',ы:'y',э:'e',ъ:'',ё:'yo' };
        return [...title.toLowerCase()].map(ch => map[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);
    }
    window.TCGDocument = { importHTML, register, exportHTML, canvasHead, safeModel, template, rebaseCopy, slug, escape };
})();
