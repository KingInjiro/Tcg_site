(function () {
    'use strict';
    window.TCGPHP.mount = function (repo, info, status) {
        if (document.getElementById('php-menu-button')) return;
        const button = (text, id, action) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'secondary'; b.textContent = text; b.addEventListener('click', () => {
            if (info().dirty) { status('Спочатку збережіть поточні правки.', true); return; }
            Promise.resolve(action()).catch(error => status(error.message, true));
        }); return b; };
        const reload = message => { try { sessionStorage.setItem('tcg-php-notice', message); } catch {} location.reload(); };
        try { const message = sessionStorage.getItem('tcg-php-notice'); if (message) { sessionStorage.removeItem('tcg-php-notice'); status(message); } } catch {}
        const dialog = title => {
            const d = document.createElement('dialog'); d.style.width = '720px';
            const h = document.createElement('h2'); h.textContent = title;
            const body = document.createElement('div'), error = document.createElement('p'); error.className = 'error'; error.setAttribute('role', 'alert');
            const close = document.createElement('button'); close.textContent = 'Закрити'; close.className = 'secondary'; close.addEventListener('click', () => d.close());
            d.append(h, body, error, close); d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
            return { element: d, body, error };
        };
        const topbar = document.querySelector('.topbar');
        topbar.insertBefore(button('Меню', 'php-menu-button', async () => {
            const items = (await repo.request('menu')).items, d = dialog('Спільне верхнє меню');
            const hint = document.createElement('p'); hint.textContent = 'Зміни застосуються до всіх сторінок після публікації. Незмінені GIF-кнопки зберігаються; нова назва відображатиметься текстом.'; d.body.append(hint);
            const rows = document.createElement('div'); d.body.append(rows);
            const render = () => {
                rows.replaceChildren();
                items.forEach((item, index) => {
                    const row = document.createElement('div'); row.style.cssText = 'display:grid;grid-template-columns:1fr 1fr auto auto auto;gap:6px;margin:12px 0';
                    const label = document.createElement('input'); label.value = item.label; label.setAttribute('aria-label', 'Назва пункту'); label.addEventListener('input', () => { item.label = label.value; });
                    const target = document.createElement('select'); target.setAttribute('aria-label', 'Сторінка пункту');
                    for (const path of repo.pages) target.add(new Option(window.TCGRoutes.pageURL(path), path)); target.value = item.page || ''; target.addEventListener('change', () => { item.page = target.value; });
                    const controls = [['↑', () => { if (index) [items[index - 1], items[index]] = [items[index], items[index - 1]]; render(); }], ['↓', () => { if (index < items.length - 1) [items[index + 1], items[index]] = [items[index], items[index + 1]]; render(); }], ['×', () => { items.splice(index, 1); render(); }]];
                    row.append(label, target); for (const [text, action] of controls) { const b = document.createElement('button'); b.textContent = text; b.type = 'button'; b.addEventListener('click', action); row.append(b); } rows.append(row);
                });
            }; render();
            const add = document.createElement('button'); add.textContent = 'Додати пункт'; add.id = 'php-menu-add'; add.addEventListener('click', () => { items.push({ original: null, label: 'Новий пункт', page: repo.pages[0] }); render(); });
            const save = document.createElement('button'); save.id = 'php-menu-save'; save.className = 'primary'; save.textContent = 'Зберегти меню'; save.addEventListener('click', async () => {
                save.disabled = true; try { await repo.request('menu', { head: repo.head, items }); reload('Меню збережено як чернетку. Опублікуйте зміни для відвідувачів.'); }
                catch (error) { d.error.textContent = error.message; save.disabled = false; }
            }); d.body.append(add, save);
        }), document.getElementById('preview'));
        topbar.insertBefore(button('Версії', 'php-versions-button', async () => {
            const versions = (await repo.request('versions')).versions, d = dialog('Попередні версії');
            const hint = document.createElement('p'); hint.textContent = 'Зберігаються останні три версії перед змінами. Відновлення повертає документи як чернетку; потім їх потрібно опублікувати.'; d.body.append(hint);
            for (const version of versions) {
                const row = document.createElement('p'), label = document.createElement('span'); label.textContent = new Date(version.time).toLocaleString('uk-UA') + ' — ' + version.label + ' ';
                const restore = document.createElement('button'); restore.textContent = 'Відновити'; restore.className = 'secondary'; restore.addEventListener('click', async () => {
                    if (!confirm('Відновити цю версію замість поточних документів?')) return;
                    try { await repo.request('restore', { head: repo.head, version: version.id }); reload('Версію відновлено як чернетку. Перевірте й опублікуйте її.'); } catch (error) { d.error.textContent = error.message; }
                }); row.append(label, restore); d.body.append(row);
            }
            if (!versions.length) { const text = document.createElement('p'); text.textContent = 'Попередніх версій поки немає.'; d.body.append(text); }
        }), document.getElementById('preview'));
        const settings = document.querySelector('.page-settings');
        settings.append(button('Змінити адресу', 'php-rename-button', async () => {
            const path = info().path; if (path === 'index.html') throw new Error('Адреса головної сторінки залишається /.');
            const d = dialog('Нова адреса сторінки'), form = document.createElement('form'), input = document.createElement('input');
            input.id = 'php-new-address'; input.required = true; input.pattern = '[a-z0-9]+(?:-[a-z0-9]+)*'; input.maxLength = 70; input.value = path.split('/').pop().replace(/\.html?$/i, '').toLowerCase();
            const label = document.createElement('label'); label.htmlFor = input.id; label.textContent = 'Адреса латиницею, без .html';
            const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Перейменувати';
            form.append(label, input, save); form.addEventListener('submit', async event => { event.preventDefault(); save.disabled = true;
                try { await repo.request('rename', { head: repo.head, path, newPath: input.value + '.html', confirm: path }); reload('Адресу та внутрішні посилання оновлено. Опублікуйте зміни.'); }
                catch (error) { d.error.textContent = error.message; save.disabled = false; }
            }); d.body.append(form);
        }));
        settings.append(button('Видалити сторінку', 'php-delete-button', async () => {
            const path = info().path; if (path === 'index.html') throw new Error('Головну сторінку не можна видалити.');
            if (!confirm('Видалити ' + window.TCGRoutes.pageURL(path) + ' і прибрати переходи до неї? Попередня версія буде доступна для відновлення. Зміни набудуть чинності після публікації.')) return;
            await repo.request('delete', { head: repo.head, path, confirm: path }); reload('Сторінку видалено з чернетки. Опублікуйте зміни для відвідувачів.');
        }));
    };
})();
