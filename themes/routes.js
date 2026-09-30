(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TCGRoutes = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    // Source filenames stay stable for the editor and repository history.
    // Public URLs are directories, so they also work on ordinary static hosting.
    const pages = {
        'index.html': ['/', 'Главная', ''],
        'news.html': ['/news/', 'Новости', 'news'],
        'News0.html': ['/news/site-launch/', 'Запущен сайт', 'news'],
        'News1.html': ['/news/1c-77/', 'Изменения для 1С:Предприятие 7.7', 'news'],
        'contacts.html': ['/contacts/', 'Контакты', 'contacts'],
        'products.html': ['/products/', 'Продукты', 'products'],
        'prod01.html': ['/products/software/', 'Программное обеспечение', 'products'],
        '1CPrice.html': ['/products/1c/prices/', 'Прайс-лист 1С', 'products'],
        'priceMS.html': ['/products/microsoft/', 'Microsoft', 'products'],
        'prod01My.html': ['/products/tcg/', 'Наши разработки', 'products'],
        'prodMy01.html': ['/products/tcg/advertising-tax/', 'Учет налога на рекламу', 'products'],
        'prodMy02.html': ['/products/tcg/medicines/', 'Учет медикаментов', 'products'],
        'prodMy03.html': ['/products/tcg/universal/', 'Универсальная', 'products'],
        'services.html': ['/services/', 'Услуги', 'services'],
        'serv01.html': ['/services/computers/', 'Обслуживание компьютеров', 'services'],
        'PCTarf.html': ['/services/computers/plans/', 'Тарифные планы', 'services'],
        'TEconom.html': ['/services/computers/plans/economy/', 'Экономичный', 'services'],
        'TStand.html': ['/services/computers/plans/standard/', 'Стандартный', 'services'],
        'TVip.html': ['/services/computers/plans/vip/', 'VIP', 'services'],
        'price01.html': ['/services/computers/prices/', 'Цены на обслуживание ПК', 'services'],
        'Net.html': ['/services/networks/', 'Обслуживание сетей', 'services'],
        'reglament.html': ['/services/visits/', 'Регламент выездов', 'services'],
        'complex.html': ['/services/office/', 'Офис под ключ', 'services'],
        'serv02.html': ['/services/1c/', '1С:Предприятие', 'services'],
        '1Cabon.html': ['/services/1c/subscription/', 'Абонентское обслуживание', 'services'],
        '1Complex.html': ['/services/1c/automation/', 'Автоматизация', 'services'],
        '1Config.html': ['/services/1c/setup/', 'Настройка 1С', 'services'],
        '1Cobslug.html': ['/services/1c/support/', 'Сопровождение 1С', 'services'],
        '1Citc.html': ['/services/1c/its/', 'ИТС', 'services'],
        '1CDisitc.html': ['/services/1c/its/discs/', 'Диски ИТС', 'services'],
        'price1C.html': ['/services/1c/prices/', 'Цены на услуги 1С', 'services'],
        'serv04.html': ['/services/other/', 'Прочие услуги', 'services'],
        '1Ccrypt.html': ['/services/security/', 'Защита информации', 'services'],
        'serv0401.html': ['/services/hardware/', 'Оптимизация аппаратной части', 'services'],
        'serv0402.html': ['/services/audit/', 'Аудит бизнес-процессов', 'services'],
        'ListPage_www_tcg_com_ua.html': ['/articles/', 'Статьи', 'articles'],
        'ListPage/Pege01.html': ['/articles/video-surveillance/', 'Система видеонаблюдения', 'articles'],
        'ListPage/Pege02.html': ['/articles/windows-account-policies/', 'Политики учетных записей Windows', 'articles'],
        'ListPage/Pege03.html': ['/articles/windows-group-policies/', 'Групповые политики Windows', 'articles'],
        'ListPage/Pege04.html': ['/articles/isa-server/', 'Установка ISA Server', 'articles'],
        'ListPage/Pege05.html': ['/articles/backup/', 'Резервное копирование данных', 'articles'],
        'ListPage/Pege06.html': ['/articles/it-outsourcing/', 'Аутсорсинг в IT-сфере', 'articles'],
        'AntiRoot.html': ['/articles/antivirus-rules/', 'Правила защиты от вирусов', 'articles'],
        'AntiTipi.html': ['/articles/virus-types/', 'Типы вирусов', 'articles'],
        'For_as.html': ['/articles/about-us/', 'Статьи о нас', 'articles'],
        'Download.html': ['/downloads/', 'Загрузки и документы', 'downloads'],
        'feedback.html': ['/feedback/', 'Обратная связь', 'contacts'],
        'search.html': ['/search/', 'Поиск по сайту', ''],
        'toc.html': ['/sitemap/', 'Карта сайта', ''],
        'ssilki.html': ['/links/', 'Ссылки', ''],
        'header.html': ['/about/', 'О сайте', ''],
        'Docs/contract-1c.html': ['/documents/1c-support/', 'Договор сопровождения 1С', 'downloads'],
        'Docs/contract-computers.html': ['/documents/computer-support/', 'Договір обслуговування комп’ютерів', 'downloads'],
        'Docs/contract-consulting.html': ['/documents/consulting/', 'Договор консультационных услуг', 'downloads'],
        'Docs/manual-universal.html': ['/documents/universal/', 'Руководство «Универсальная»', 'downloads'],
        'Docs/manual-advertising-tax.html': ['/documents/advertising-tax/', 'Руководство «Налог на рекламу»', 'downloads'],
    };
    const primary = ['news.html', 'contacts.html', 'products.html', 'services.html', 'ListPage_www_tcg_com_ua.html', 'Download.html'];
    const reserved = new Set(['admin', 'api', 'images', 'derived', 'themes', 'docs', 'listpage', 'documents', 'dist', 'exports', 'node_modules']);
    function info(file) {
        const known = pages[file] || Object.entries(pages).find(([name]) => name.toLowerCase() === file.toLowerCase())?.[1];
        if (known) return { url: known[0], label: known[1], section: known[2] };
        const slug = file.replace(/\.html?$/i, '').toLowerCase();
        return { url: '/' + slug + '/', label: slug.split('/').pop(), section: '' };
    }
    function url(file) { return info(file).url; }
    function entryPath(file) { return url(file) === '/' ? 'index.html' : url(file).slice(1) + 'index.html'; }
    function resolve(pathname, files) {
        let value;
        try { value = decodeURIComponent(pathname); } catch { return null; }
        const key = value.toLowerCase();
        return files.find(file => {
            const publicPath = url(file).toLowerCase();
            return key === publicPath || (publicPath !== '/' && key + '/' === publicPath) ||
                key === publicPath + 'index.html' || key === '/' + file.toLowerCase() ||
                key === '/' + file.toLowerCase().replace(/\.html$/, '.htm') ||
                key === '/' + file.toLowerCase().replace(/\.html?$/, '');
        }) || null;
    }
    function available(file, files) {
        return !reserved.has(file.replace(/\.html?$/i, '').toLowerCase()) &&
            !files.some(existing => existing !== file && url(existing).toLowerCase() === url(file).toLowerCase());
    }
    return { pages, primary, info, url, entryPath, resolve, available };
});
