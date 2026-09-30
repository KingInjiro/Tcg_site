(function (root, factory) {
    const api = factory(typeof module === 'object' && module.exports ? require('./routes') : root.TCGRoutes);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TCGPage = api;
})(typeof window === 'undefined' ? globalThis : window, function (routes) {
    'use strict';
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const utility = [
        ['index.html', 'HOME', 'Основная'], ['feedback.html', 'FEEDBACK.HTM', 'Обратная связь'],
        ['toc.html', 'TOC.HTM', 'Оглавление'], ['Download.html', 'DOWNLOAD.HTM', 'Загрузка'],
        ['search.html', 'SEARCH.HTM', 'Форма поиска'], ['ssilki.html', 'SSILKI.HTM', 'Ссылки'],
    ];
    function render({ file, title, content, css = '', sectionLinks = [], language = 'ru', headline = title }) {
        const page = routes.info(file), current = routes.url(file);
        title ||= page.label;
        headline ||= title;
        const parent = routes.primary.find(name => routes.info(name).section === page.section);
        const mainNav = routes.primary.map(name => {
            const item = routes.info(name), active = name === file;
            return '<li><a href="' + item.url + '"' + (active ? ' aria-current="page"' : '') + (item.section === page.section ? ' class="section-active"' : '') + '>' + escape(item.label) + '</a></li>';
        }).join('');
        const children = sectionLinks.filter(link => link.href !== '/' && !routes.primary.some(name => routes.url(name) === link.href));
        const subnav = children.length ? '<nav class="section-navigation" aria-label="В этом разделе"><p>В этом разделе</p><ul>' + children.map(link => '<li><a href="' + escape(link.href) + '"' + (link.href === current ? ' aria-current="page"' : '') + '>' + escape(link.label) + '</a></li>').join('') + '</ul></nav>' : '';
        return '<!doctype html>\n<html lang="' + language + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="format-detection" content="telephone=no">' +
            '<title>' + escape(title) + ' — Т-груп</title><link rel="canonical" href="' + current + '">' +
            '<link rel="stylesheet" href="/themes/site.css"><script src="/themes/site.js" defer></script>' +
            ((file === 'index.html' || file === 'ListPage/Pege05.html') ? '<script src="/themes/calculators.js" defer></script>' : '') +
            (css ? '<style data-tcg-editor-css>' + css + '</style>' : '') + '</head>\n<body class="site-page' + (current === '/' ? ' page-home' : '') + '">\n' +
            '<a class="skip-link" href="#main-content">Перейти к содержимому</a>' +
            '<header class="site-header"><div class="header-inner"><a class="site-logo" href="/" aria-label="Т-груп — главная"><img src="/images/tcg_log3.gif" alt="TCG — Tornado Computers Group" width="125" height="125"></a>' +
            '<div class="header-contacts"><span class="contact-phone" data-phone="+380444004600">+38 (044) 400-46-00</span><span class="contact-phone" data-phone="+380504486958">+38 (050) 448-69-58</span><a href="/contacts/">Контактная информация</a></div></div></header>' +
            '<nav class="utility-navigation" aria-label="Быстрые переходы"><div class="utility-links">' + utility.map(([name, image, label]) => '<a href="' + routes.url(name) + '" title="' + label + '"><img src="/derived/' + image + '_CMP_-1-010_GBTN.GIF" alt="' + label + '" width="90" height="25"></a>').join('') + '</div></nav>\n' +
            '<div class="site-shell"><aside class="site-sidebar"><p class="sidebar-caption">Разделы сайта</p><button class="menu-toggle" type="button" aria-controls="site-navigation" aria-expanded="true">Разделы сайта <span aria-hidden="true">☰</span></button>' +
            '<nav id="site-navigation" aria-label="Основная навигация"><ul class="main-navigation">' + mainNav + '</ul>' + subnav + '</nav></aside>' +
            '<main class="site-content" id="main-content" tabindex="-1"><header class="page-heading">' +
            (current === '/' ? '' : '<nav class="breadcrumbs" aria-label="Путь к странице"><a href="/">Главная</a>' + (parent && parent !== file ? '<span aria-hidden="true">/</span><a href="' + routes.url(parent) + '">' + escape(routes.info(parent).label) + '</a>' : '') + '<span aria-hidden="true">/</span><span aria-current="page">' + escape(title) + '</span></nav>') +
            '<h1>' + escape(headline) + '</h1></header><div class="page-body">\n' + content + '</div></main></div>\n' +
            '<footer class="site-footer"><p>© 2026 Общество с ограниченной ответственностью «Т-груп»</p><nav aria-label="Ссылки внизу страницы"><a href="/contacts/">Контакты</a><a href="/feedback/">Обратная связь</a><a href="/sitemap/">Карта сайта</a></nav></footer>\n</body></html>\n';
    }
    return { render, escape };
});
