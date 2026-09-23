const CACHE_NAME = 'tgroup-v2';

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(['/', '/index.html']))
        .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('tgroup-') && key !== CACHE_NAME)
        .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    // Login, editor assets and API responses must always go to the network.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
        url.pathname === '/admin' || url.pathname.startsWith('/admin/') ||
        url.pathname === '/api' || url.pathname.startsWith('/api/') ||
        event.request.mode !== 'navigate') return;

    // Published edits must replace old pages; use the cache only when offline.
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
        }
        return response;
    }).catch(async error => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        throw error;
    }));
});
