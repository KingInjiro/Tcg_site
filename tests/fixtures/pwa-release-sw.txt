/* TCG_BUILD_CONFIG */
const config = self.TCG_PWA || { version: 'development', urls: ['/', '/themes/offline.html'], aliases: {} };
const CACHE_NAME = 'tgroup-pwa-' + config.version;
const assets = new Set(config.urls);
const appCache = key => key.startsWith('tgroup-pwa-');

async function savedResponse(key) {
    const current = await caches.open(CACHE_NAME), saved = await current.match(key);
    if (saved) return saved;
    // An interrupted background download must not discard the previous offline copy.
    for (const name of (await caches.keys()).filter(name => appCache(name) && name !== CACHE_NAME).reverse()) {
        const old = await (await caches.open(name)).match(key);
        if (old) return old;
    }
}
function cacheable(response) {
    return response.ok && !response.redirected && response.type === 'basic' &&
        !/no-store|private/i.test(response.headers.get('cache-control') || '');
}
async function network(request) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try { return await fetch(request, { cache: 'no-cache', signal: controller.signal }); }
    finally { clearTimeout(timeout); }
}

self.addEventListener('install', event => {
    // One small fallback, not the whole site, gates activation. All other files
    // download after activation, without blocking fresh online pages.
    event.waitUntil((async () => {
        const response = await network('/themes/offline.html').catch(() => null);
        if (response && cacheable(response)) await (await caches.open(CACHE_NAME)).put('/themes/offline.html', response);
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        await self.clients.claim();
        const clients = await self.clients.matchAll({ type: 'window' });
        await Promise.all(clients.map(async client => {
            const url = new URL(client.url);
            if (client.frameType !== 'top-level' || !assets.has(url.pathname)) return;
            const channel = new MessageChannel();
            let acknowledged = false;
            channel.port1.onmessage = () => { acknowledged = true; };
            client.postMessage({ type: 'TCG_UPDATE', version: config.version }, [channel.port2]);
            // Older cached helpers have no update listener. Migrate only known
            // old pages without any form/editable content; never risk their data.
            const saved = await savedResponse(url.pathname);
            const html = saved && await saved.text();
            if (!html || /name=["']tcg-build["']|<form\b|<input\b|<textarea\b|<select\b|contenteditable/i.test(html)) {
                channel.port1.close(); return;
            }
            await new Promise(resolve => setTimeout(resolve, 750));
            channel.port1.close();
            // Do not await navigation here: its fetch waits for activation to end.
            if (!acknowledged) client.navigate(client.url).catch(() => {});
        }));
    })());
});

let warming;
function warmOfflineCache() {
    if (warming) return warming;
    warming = (async () => {
        const cache = await caches.open(CACHE_NAME), queue = [...assets];
        let complete = true;
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (queue.length) {
                const url = queue.shift();
                if (await cache.match(url)) continue;
                try {
                    const response = await network(url);
                    if (!cacheable(response)) { complete = false; continue; }
                    await cache.put(url, response);
                } catch { complete = false; }
            }
        }));
        if (complete) await Promise.all((await caches.keys()).filter(name => appCache(name) && name !== CACHE_NAME).map(name => caches.delete(name)));
    })().finally(() => { warming = null; });
    return warming;
}
self.addEventListener('message', event => {
    if (event.data?.type === 'TCG_WARM_CACHE') event.waitUntil(warmOfflineCache().then(() => {
        event.ports[0]?.postMessage({ type: 'TCG_CACHE_READY', version: config.version });
    }));
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin ||
        /^\/(?:admin|api)(?:\/|$)/i.test(url.pathname) || event.request.headers.has('authorization')) return;
    if (url.pathname === '/site-version.json') {
        event.respondWith(fetch(event.request, { cache: 'no-store' })); return;
    }
    const navigation = event.request.mode === 'navigate' || event.request.headers.get('X-TCG-Navigation') === '1';
    const canonical = config.aliases[url.pathname.toLowerCase()];
    if (navigation && canonical && canonical !== url.pathname) {
        event.respondWith(Promise.resolve(Response.redirect(new URL(canonical + url.search, self.location.origin).href, 302)));
        return;
    }
    const versioned = /^\?v=[a-z0-9-]{1,80}$/i.test(url.search);
    const key = url.pathname, allowed = assets.has(key) && (!url.search || navigation || versioned);
    if (!allowed && !navigation) return;
    event.respondWith((async () => {
        try {
            const response = await network(event.request);
            if (response.status >= 500) {
                const saved = allowed && await savedResponse(key);
                if (saved) return saved;
            }
            if (allowed && (!url.search || versioned) && cacheable(response)) {
                const cache = await caches.open(CACHE_NAME);
                event.waitUntil(cache.put(key, response.clone()).catch(() => {}));
            }
            // A real 404 must not resurrect a page removed from the server.
            return response;
        } catch (error) {
            const saved = allowed && await savedResponse(key);
            if (saved) return saved;
            if (navigation) return await savedResponse('/themes/offline.html') || Response.error();
            throw error;
        }
    })());
});
