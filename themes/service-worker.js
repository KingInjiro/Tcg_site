(function () {
    'use strict';
    // Public documents only: the editor must never reload or install a worker.
    if (window.top !== window || /^\/(?:admin|api)(?:\/|$)/i.test(location.pathname)) return;
    const build = () => document.querySelector('meta[name="tcg-build"]')?.content;
    let registration, checking = false, pendingVersion, reloading = false, editableDirty = false;
    let lastWorkerCheck = 0;

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
    function applyUpdate() {
        if (!pendingVersion || pendingVersion === build() || reloading || !navigator.onLine ||
            document.visibilityState !== 'visible' || unfinished()) return;
        // A partially uploaded site or an upstream stale HTML response must not
        // cause a reload loop. Retry later if HTML and the version marker disagree.
        try {
            const previous = JSON.parse(sessionStorage.getItem('tcg-update-attempt') || 'null');
            if (previous?.version === pendingVersion && Date.now() - previous.time < 60000) return;
            sessionStorage.setItem('tcg-update-attempt', JSON.stringify({ version: pendingVersion, time: Date.now() }));
        } catch { /* Storage may be disabled. */ }
        reloading = true;
        location.reload();
    }
    function receiveVersion(version) {
        if (typeof version !== 'string' || !build()) return;
        if (version === build()) { pendingVersion = null; window.TCGUpdateReady = false; return; }
        pendingVersion = version;
        window.TCGUpdateReady = true;
        applyUpdate();
    }
    const warm = () => navigator.serviceWorker?.controller?.postMessage({ type: 'TCG_WARM_CACHE' });
    async function check() {
        if (checking || !build() || !navigator.onLine || document.visibilityState !== 'visible') return;
        checking = true;
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
        try {
            const response = await fetch('/site-version.json', { cache: 'no-store', signal: controller.signal });
            if (response.ok) receiveVersion((await response.json()).version);
        } catch { /* Offline or interrupted publication: keep the current document. */ }
        finally { clearTimeout(timeout); checking = false; }
        if (registration && Date.now() - lastWorkerCheck >= 60000) {
            lastWorkerCheck = Date.now();
            registration.update().catch(() => {});
        }
        applyUpdate();
    }
    document.addEventListener('input', event => { if (event.target.isContentEditable) editableDirty = true; });
    document.addEventListener('reset', () => setTimeout(applyUpdate, 0));
    document.addEventListener('tcg:page-load', () => { editableDirty = false; check(); });
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    window.addEventListener('online', () => { check(); warm(); });
    setInterval(check, 15000);
    check();
    if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data?.type !== 'TCG_UPDATE') return;
            event.ports[0]?.postMessage('received');
            // The network marker is published after HTML; it is the authority
            // even when a worker from a different deployment wins a race.
            check();
        });
        navigator.serviceWorker.addEventListener('controllerchange', () => { warm(); check(); });
        const register = async () => {
            try {
                registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
                await navigator.serviceWorker.ready;
                warm();
            } catch { /* Version checks and online navigation work without PWA. */ }
        };
        if (document.readyState === 'complete') register();
        else window.addEventListener('load', register, { once: true });
    }
})();
