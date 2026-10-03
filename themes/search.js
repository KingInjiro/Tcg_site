(function (factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { api.start(); document.addEventListener('tcg:page-load', api.start); }
})(function () {
    'use strict';
    const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');
    function search(index, query) {
        const terms = [...new Set(normalize(query.trim()).split(/\s+/u).filter(Boolean))].slice(0, 12);
        if (!terms.length) return [];
        return index.map(entry => {
            const title = normalize(entry.title), text = normalize(entry.text);
            if (!terms.every(term => title.includes(term) || text.includes(term))) return null;
            const first = Math.max(0, text.indexOf(terms[0]) - 70);
            return { ...entry, score: terms.reduce((score, term) => score + (title.includes(term) ? 10 : 1), 0),
                snippet: (first ? '…' : '') + entry.text.slice(first, first + 230) + (first + 230 < entry.text.length ? '…' : '') };
        }).filter(Boolean).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'));
    }
    const initialized = new WeakSet();
    function start() {
        const form = document.querySelector('[data-site-search]');
        if (!form || initialized.has(form)) return;
        initialized.add(form);
        const input = form.elements.search, status = document.getElementById('search-status'), results = document.getElementById('search-results');
        let indexPromise, generation = 0;
        async function run(updateURL) {
            const current = ++generation, query = input.value.trim().slice(0, 200);
            results.replaceChildren();
            if (updateURL) { const url = new URL(location.href); if (query) url.searchParams.set('search', query); else url.searchParams.delete('search'); history.replaceState(history.state, '', url); }
            status.hidden = false;
            if (!query) { status.textContent = 'Введите слова для поиска.'; return; }
            status.textContent = 'Поиск…';
            try {
                if (!indexPromise) indexPromise = fetch('/themes/search-index.json', { cache: 'no-cache', signal: AbortSignal.timeout(15000) })
                    .then(response => { if (!response.ok) throw new Error('index'); return response.json(); })
                    .catch(error => { indexPromise = null; throw error; });
                const index = await indexPromise;
                if (current !== generation) return;
                const matches = search(index, query);
                status.textContent = matches.length ? 'Найдено страниц: ' + matches.length + '.' : 'По вашему запросу ничего не найдено.';
                for (const result of matches) {
                    const item = document.createElement('li'), link = document.createElement('a'), description = document.createElement('p');
                    link.href = result.url; link.dataset.tcgPage = ''; link.textContent = result.title; description.textContent = result.snippet;
                    item.append(link, description); results.append(item);
                }
            } catch { if (current === generation) status.textContent = 'Не удалось загрузить поиск. Проверьте соединение и попробуйте ещё раз.'; }
        }
        form.addEventListener('submit', event => { event.preventDefault(); run(true); });
        form.addEventListener('reset', () => { ++generation; results.replaceChildren(); status.textContent = ''; status.hidden = true; const url = new URL(location.href); url.searchParams.delete('search'); history.replaceState(history.state, '', url); });
        input.value = new URLSearchParams(location.search).get('search')?.slice(0, 200) || '';
        if (input.value) run(false);
    }
    return { search, start };
});
