(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const R = window.TCGRepository, D = window.TCGDocument;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('local') === 'true';
    const titles = { 'index.html': 'Головна', 'contacts.html': 'Контакти', 'services.html': 'Послуги', 'products.html': 'Продукти', 'news.html': 'Новини', 'price01.html': 'Ціни', 'Download.html': 'Завантаження', 'feedback.html': 'Зворотний зв’язок', 'toc.html': 'Зміст' };
    const state = { pages: new Map(), assets: [], uploads: new Map(), current: null, repo: null, editor: null, loading: false, busy: false };
    let assetTarget, assetLimit = 48;
    const clone = value => JSON.parse(JSON.stringify(value));
    const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join('');
    const dirtyPages = () => [...state.pages.values()].filter(page => page.dirty);
    function status(message, error = false) { $('status').textContent = message; $('status').parentElement.classList.toggle('error', error); }
    function updateButtons() {
        $('publish').disabled = state.busy || state.loading || !dirtyPages().length;
        $('new-page').disabled = state.busy || state.loading || !state.current;
        for (const id of ['preview', 'backup', 'restore', 'logout']) $(id).disabled = state.busy || state.loading;
        $('preview').disabled ||= !state.current;
        $('page-title').disabled = !state.current;
        $('dirty-badge').hidden = !state.pages.get(state.current)?.dirty;
    }
    function markDirty() {
        if (state.loading || state.busy || !state.current) return;
        state.pages.get(state.current).dirty = true;
        status('Є неопубліковані зміни');
        updateButtons();
        renderPageList();
    }
    function displayTitle(page) { return titles[page.path] || page.meta?.title || page.path.replace(/\.html?$/i, ''); }
    function renderPageList() {
        const search = $('page-search').value.trim().toLowerCase();
        const scroll = $('page-list').scrollTop;
        $('page-list').replaceChildren();
        const pages = [...state.pages.values()].sort((a, b) => a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : displayTitle(a).localeCompare(displayTitle(b), 'uk'));
        for (const page of pages) {
            if (!(displayTitle(page) + ' ' + page.path).toLowerCase().includes(search)) continue;
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.path = page.path; button.title = '/' + page.path;
            button.classList.toggle('active', page.path === state.current);
            button.setAttribute('aria-current', page.path === state.current ? 'page' : 'false');
            const icon = document.createElement('span'); icon.className = 'page-icon'; icon.textContent = '◧'; icon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span'); name.className = 'page-name'; name.textContent = displayTitle(page);
            button.append(icon, name);
            if (page.dirty) { const dot = document.createElement('span'); dot.className = 'page-dirty'; dot.textContent = '●'; dot.title = 'Чернетка'; button.append(dot); }
            button.addEventListener('click', () => openPage(page.path));
            $('page-list').append(button);
        }
        $('page-list').scrollTop = scroll;
        const value = $('link-page').value;
        $('link-page').replaceChildren(new Option('Виберіть сторінку…', ''));
        for (const page of pages) $('link-page').append(new Option(displayTitle(page), '/' + page.path));
        $('link-page').value = value;
    }
    function replaceAssets(value, publishing) {
        let result = typeof value === 'string' ? value : JSON.stringify(value);
        for (const [path, asset] of state.uploads) result = result.split(publishing ? asset.dataURL : '/' + path).join(publishing ? '/' + path : asset.dataURL);
        return typeof value === 'string' ? result : JSON.parse(result);
    }
    function capture() {
        if (!state.editor || state.loading || !state.current) return;
        // Finishing text editing flushes the rich-text editor into the component model.
        state.editor.RichTextEditor.disable();
        const page = state.pages.get(state.current);
        page.project = clone(state.editor.getProjectData());
        if (page.dirty) page.html = D.exportHTML(state.editor, page.meta);
    }
    const icon = paths => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
    function addBlocks(editor) {
        const blocks = [
            ['heading', 'Заголовок', '<path d="M5 4v16M19 4v16M5 12h14"/>', '<h2 style="padding:10px 16px;font-size:28px">Ваш заголовок</h2>'],
            ['text', 'Текст', '<path d="M4 5h16M4 10h16M4 15h16M4 20h10"/>', '<p style="padding:10px 16px;line-height:1.6">Двічі натисніть, щоб змінити цей текст.</p>'],
            ['image', 'Зображення', '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 3-4 5 6"/>', { type: 'image', style: { width: '100%', 'max-width': '600px', 'min-height': '120px' }, attributes: { alt: 'Зображення' } }],
            ['button', 'Кнопка', '<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M7 12h10m-3-3 3 3-3 3"/>', '<a href="/contacts.html" style="display:inline-block;margin:16px;padding:12px 24px;background:#196450;color:white;border-radius:6px;text-decoration:none">Дізнатися більше</a>'],
            ['section', 'Секція', '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 8h10M7 12h10M7 16h5"/>', '<section style="padding:40px 24px"><h2>Нова секція</h2><p>Додайте сюди текст, фотографії або інші блоки.</p></section>'],
            ['columns', 'Дві колонки', '<rect x="3" y="4" width="7" height="16" rx="1"/><rect x="14" y="4" width="7" height="16" rx="1"/>', '<section style="display:flex;flex-wrap:wrap;gap:24px;padding:24px"><div style="flex:1;min-width:200px;padding:16px"><h3>Перша колонка</h3><p>Ваш текст.</p></div><div style="flex:1;min-width:200px;padding:16px"><h3>Друга колонка</h3><p>Ваш текст.</p></div></section>'],
            ['divider', 'Розділювач', '<path d="M3 12h18M8 6h8M8 18h8"/>', '<hr style="border:0;border-top:1px solid #d9e1da;margin:28px 16px">'],
            ['spacer', 'Відступ', '<path d="M3 3h18M3 21h18M12 7v10m-3-7 3-3 3 3m-6 4 3 3 3-3"/>', '<div style="height:48px"></div>'],
        ];
        for (const [id, label, svg, content] of blocks) editor.BlockManager.add(id, { label, media: icon(svg), content, activate: id === 'image', select: true });
    }
    function inspector(component) {
        $('selection-hint').hidden = !!component;
        $('selection-name').textContent = component ? (component.get('name') || component.get('tagName') || 'Елемент') : '';
        const image = component?.is('image');
        const link = component?.is('link') || component?.get('tagName') === 'a';
        $('choose-image').hidden = !image; $('link-control').hidden = !link;
        if (component) {
            const traits = image ? [{ type: 'text', name: 'alt', label: 'Опис зображення' }] : link ? [{ type: 'text', name: 'href', label: 'Адреса посилання' }, { type: 'select', name: 'target', label: 'Відкривати', options: [{ id: '', label: 'У цій вкладці' }, { id: '_blank', label: 'У новій вкладці' }] }] : [];
            component.set('traits', traits);
            if (link) $('link-page').value = component.getAttributes().href || '';
        }
    }
    function createEditor(page) {
        if (state.editor) state.editor.destroy();
        for (const id of ['blocks', 'styles', 'traits', 'layers', 'editor']) $(id).replaceChildren();
        const editor = window.grapesjs.init({
            container: '#editor', height: '100%', width: 'auto', fromElement: false, storageManager: false,
            telemetry: false, noticeOnUnload: false, allowScripts: false, nativeDnD: false,
            protectedCss: '', baseCss: '', canvasCss: '', keepUnusedStyles: true, avoidInlineStyle: false,
            panels: { defaults: [] }, selectorManager: { componentFirst: true },
            blockManager: { appendTo: '#blocks', appendOnClick: true }, traitManager: { appendTo: '#traits' }, layerManager: { appendTo: '#layers' },
            deviceManager: { devices: [{ id: 'desktop', name: 'Комп’ютер', width: '' }, { id: 'mobile', name: 'Телефон', width: '390px', widthMedia: '600px' }] },
            styleManager: { appendTo: '#styles', sectors: [
                { name: 'Розмір', open: true, properties: [{ property: 'width', label: 'Ширина' }, { property: 'height', label: 'Висота' }, { property: 'max-width', label: 'Макс. ширина' }, { property: 'min-height', label: 'Мін. висота' }] },
                { name: 'Текст', open: true, properties: [{ property: 'font-family', label: 'Шрифт' }, { property: 'font-size', label: 'Розмір' }, { property: 'font-weight', label: 'Насиченість' }, { property: 'color', label: 'Колір' }, { property: 'line-height', label: 'Висота рядка' }, { property: 'text-align', label: 'Вирівнювання' }] },
                { name: 'Відступи', open: false, properties: [{ property: 'padding', label: 'Усередині' }, { property: 'margin', label: 'Зовні' }] },
                { name: 'Фон і рамка', open: false, properties: [{ property: 'background-color', label: 'Колір фону' }, { property: 'border-radius', label: 'Заокруглення' }, { property: 'border', label: 'Рамка' }, { property: 'opacity', label: 'Прозорість' }] },
                { name: 'Розташування', open: false, properties: [{ property: 'display', label: 'Розкладка' }, { property: 'flex-direction', label: 'Напрям' }, { property: 'justify-content', label: 'Вирівнювання' }, { property: 'align-items', label: 'Елементи' }, { property: 'gap', label: 'Проміжок' }] },
            ] },
            assetManager: { custom: true },
            plugins: [D.register],
        });
        state.editor = editor;
        editor.on('canvas:frame:load:head', () => $('editor').querySelectorAll('iframe').forEach(frame => frame.setAttribute('sandbox', 'allow-same-origin')));
        editor.on('canvas:frame:load', () => D.canvasHead(editor, page.meta, page.path));
        editor.on('update', markDirty);
        editor.on('component:selected', inspector);
        editor.on('component:deselected', () => inspector(null));
        editor.on('asset:custom', props => { if (props.open) { editor.AssetManager.close(); openAssets(editor.getSelected()); } });
        editor.on('component:mount', component => {
            const el = component.getEl();
            if (el?.tagName === 'FORM') el.addEventListener('submit', event => event.preventDefault());
        });
        addBlocks(editor);
        return new Promise((resolve, reject) => editor.on('load', () => {
          try {
            if (page.project) editor.loadProjectData(D.safeModel(replaceAssets(page.project, false)));
            else {
                const imported = D.importHTML(page.html, page.path);
                page.meta = imported.meta;
                editor.setComponents(imported.body);
                if (imported.css) editor.addStyle(imported.css);
                const attributes = { ...page.meta.bodyAttributes };
                for (const name of Object.keys(attributes)) if (/^on/i.test(name)) delete attributes[name];
                editor.getWrapper().addAttributes(attributes);
                for (const component of editor.getWrapper().find('tcg-preserved')) component.set('raw', imported.raw[component.getAttributes()['data-key']] || '');
            }
            D.canvasHead(editor, page.meta, page.path);
            editor.UndoManager.clear(); editor.clearDirtyCount();
            $('blocks').querySelectorAll('.gjs-block').forEach(element => {
                element.setAttribute('tabindex', '0'); element.setAttribute('role', 'button');
                element.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); element.click(); } });
            });
            inspector(null);
            requestAnimationFrame(() => resolve(editor));
          } catch (error) {
            reject(new Error('Не вдалося відкрити дані цієї сторінки. Виберіть іншу сторінку або перевірте її резервну копію.'));
          }
        }));
    }
    async function openPage(path) {
        if (state.busy || state.loading) return;
        capture(); state.loading = true; updateButtons(); $('app').querySelector('.workspace').inert = true;
        const page = state.pages.get(path);
        status('Відкриваю сторінку…');
        try {
            if (!page.html) {
                const [html, saved] = await Promise.all([state.repo.read(path), state.repo.read(R.projectPath(path))]);
                if (html === null) throw new Error('Сторінку не знайдено. Оновіть список сторінок.');
                page.html = html;
                page.meta = D.importHTML(html, path).meta;
                if (saved) {
                    let data;
                    try { data = JSON.parse(saved); } catch { /* Import the actual HTML if metadata is damaged. */ }
                    if (data?.version === 1 && data.path === path && data.htmlHash === await hash(html) && data.meta && data.project) {
                        page.meta = data.meta; page.project = data.project;
                    }
                }
            }
            state.current = path;
            await createEditor(page);
            $('current-path').textContent = '/' + path;
            $('page-title').value = page.meta.title;
            $('desktop').classList.add('active'); $('mobile').classList.remove('active');
            status(page.dirty ? 'Є неопубліковані зміни' : 'Двічі натисніть на текст, щоб редагувати');
        } catch (error) {
            // A failed import must not replace the previously captured page's draft.
            state.current = null;
            state.editor?.destroy(); state.editor = null;
            $('current-path').textContent = 'Сторінку не відкрито';
            status(error.message, true);
        }
        finally { state.loading = false; $('app').querySelector('.workspace').inert = false; renderPageList(); updateButtons(); }
    }
    async function start(repo) {
        $('login-status').textContent = 'Завантаження сторінок…';
        const listing = await repo.list();
        if (!listing.files.some(file => R.isPage(file.path))) throw new Error('У репозиторії немає сторінок для редагування.');
        state.repo = repo;
        for (const file of listing.files.filter(file => R.isPage(file.path))) state.pages.set(file.path, { path: file.path, dirty: false });
        state.assets = listing.files.filter(file => R.isImage(file.path)).map(file => file.path);
        $('login-screen').hidden = true; $('app').hidden = false;
        renderPageList();
        await openPage(state.pages.has('index.html') ? 'index.html' : state.pages.keys().next().value);
    }
    function login() {
        $('login-status').textContent = '';
        if (local) return start(new R.Local()).catch(error => { $('login-status').textContent = error.message; });
        const popup = window.open('/api/auth?provider=github', 'tcg-login', 'width=640,height=740');
        if (!popup) { $('login-status').textContent = 'Дозвольте спливне вікно для входу через GitHub.'; return; }
        $('login').disabled = true;
        let finished = false;
        function cleanup() { finished = true; clearInterval(timer); window.removeEventListener('message', receive); $('login').disabled = false; }
        function receive(event) {
            if (event.origin !== location.origin || event.source !== popup || typeof event.data !== 'string') return;
            if (event.data === 'authorizing:github') { popup.postMessage('authorizing:github', location.origin); return; }
            const match = event.data.match(/^authorization:github:(success|error):([\s\S]+)$/);
            if (!match) return;
            try {
                const data = JSON.parse(match[2]);
                cleanup(); popup.close();
                if (match[1] !== 'success' || typeof data.token !== 'string') throw new Error(data.message || 'Не вдалося увійти.');
                // The OAuth token lives only in memory, never in localStorage or a backup.
                start(new R.GitHub(data.token)).catch(error => { $('login-status').textContent = error.message; });
            } catch (error) { $('login-status').textContent = error.message; }
        }
        const started = Date.now();
        const timer = setInterval(() => {
            if (!finished && (popup.closed || Date.now() - started > 600000)) { cleanup(); $('login-status').textContent = 'Вхід не завершено. Спробуйте ще раз.'; }
        }, 1000);
        window.addEventListener('message', receive);
    }
    async function publish() {
        if (state.busy || state.loading) return;
        capture();
        const pages = dirtyPages();
        if (!pages.length) return;
        state.busy = true; updateButtons(); $('app').querySelector('.workspace').inert = true; $('publish').textContent = 'Публікація…';
        status('Зберігаю сторінки та зображення…'); $('publication').hidden = true;
        try {
            const changes = [], saved = new Map();
            for (const page of pages) {
                const html = replaceAssets(page.html, true);
                const project = replaceAssets(page.project, true);
                const data = { version: 1, path: page.path, meta: page.meta, project, htmlHash: await hash(html) };
                changes.push({ path: page.path, content: html, encoding: 'utf-8' }, { path: R.projectPath(page.path), content: JSON.stringify(data), encoding: 'utf-8' });
                saved.set(page.path, { html, project });
            }
            for (const [path, asset] of state.uploads) if (!asset.published) changes.push({ path, content: asset.base64, encoding: 'base64' });
            const result = await state.repo.publish(changes);
            for (const page of pages) { Object.assign(page, saved.get(page.path)); page.dirty = false; }
            // Keep temporary image previews until reload: deployment may still be building.
            for (const path of state.uploads.keys()) if (!state.assets.includes(path)) state.assets.push(path);
            state.uploads.forEach(asset => { asset.published = true; });
            if (result.url) { $('publication').href = result.url; $('publication').hidden = false; }
            status(local ? 'Збережено. Зміни вже доступні на локальному сайті.' : 'Збережено в GitHub. Сайт оновиться після успішного розгортання Vercel.');
        } catch (error) { status(error.message + ' Правки залишилися в редакторі.', true); }
        finally { state.busy = false; $('app').querySelector('.workspace').inert = false; $('publish').textContent = 'Опублікувати'; renderPageList(); updateButtons(); }
    }
    async function createPage(event) {
        event.preventDefault();
        const title = $('new-title').value.trim(), slug = $('new-slug').value.trim(), path = slug + '.html';
        if (!title || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !R.isPage(path)) { $('new-error').textContent = 'Вкажіть назву й коректну адресу сторінки.'; return; }
        if ([...state.pages.keys()].some(existing => existing.toLowerCase().replace(/\.html?$/i, '') === slug)) { $('new-error').textContent = 'Така адреса вже зайнята. Виберіть іншу.'; return; }
        capture();
        const source = state.pages.get(state.current), kind = $('new-template').value;
        const page = { path, html: kind === 'copy' ? D.rebaseCopy(D.exportHTML(state.editor, source.meta), source.path) : D.template(title, kind), dirty: true };
        page.meta = D.importHTML(page.html, path).meta;
        if ($('new-link').checked && source) {
            state.editor.addComponents('<p style="padding:16px"><a href="/' + D.escape(path) + '">' + D.escape(title) + '</a></p>');
            markDirty(); capture();
        }
        state.pages.set(path, page); $('new-dialog').close(); renderPageList();
        await openPage(path);
        markDirty();
        // Update the copied document's title independently of its source.
        state.pages.get(path).meta.title = title; $('page-title').value = title; capture();
    }
    function openAssets(target) {
        if (!target?.is('image')) return;
        assetTarget = target; assetLimit = 48; $('asset-error').textContent = ''; $('asset-search').value = ''; renderAssets(); $('asset-dialog').showModal();
    }
    function renderAssets() {
        const search = $('asset-search').value.toLowerCase();
        const paths = [...new Set([...state.uploads.keys(), ...state.assets])].filter(path => path.toLowerCase().includes(search));
        $('asset-grid').replaceChildren();
        for (const path of paths.slice(0, assetLimit)) {
            const button = document.createElement('button'); button.className = 'asset-item'; button.title = path;
            const image = document.createElement('img'); image.loading = 'lazy'; image.src = state.uploads.get(path)?.dataURL || '/' + path.split('/').map(encodeURIComponent).join('/'); image.alt = '';
            const name = document.createElement('span'); name.textContent = path.split('/').pop();
            button.append(image, name);
            button.addEventListener('click', () => { assetTarget.set('src', state.uploads.get(path)?.dataURL || '/' + path); $('asset-dialog').close(); markDirty(); });
            $('asset-grid').append(button);
        }
        $('more-assets').hidden = paths.length <= assetLimit;
    }
    async function upload(file) {
        if (!file) return;
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[file.type];
        if (!ext || file.size > 2 * 1024 * 1024) throw new Error('Виберіть PNG, JPG, WebP або GIF розміром до 2 МБ.');
        const dataURL = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
        // Decode before accepting an image; a forged MIME type is not enough.
        await new Promise((resolve, reject) => { const img = new Image(); img.onload = resolve; img.onerror = () => reject(new Error('Цей файл не вдалося відкрити як зображення.')); img.src = dataURL; });
        const path = 'images/editor/' + crypto.randomUUID() + '-' + (D.slug(file.name.replace(/\.[^.]+$/, '')) || 'image') + '.' + ext;
        state.uploads.set(path, { dataURL, base64: dataURL.split(',')[1] });
        assetTarget.set('src', dataURL); markDirty(); $('asset-dialog').close();
    }
    function backup() {
        capture();
        const data = { version: 1, repository: 'KingInjiro/Tcg_site', head: state.repo.head, pages: dirtyPages(), uploads: [...state.uploads] };
        const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'tcg-draft-' + new Date().toISOString().slice(0, 10) + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function restore(file) {
        if (!file || file.size > 16000000) throw new Error('Резервна копія відсутня або завелика.');
        const data = JSON.parse(await file.text());
        if (data.version !== 1 || data.repository !== 'KingInjiro/Tcg_site' || !Array.isArray(data.pages) || !Array.isArray(data.uploads)) throw new Error('Це не резервна копія редактора TCG.');
        if (data.head !== state.repo.head) throw new Error(R.conflict);
        if (dirtyPages().length && !confirm('Замінити поточні чернетки правками з резервної копії?')) return;
        for (const page of data.pages) if (!R.isPage(page.path) || typeof page.html !== 'string' || !page.meta || !page.project) throw new Error('Пошкоджені дані сторінки.');
        R.validateChanges(data.pages.flatMap(page => [{ path: page.path, content: page.html, encoding: 'utf-8' }, { path: R.projectPath(page.path), content: JSON.stringify(page.project), encoding: 'utf-8' }]).concat(data.uploads.map(([path, asset]) => ({ path, content: asset.base64, encoding: 'base64' }))));
        if (!data.pages.length) throw new Error('У цій копії немає змінених сторінок.');
        state.current = null;
        for (const page of data.pages) state.pages.set(page.path, { ...page, dirty: true });
        state.uploads = new Map(data.uploads);
        renderPageList(); await openPage(data.pages[0].path); status('Чернетки відновлено. Перевірте їх перед публікацією.');
    }
    function preview() {
        capture();
        const page = state.pages.get(state.current);
        const html = D.exportHTML(state.editor, page.meta);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script,iframe,object,embed,meta[http-equiv]').forEach(node => node.remove());
        const base = doc.createElement('base'); base.href = new URL('/' + page.path, location.origin).href; doc.head.prepend(base);
        const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = "script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"; doc.head.prepend(csp);
        const url = URL.createObjectURL(new Blob([doc.documentElement.outerHTML], { type: 'text/html' }));
        window.open(url, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    $('login').addEventListener('click', login);
    $('publish').addEventListener('click', publish);
    $('page-search').addEventListener('input', renderPageList);
    $('page-title').addEventListener('input', () => { state.pages.get(state.current).meta.title = $('page-title').value; markDirty(); });
    $('undo').addEventListener('click', () => state.editor.UndoManager.undo());
    $('redo').addEventListener('click', () => state.editor.UndoManager.redo());
    for (const id of ['desktop', 'mobile']) $(id).addEventListener('click', () => { state.editor.Devices.select(id); $('desktop').classList.toggle('active', id === 'desktop'); $('mobile').classList.toggle('active', id === 'mobile'); });
    for (const id of ['style', 'layers']) $(id + '-tab').addEventListener('click', () => { $('inspector').hidden = id === 'layers'; $('layers').hidden = id === 'style'; $('style-tab').classList.toggle('active', id === 'style'); $('layers-tab').classList.toggle('active', id === 'layers'); });
    $('link-page').addEventListener('change', () => { const selected = state.editor.getSelected(); if (selected && $('link-page').value) selected.addAttributes({ href: $('link-page').value }); });
    $('new-page').addEventListener('click', () => { $('new-form').reset(); $('new-slug').dataset.manual = ''; $('new-error').textContent = ''; $('new-dialog').showModal(); });
    $('new-title').addEventListener('input', () => { if (!$('new-slug').dataset.manual) $('new-slug').value = D.slug($('new-title').value); });
    $('new-slug').addEventListener('input', () => { $('new-slug').dataset.manual = '1'; });
    $('new-form').addEventListener('submit', event => createPage(event).catch(error => { $('new-error').textContent = error.message; }));
    document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
    $('choose-image').addEventListener('click', () => openAssets(state.editor.getSelected()));
    $('asset-search').addEventListener('input', () => { assetLimit = 48; renderAssets(); });
    $('more-assets').addEventListener('click', () => { assetLimit += 48; renderAssets(); });
    $('asset-upload').addEventListener('change', async event => { try { await upload(event.target.files[0]); } catch (error) { $('asset-error').textContent = error.message; } finally { event.target.value = ''; } });
    $('backup').addEventListener('click', backup); $('restore').addEventListener('click', () => $('restore-file').click());
    $('restore-file').addEventListener('change', event => restore(event.target.files[0]).catch(error => status(error.message, true)).finally(() => { event.target.value = ''; }));
    $('preview').addEventListener('click', preview);
    $('logout').addEventListener('click', () => { if (!dirtyPages().length || confirm('Є неопубліковані зміни. Вийти й відкинути їх?')) { state.pages.clear(); state.repo.token = ''; location.reload(); } });
    window.addEventListener('beforeunload', event => { if (dirtyPages().length) { event.preventDefault(); event.returnValue = ''; } });
    if (local) { $('login').textContent = 'Відкрити локальний редактор →'; $('login-note').textContent = 'Зміни зберігатимуться у файлах на цьому комп’ютері'; }
    if (!window.grapesjs || !R || !D) { $('login').disabled = true; $('login-status').textContent = 'Не вдалося завантажити редактор. Оновіть сторінку.'; }
})();
