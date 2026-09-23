(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TCGRepository = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const REPO = 'KingInjiro/Tcg_site';
    const BRANCH = 'main';
    const conflict = 'Сайт змінився після відкриття редактора. Ваші правки залишилися тут. Завантажте резервну копію правок і відкрийте редактор заново, щоб не перезаписати чужі зміни.';
    function isPage(path) {
        return typeof path === 'string' && /^(?:(?:Docs|ListPage)\/)?[\w-]+\.html?$/i.test(path) && !/^(test_|temp\.)/i.test(path);
    }
    function isImage(path) {
        return typeof path === 'string' && !path.includes('..') && !path.includes('\\') &&
            /^(?:images|derived|[\w.-]+\.files)\/[\w./ -]+\.(?:png|jpe?g|gif|webp)$/i.test(path);
    }
    function projectPath(path) {
        if (!isPage(path)) throw new Error('Некоректна адреса сторінки.');
        return '.tcg-editor/' + path + '.json';
    }
    function isProject(path) {
        return typeof path === 'string' && path.startsWith('.tcg-editor/') && path.endsWith('.json') && isPage(path.slice(12, -5));
    }
    function validateChanges(changes) {
        if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw new Error('Некоректний список змін.');
        const seen = new Set();
        let size = 0;
        for (const file of changes) {
            if (!file || typeof file.content !== 'string' || seen.has(file.path?.toLowerCase())) throw new Error('Некоректний або повторний файл.');
            seen.add(file.path.toLowerCase());
            const image = /^images\/editor\/[a-z0-9-]+\.(png|jpg|jpeg|gif|webp)$/.test(file.path);
            if (!(isPage(file.path) || isProject(file.path) || image)) throw new Error('Цей файл не можна змінювати через редактор.');
            if (file.encoding !== (image ? 'base64' : 'utf-8')) throw new Error('Некоректний формат файлу.');
            if (image && (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.content) || file.content.length > 2800000)) throw new Error('Зображення завелике або пошкоджене.');
            size += new TextEncoder().encode(file.content).byteLength;
        }
        if (size > 8000000) throw new Error('Забагато змін за одну публікацію (максимум 8 МБ).');
    }
    function decode(base64) {
        if (typeof Buffer !== 'undefined') return Buffer.from(base64, 'base64').toString('utf8');
        return new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, '')), c => c.charCodeAt(0)));
    }
    class GitHub {
        constructor(token, fetcher = globalThis.fetch) { this.token = token; this.fetcher = fetcher.bind(globalThis); }
        async api(path, body, method = body ? 'POST' : 'GET') {
            const response = await this.fetcher('https://api.github.com/repos/' + REPO + path, {
                method, cache: 'no-store', redirect: 'error',
                headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + this.token,
                    'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) {
                const error = new Error(response.status === 401 ? 'Вхід закінчився. Завантажте резервну копію правок і увійдіть знову.' :
                    [409, 422].includes(response.status) ? conflict :
                    response.status === 403 ? 'GitHub відхилив запит. Перевірте право запису та обмеження гілки main.' : 'Не вдалося звернутися до GitHub. Спробуйте ще раз.');
                error.status = response.status;
                throw error;
            }
            return response.json();
        }
        async list() {
            const ref = await this.api('/git/ref/heads/' + BRANCH);
            const commit = await this.api('/git/commits/' + ref.object.sha);
            const result = await this.api('/git/trees/' + commit.tree.sha + '?recursive=1');
            if (result.truncated) throw new Error('GitHub повернув неповний список файлів. Публікацію зупинено.');
            this.head = ref.object.sha;
            this.tree = commit.tree.sha;
            this.files = result.tree.filter(file => file.type === 'blob' && file.mode === '100644');
            return { head: this.head, files: this.files };
        }
        async read(path) {
            const entry = this.files.find(file => file.path === path);
            if (!entry) return null;
            const blob = await this.api('/git/blobs/' + entry.sha);
            if (blob.encoding !== 'base64') throw new Error('Непідтримуваний формат файлу GitHub.');
            return decode(blob.content);
        }
        async publish(changes) {
            validateChanges(changes);
            const current = await this.api('/git/ref/heads/' + BRANCH);
            if (current.object.sha !== this.head) throw new Error(conflict);
            const tree = [];
            for (const file of changes) {
                const entry = { path: file.path, mode: '100644', type: 'blob' };
                if (file.encoding === 'base64') entry.sha = (await this.api('/git/blobs', { content: file.content, encoding: 'base64' })).sha;
                else entry.content = file.content;
                tree.push(entry);
            }
            const nextTree = await this.api('/git/trees', { base_tree: this.tree, tree });
            const commit = await this.api('/git/commits', { message: 'Оновити сторінки у візуальному редакторі TCG', tree: nextTree.sha, parents: [this.head] });
            // A concurrent commit makes this non-fast-forward. Never retry with force.
            await this.api('/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false }, 'PATCH');
            this.head = commit.sha;
            this.tree = nextTree.sha;
            return { head: commit.sha, url: 'https://github.com/' + REPO + '/commit/' + commit.sha };
        }
    }
    class Local {
        constructor(fetcher = globalThis.fetch) { this.fetcher = fetcher.bind(globalThis); }
        async request(query, body) {
            const response = await this.fetcher('/api/editor-local' + query, {
                method: body ? 'POST' : 'GET', cache: 'no-store',
                ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Не вдалося зберегти локальні зміни.');
            return data;
        }
        async list() { const data = await this.request('?action=tree'); this.head = data.head; return data; }
        async read(path) { return (await this.request('?action=read&path=' + encodeURIComponent(path))).content; }
        async publish(changes) { validateChanges(changes); const data = await this.request('', { head: this.head, changes }); this.head = data.head; return data; }
    }
    return { GitHub, Local, isPage, isImage, isProject, projectPath, validateChanges, conflict };
});
