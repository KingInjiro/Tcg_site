(function () {
    'use strict';
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical && /\.(?:html?|HTM)$/i.test(location.pathname)) {
        const target = new URL(canonical.getAttribute('href'), location.origin);
        if (target.origin === location.origin && target.pathname !== location.pathname) {
            location.replace(target.pathname + location.search + location.hash);
            return;
        }
    }
    // Retire the old offline page cache so a published update is never hidden by it.
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(registrations => {
        for (const registration of registrations) {
            const worker = registration.active || registration.waiting || registration.installing;
            if (worker && new URL(worker.scriptURL).pathname === '/sw.js') registration.unregister();
        }
    }).catch(() => {});
    const toggle = document.querySelector('.menu-toggle'), navigation = document.getElementById('site-navigation');
    if (toggle && navigation) {
        const media = matchMedia('(max-width: 760px)');
        function setOpen(open) { toggle.setAttribute('aria-expanded', String(open)); navigation.hidden = !open; }
        const adapt = () => setOpen(!media.matches);
        adapt(); media.addEventListener('change', adapt);
        toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    }
    // There is no web API for detecting a dialler. Keep readable text by default;
    // enable the explicit confirmation flow only when the browser identifies as a phone.
    const isPhone = navigator.userAgentData?.mobile === true || /Android.*Mobile|iPhone|iPod|Windows Phone/i.test(navigator.userAgent);
    if (isPhone && typeof HTMLDialogElement !== 'undefined' && HTMLDialogElement.prototype.showModal) {
        let phoneDialog, phoneOpener;
        function openPhone(number, label, opener) {
            if (!phoneDialog) {
                phoneDialog = document.createElement('dialog');
                phoneDialog.className = 'phone-dialog';
                phoneDialog.setAttribute('aria-labelledby', 'phone-dialog-title');
                phoneDialog.setAttribute('aria-describedby', 'phone-dialog-number');
                phoneDialog.innerHTML = '<h2 id="phone-dialog-title">Открыть набор номера?</h2><p id="phone-dialog-number"></p><div class="phone-dialog-actions"><button type="button" class="phone-cancel" autofocus>Отмена</button><a class="site-button phone-confirm">Открыть телефон</a></div>';
                document.body.append(phoneDialog);
                phoneDialog.querySelector('.phone-cancel').addEventListener('click', () => phoneDialog.close());
                phoneDialog.querySelector('.phone-confirm').addEventListener('click', event => {
                    event.preventDefault();
                    const destination = event.currentTarget.getAttribute('href');
                    if (!phoneDialog.open || !/^tel:\+\d{8,15}$/.test(destination || '')) return;
                    phoneDialog.close();
                    // Handoff only after the second, explicit user action. The OS chooses its tel handler.
                    window.open(destination, '_self');
                });
                phoneDialog.addEventListener('close', () => {
                    phoneDialog.querySelector('.phone-confirm').removeAttribute('href');
                    phoneOpener?.focus();
                });
            }
            phoneOpener = opener;
            phoneDialog.querySelector('#phone-dialog-number').textContent = label;
            phoneDialog.querySelector('.phone-confirm').setAttribute('href', 'tel:' + number);
            phoneDialog.showModal();
        }
        document.querySelectorAll('.contact-phone[data-phone]').forEach(text => {
            const number = text.dataset.phone;
            if (!/^\+\d{8,15}$/.test(number)) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = text.className;
            button.textContent = text.textContent;
            button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-label', 'Открыть набор номера ' + text.textContent.trim());
            button.addEventListener('click', () => openPhone(number, button.textContent.trim(), button));
            text.replaceWith(button);
        });
    }
    function revealAnchor() {
        if (!location.hash) return;
        let id; try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
        const target = document.getElementById(id);
        for (let node = target; node; node = node.parentElement) if (node.tagName === 'DETAILS') node.open = true;
        target?.scrollIntoView({ block: 'start' });
    }
    revealAnchor(); addEventListener('hashchange', revealAnchor);
    document.querySelectorAll('[data-print]').forEach(button => button.addEventListener('click', () => {
        const closed = [...document.querySelectorAll('.manual-chapter:not([open])')];
        closed.forEach(chapter => { chapter.open = true; });
        addEventListener('afterprint', () => closed.forEach(chapter => { chapter.open = false; }), { once: true });
        print();
    }));
    const compose = document.getElementById('contact-compose');
    if (compose) {
        const status = document.getElementById('contact-status');
        const letter = () => 'Имя: ' + compose.elements.name.value.trim() + '\nE-mail: ' + compose.elements.email.value.trim() + '\n\n' + compose.elements.message.value.trim();
        compose.addEventListener('submit', event => {
            event.preventDefault();
            if (!compose.reportValidity()) return;
            const mail = 'mailto:tcg@tcg.com.ua?subject=' + encodeURIComponent(compose.elements.subject.value.trim()) + '&body=' + encodeURIComponent(letter());
            window.open(mail, '_self');
            status.textContent = 'Письмо подготовлено. Подтвердите отправку в почтовой программе. Если она не открылась, скопируйте текст письма.';
        });
        document.getElementById('copy-message').addEventListener('click', async () => {
            if (!compose.reportValidity()) return;
            const text = 'Кому: tcg@tcg.com.ua\nТема: ' + compose.elements.subject.value.trim() + '\n\n' + letter();
            try { await navigator.clipboard.writeText(text); status.textContent = 'Текст скопирован. Вставьте его в письмо на tcg@tcg.com.ua и отправьте.'; }
            catch {
                let field = document.getElementById('copy-fallback');
                if (!field) { field = document.createElement('textarea'); field.id = 'copy-fallback'; field.readOnly = true; field.setAttribute('aria-label', 'Текст для копирования'); compose.append(field); }
                field.value = text; field.focus(); field.select();
                status.textContent = 'Выделенный текст можно скопировать сочетанием Ctrl+C или через меню браузера.';
            }
        });
    }
    const search = document.querySelector('.search-form');
    if (!search) return;
    const field = search.elements.q, status = document.getElementById('search-status'), results = document.getElementById('search-results');
    let indexPromise, request = 0;
    const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g, 'е');
    function highlight(element, text, terms) {
        const normalized = normalize(text); let cursor = 0;
        while (cursor < text.length) {
            const matches = terms.map(term => ({ at: normalized.indexOf(term, cursor), length: term.length })).filter(match => match.at >= 0).sort((a, b) => a.at - b.at || b.length - a.length);
            if (!matches.length) { element.append(document.createTextNode(text.slice(cursor))); break; }
            const match = matches[0]; element.append(document.createTextNode(text.slice(cursor, match.at)));
            const mark = document.createElement('mark'); mark.textContent = text.slice(match.at, match.at + match.length); element.append(mark); cursor = match.at + match.length;
        }
    }
    async function run(query) {
        const generation = ++request;
        query = query.trim().slice(0, 120); field.value = query; results.replaceChildren();
        if (query.length < 2) { status.textContent = query ? 'Введите не меньше двух символов.' : 'Введите слово или фразу для поиска по страницам сайта.'; return; }
        status.textContent = 'Поиск…';
        try {
            if (!indexPromise) indexPromise = fetch('/search-index.json', { cache: 'no-cache', signal: AbortSignal.timeout(10000) }).then(response => { if (!response.ok) throw new Error('search'); return response.json(); }).catch(error => { indexPromise = null; throw error; });
            const index = await indexPromise;
            if (generation !== request) return;
            const terms = [...new Set(normalize(query).split(/\s+/))];
            const found = index.filter(item => typeof item.url === 'string' && /^\/(?!\/)/.test(item.url) && typeof item.title === 'string' && typeof item.text === 'string')
                .map(item => ({ ...item, body: normalize(item.title + ' ' + item.text) }))
                .filter(item => terms.every(term => item.body.includes(term)))
                .map(item => ({ ...item, score: terms.reduce((score, term) => score + (normalize(item.title).includes(term) ? 10 : 1), 0) }))
                .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru'));
            for (const item of found.slice(0, 40)) {
                const li = document.createElement('li'), title = document.createElement('h2'), link = document.createElement('a'), snippet = document.createElement('p');
                link.href = item.url; highlight(link, item.title, terms); title.append(link);
                const first = Math.max(0, normalize(item.text).indexOf(terms[0]) - 70), text = (first ? '…' : '') + item.text.slice(first, first + 230) + (item.text.length > first + 230 ? '…' : '');
                highlight(snippet, text, terms); li.append(title, snippet); results.append(li);
            }
            status.textContent = found.length ? 'Найдено страниц: ' + found.length + (found.length > 40 ? '. Показаны первые 40; уточните запрос.' : '.') : 'Ничего не найдено. Попробуйте другие слова или откройте карту сайта.';
        } catch { if (generation === request) status.textContent = 'Не удалось загрузить поиск. Повторите попытку или откройте карту сайта.'; }
    }
    search.addEventListener('submit', event => { event.preventDefault(); const query = field.value.trim(); history.pushState(null, '', '/search/' + (query ? '?q=' + encodeURIComponent(query) : '')); run(query); });
    addEventListener('popstate', () => run(new URLSearchParams(location.search).get('q') || ''));
    run(new URLSearchParams(location.search).get('q') || '');
})();
