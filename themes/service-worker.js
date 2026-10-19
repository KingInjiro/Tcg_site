// Historical URL retained for old HTML. Online updates only; no registration,
// precaching or dependency on a worker's install/activate lifecycle.
(function () {
    'use strict';
    if (window.top !== window || /^\/(?:admin|api)(?:\/|$)/i.test(location.pathname)) return;
    const build = () => document.querySelector('meta[name="tcg-build"]')?.content;
    const token = 'tcg-online';
    const tcgWorker = worker => {
        if (!worker) return false;
        const url = new URL(worker.scriptURL);
        return url.origin === location.origin && url.pathname === '/sw.js';
    };
    let checking = false, applying = false, pendingVersion, editableDirty = false;
    let detach = false, cleaning;

    function unfinished() {
        if (editableDirty || document.documentElement.hasAttribute('aria-busy') ||
            document.querySelector('form [type="submit"]:disabled, form[aria-busy="true"]')) return true;
        return [...document.querySelectorAll('input, textarea, select')].some(field => {
            if (field.matches('input[type="hidden"], input[type="submit"], input[type="button"], input[type="reset"]')) return false;
            if (field.matches('input[type="checkbox"], input[type="radio"]')) return field.checked !== field.defaultChecked;
            if (field.matches('select')) {
                const options = [...field.options], hasDefault = options.some(option => option.defaultSelected);
                return options.some((option, index) => option.selected !== (option.defaultSelected || (!field.multiple && !hasDefault && index === 0)));
            }
            return field.value !== field.defaultValue;
        });
    }
    function ready() {
        window.TCGUpdateReady = Boolean(detach || pendingVersion && pendingVersion !== build());
        window.TCGUpdateVersion = pendingVersion || build();
    }
    function cleanURL() {
        const url = new URL(location.href);
        if (url.searchParams.get(token) === build() && !tcgWorker(navigator.serviceWorker?.controller)) {
            url.searchParams.delete(token);
            history.replaceState(history.state, '', url);
        }
    }
    async function retire() {
        if (cleaning) return cleaning;
        cleaning = (async () => {
            const controlled = tcgWorker(navigator.serviceWorker?.controller);
            try {
                if (navigator.serviceWorker && window.isSecureContext) {
                    for (const registration of await navigator.serviceWorker.getRegistrations()) {
                        const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
                        if (registration.scope !== new URL('/', location.origin).href || !workers.length || !workers.every(tcgWorker)) continue;
                        // Unregister directly, without waiting for worker activation.
                        if (!await registration.unregister()) throw new Error('TCG unregister did not complete');
                    }
                }
            } finally {
                if (window.caches) await Promise.all((await caches.keys()).filter(name => name.startsWith('tgroup-pwa-')).map(name => caches.delete(name)));
                detach = controlled;
                cleanURL(); ready();
            }
        })().finally(() => { cleaning = null; });
        return cleaning;
    }
    async function applyUpdate() {
        ready();
        if (!window.TCGUpdateReady || applying || !build() || !navigator.onLine ||
            document.visibilityState !== 'visible' || unfinished()) return;
        const version = pendingVersion || build(), original = location.href, target = new URL(original);
        // The URL guard works even when sessionStorage is unavailable. Leave
        // the token if a stale or partial response did not advance the HTML.
        if (target.searchParams.get(token) === version) return;
        const attempt = JSON.stringify([version, target.pathname, target.search]);
        try { if (sessionStorage.getItem('tcg-online-attempt') === attempt) return; } catch { /* URL guard remains. */ }
        applying = true;
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
        try {
            try { await retire(); }
            catch {
                // A browser policy may deny SW APIs even on an ordinary online
                // page. It must not block publication when no TCG worker controls it.
                if (tcgWorker(navigator.serviceWorker?.controller)) return;
            }
            target.searchParams.set(token, version);
            const probe = new URL(target); probe.searchParams.set('tcg-probe', Date.now().toString(36));
            const response = await fetch(probe, { cache: 'no-store', signal: controller.signal });
            if (new URL(response.url).origin !== location.origin) return;
            if (response.status !== 404) {
                if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
                const html = new DOMParser().parseFromString(await response.text(), 'text/html');
                if (html.querySelector('meta[name="tcg-build"]')?.content !== version) return;
            }
            if (location.href !== original || unfinished() || !navigator.onLine || document.visibilityState !== 'visible' ||
                version !== (pendingVersion || build())) return;
            try { sessionStorage.setItem('tcg-online-attempt', attempt); } catch { /* Navigation token limits retries. */ }
            location.replace(target.href);
        } catch { /* Keep the document and form during outages or partial uploads. */ }
        finally { clearTimeout(timeout); applying = false; }
    }
    async function check() {
        if (checking || !build() || !navigator.onLine || document.visibilityState !== 'visible') return;
        checking = true;
        // Cleanup and publication detection do not wait for worker activation.
        retire().then(applyUpdate).catch(() => {});
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const url = new URL('/site-version.json', location.origin);
            url.searchParams.set('tcg-check', Date.now().toString(36));
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (response.ok) {
                const version = (await response.json()).version;
                if (typeof version === 'string' && /^[a-z0-9-]{1,80}$/i.test(version)) pendingVersion = version;
            }
        } catch { /* Keep the current page while the server is unavailable. */ }
        finally { clearTimeout(timeout); checking = false; }
        applyUpdate();
    }
    document.addEventListener('input', event => { if (event.target.isContentEditable) editableDirty = true; });
    document.addEventListener('reset', () => setTimeout(applyUpdate, 0));
    document.addEventListener('tcg:page-load', () => { editableDirty = false; check(); });
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', check);
    navigator.serviceWorker?.addEventListener('message', event => {
        if (event.data?.type === 'TCG_PWA_RETIRED' || event.data?.type === 'TCG_UPDATE') check();
    });
    navigator.serviceWorker?.addEventListener('controllerchange', check);
    cleanURL();
    setInterval(check, 15000);
    check();
})();
