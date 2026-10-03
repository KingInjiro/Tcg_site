(() => {
    'use strict';
    const initialized = new WeakSet();
    function updateNews() {
        const list = document.getElementById('news-list');
        if (!list || initialized.has(list)) return;
        initialized.add(list);
        const failed = text => { const item = document.createElement('li'); item.textContent = text; list.replaceChildren(item); };
        fetch('https://api.rss2json.com/v1/api.json?rss_url=https://news.finance.ua/rss', { signal: AbortSignal.timeout(15000) })
            .then(response => { if (!response.ok) throw new Error('news'); return response.json(); })
            .then(data => {
                if (data.status !== 'ok' || !Array.isArray(data.items)) { failed('Не удалось загрузить новости'); return; }
                list.replaceChildren();
                for (const item of data.items.slice(0, 10)) {
                    const url = new URL(item.link);
                    if (!['https:', 'http:'].includes(url.protocol)) continue;
                    const li = document.createElement('li'), link = document.createElement('a');
                    li.style.marginBottom = '8px';
                    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    link.style.cssText = 'color: #336699; text-decoration: none;';
                    link.textContent = item.title; li.append(link); list.append(li);
                }
            }).catch(() => failed('Ошибка сети'));
    }
    updateNews();
    document.addEventListener('tcg:page-load', updateNews);
})();
