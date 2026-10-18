(function () {
    'use strict';
    class PHP {
        constructor() { this.csrf = ''; this.publicationReady = false; this.draftImages = []; }
        async request(action, body) {
            const response = await fetch('/admin/api.php?action=' + action, { cache: 'no-store', redirect: 'error', credentials: 'same-origin',
                ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TCG-CSRF': this.csrf }, body: JSON.stringify(body) }) });
            let data; try { data = await response.json(); } catch { throw new Error('PHP не повернув очікувану відповідь. Відкрийте перевірку сумісності.'); }
            if (!response.ok) throw new Error(data.error || 'Операцію не завершено. Правки залишилися в редакторі.');
            if (data.csrf) this.csrf = data.csrf;
            return data;
        }
        async session() { const result = await this.request('session'); this.publicationReady = !!result.publicationReady; return result; }
        async list() { const data = await this.request('tree'); this.head = data.head; this.unpublished = !!data.unpublished; this.draftImages = data.draftImages || []; this.pages = data.files.filter(file => window.TCGRepository.isPage(file.path)).map(file => file.path); return data; }
        async read(path) { return (await this.request('read&path=' + encodeURIComponent(path))).content; }
        async readImage(path) { return this.request('image&path=' + encodeURIComponent(path)); }
        async publish(changes) {
            let saved = { head: this.head, published: false };
            if (changes.length) {
                window.TCGRepository.validateChanges(changes);
                saved = await this.request('save', { head: this.head, changes }); this.head = saved.head; this.unpublished = true;
                this.pages = [...new Set([...this.pages, ...changes.filter(file => window.TCGRepository.isPage(file.path)).map(file => file.path)])];
            }
            if (!this.publicationReady) return saved;
            const result = await this.request('publish', { head: this.head }); this.unpublished = false; return result;
        }
        async logout() { return this.request('logout', {}); }
    }
    window.TCGRepository.PHP = PHP;
    window.TCGPHP = { async boot(start) {
        const repo = new PHP(), $ = id => document.getElementById(id);
        $('login').hidden = true; $('login-note').textContent = 'Автономна адмінпанель на цьому хостингу.';
        const help = document.createElement('a'); help.href = '/admin/compatibility.html'; help.textContent = 'Перевірка сумісності'; $('login-note').after(help);
        try {
            const session = await repo.session();
            if (session.authenticated) { await start(repo); return; }
            const form = document.createElement('form'); form.id = 'php-login-form';
            const field = (id, label, type, autocomplete) => {
                const text = document.createElement('label'); text.htmlFor = id; text.textContent = label;
                const input = document.createElement('input'); input.id = id; input.type = type; input.required = true; input.autocomplete = autocomplete;
                form.append(text, input); return input;
            };
            let activation;
            if (session.setupRequired) { $('login-note').textContent = 'Початкове налаштування. Потрібен окремий ключ, отриманий разом із релізом.'; activation = field('activation-key', 'Ключ активації', 'password', 'off'); }
            const username = field('php-username', 'Логін', 'text', 'username'); username.pattern = '[A-Za-z0-9_-]{3,48}';
            const password = field('php-password', session.setupRequired ? 'Новий пароль (14–72 байти)' : 'Пароль', 'password', session.setupRequired ? 'new-password' : 'current-password');
            if (session.setupRequired) password.minLength = 14;
            const button = document.createElement('button'); button.className = 'primary'; button.type = 'submit'; button.textContent = session.setupRequired ? 'Налаштувати адміністратора' : 'Увійти'; form.append(button);
            $('login').after(form);
            form.addEventListener('submit', async event => {
                event.preventDefault(); button.disabled = true; $('login-status').textContent = '';
                const input = { username: username.value.trim(), password: password.value };
                try {
                    if (activation) { await repo.request('setup', { ...input, activationKey: activation.value.trim() }); activation.value = ''; }
                    await repo.request('login', input); password.value = ''; await repo.session(); await start(repo);
                } catch (error) { $('login-status').textContent = error.message; }
                finally { button.disabled = false; }
            });
        } catch (error) { $('login-status').textContent = error.message; }
    } };
})();
