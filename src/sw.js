/* ═══════════════════════════════════════════════════════════════
   Pixoto — Service Worker
   Network-first strategy: always serve fresh code when online,
   fall back to cache when offline. No more stale-cache pain.
   ═══════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'pixoto-v2.7.1';

const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './canvas-engine.js',
    './pixel-engine.js',
    './layer-styles.js',
    './animation.js',
    './tool-manager.js',
    './history.js',
    './file-manager.js',
    './tools/brush.js',
    './tools/eraser.js',
    './tools/fill.js',
    './tools/eyedropper.js',
    './tools/selection.js',
    './tools/crop.js',
    './tools/pixelate.js',
    './tools/transform.js',
    './tools/text.js',
    './tools/smudge.js',
    './tools/dodge-burn.js',
    './tools/clone-stamp.js',
    './tools/shapes.js',
    './tools/gradient.js',
    './filters/filters.js',
    './filters/filter-worker.js',
    './lib/gif-encoder.js',
    './ui/layers-panel.js',
    './ui/mask-utils.js',
    './ui/color-picker.js',
    './ui/color-utils.js',
    './ui/filter-dialog.js',
    './ui/layer-styles-dialog.js',
    './ui/timeline.js',
    './ui/export-animation.js',
    './ui/guides.js',
    './ui/gradient-editor.js',
    './manifest.json',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

// ─── Install: pre-cache app shell, activate immediately ───
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                return Promise.allSettled(
                    ASSETS_TO_CACHE.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn(`[SW] Failed to cache: ${url}`, err);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ─── Activate: clean up old caches, take control immediately ───
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) =>
                Promise.all(
                    keys
                        .filter((key) => key !== CACHE_NAME)
                        .map((key) => {
                            console.log(`[SW] Deleting old cache: ${key}`);
                            return caches.delete(key);
                        })
                )
            )
            .then(() => self.clients.claim())
    );
});

// ─── Fetch: NETWORK-FIRST — always try fresh, cache as fallback ───
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                // Got a fresh response — update the cache for offline use
                if (
                    networkResponse &&
                    networkResponse.status === 200 &&
                    networkResponse.type === 'basic'
                ) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then((cache) => cache.put(event.request, responseToCache));
                }
                return networkResponse;
            })
            .catch(() => {
                // Network failed — serve from cache (offline mode)
                return caches.match(event.request)
                    .then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;

                        // Navigation requests fall back to cached index.html
                        if (event.request.mode === 'navigate') {
                            return caches.match(new URL('./index.html', self.location).href);
                        }

                        return new Response('Offline', {
                            status: 503,
                            statusText: 'Service Unavailable'
                        });
                    });
            })
    );
});
