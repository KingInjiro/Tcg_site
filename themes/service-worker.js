'use strict';
// The editor canvas must not install or control the public site's offline cache.
if (window.top === window && 'serviceWorker' in navigator && window.isSecureContext) {
    let controlled = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Do not reload an open form. The next ordinary navigation is a safe
        // point to load the new document, scripts and styles together.
        if (controlled) window.TCGUpdateReady = true;
        controlled = true;
    });
    const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .then(registration => {
            let lastCheck = Date.now();
            const check = () => {
                if (document.visibilityState !== 'visible' || !navigator.onLine || Date.now() - lastCheck < 60000) return;
                lastCheck = Date.now();
                registration.update().catch(() => {});
            };
            // SPA visits do not reload this script. Check in the background,
            // without adding a network wait to each menu click.
            document.addEventListener('tcg:page-load', check);
            document.addEventListener('visibilitychange', check);
            window.addEventListener('online', check);
        })
        .catch(() => { /* Ordinary online navigation remains available. */ });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
}
