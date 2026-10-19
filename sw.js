// Keep this URL permanently: previously installed TCG workers update from it.
// This retirement worker has no fetch handler and never creates a cache.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await self.clients.claim();
        try {
            await Promise.all((await caches.keys()).filter(name => name.startsWith('tgroup-pwa-'))
                .map(name => caches.delete(name)));
        } finally {
            await self.registration.unregister();
            for (const client of await self.clients.matchAll({ type: 'window' })) {
                // A worker cannot inspect an unsaved form. The current online
                // helper refreshes only when safe; older pages on navigation.
                client.postMessage({ type: 'TCG_PWA_RETIRED' });
                client.postMessage({ type: 'TCG_UPDATE' });
            }
        }
    })());
});
