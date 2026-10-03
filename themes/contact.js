(function () {
    'use strict';
    const initialized = new WeakSet();
    function start() {
        for (const form of document.querySelectorAll('[data-contact-form]')) {
            if (initialized.has(form)) continue;
            initialized.add(form);
            const status = form.querySelector('[role="status"]'), submit = form.querySelector('[type="submit"]');
            let busy = false;
            form.addEventListener('submit', async event => {
                event.preventDefault(); if (busy || !form.reportValidity()) return;
                busy = true; submit.disabled = true; status.hidden = false; status.textContent = 'Отправка…';
                try {
                    const config = await fetch('/themes/contact-config.json', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
                    if (!config.ok) throw new Error('Отправка через сайт пока недоступна. Воспользуйтесь контактами на сайте.');
                    const { endpoint } = await config.json(), target = new URL(endpoint, location.origin);
                    if (target.origin !== location.origin && target.protocol !== 'https:') throw new Error('Некорректный адрес отправки.');
                    const prepared = await fetch(target, { cache: 'no-store', signal: AbortSignal.timeout(15000) }), preparation = await prepared.json();
                    if (!prepared.ok) throw new Error(preparation.error);
                    const data = new FormData(form), fields = {};
                    for (const [key, value] of data) if (key !== 'website') fields[key] = value;
                    const response = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TCG-Token': preparation.token },
                        body: JSON.stringify({ page: form.dataset.contactPage, website: data.get('website') || '', fields }), signal: AbortSignal.timeout(25000) });
                    const result = await response.json();
                    if (!response.ok || result.ok !== true) throw new Error(result.error || 'Не удалось подтвердить отправку.');
                    busy = false; form.reset(); status.hidden = false; status.textContent = result.message;
                } catch (error) {
                    status.textContent = ['TimeoutError', 'TypeError', 'SyntaxError'].includes(error.name) ? 'Не удалось подтвердить отправку. Данные остались в форме. Проверьте соединение или воспользуйтесь контактами на сайте.' : error.message;
                } finally { busy = false; submit.disabled = false; }
            });
            form.addEventListener('reset', event => { if (busy) event.preventDefault(); else { status.textContent = ''; status.hidden = true; } });
        }
    }
    start();
    document.addEventListener('tcg:page-load', start);
})();
