'use strict';
// The editor canvas must not install or control the public site's offline cache.
if (window.top === window && 'serviceWorker' in navigator && window.isSecureContext) {
    const register = () => navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
        .catch(() => { /* Ordinary online navigation remains available. */ });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
}
