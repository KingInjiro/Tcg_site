// Retire the old page cache so published changes cannot be masked by stale HTML.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys
        .filter(key => key.startsWith('tgroup-')).map(key => caches.delete(key))))
        .then(() => self.clients.claim()).then(() => self.registration.unregister()));
});
