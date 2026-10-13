/* TCG_BUILD_CONFIG */
const config = self.TCG_PWA || { version: 'development', urls: ['/', '/themes/offline.html'], aliases: {} };
const CACHE_NAME = 'tgroup-pwa-' + config.version;
const assets = new Set(config.urls);

self.addEventListener('install', event => {
    // Activate only after the entire new snapshot is ready. Open tabs keep their
    // document and form values; their next navigation can use the new build.
    event.waitUntil(caches.open(CACHE_NAME)
        .then(cache => cache.addAll(config.urls.map(url => new Request(url, { cache: 'reload' }))))
        .then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('tgroup-') && key !== CACHE_NAME)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
        /^\/(?:admin|api)(?:\/|$)/i.test(url.pathname) || event.request.headers.has('authorization')) return;
    const navigation = event.request.mode === 'navigate' || event.request.headers.get('X-TCG-Navigation') === '1';
    const canonical = config.aliases[url.pathname.toLowerCase()];
    if (navigation && canonical && canonical !== url.pathname) {
        event.respondWith(Promise.resolve(Response.redirect(new URL(canonical + url.search, self.location.origin).href, 302)));
        return;
    }
    const key = url.pathname, allowed = assets.has(key) && (!url.search || navigation);
    if (!allowed && !navigation) return;
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        // Public pages and assets are a versioned build snapshot. Do not wait for
        // the network on every click; a new worker installs the next snapshot.
        const saved = allowed && await cache.match(key);
        if (saved) return saved;
        try {
            const response = await fetch(event.request);
            // Cache known public resources only; never APIs, form data or query strings.
            if (allowed && !url.search && response.ok && !response.redirected && response.type === 'basic' &&
                !/no-store|private/i.test(response.headers.get('cache-control') || '')) {
                event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
            }
            return response;
        } catch (error) {
            if (navigation) return await cache.match('/themes/offline.html') || Response.error();
            throw error;
        }
    })());
});
