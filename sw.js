const CACHE_NAME = 'rakuraku-einou-pwa-v8';
// 航空写真タイル専用キャッシュ（上限件数を超えたら古い順に削除して肥大化を防ぐ）
const TILE_CACHE_NAME = 'rakuraku-einou-tiles-v1';
const TILE_CACHE_MAX_ENTRIES = 600;
const TILE_HOST = 'cyberjapandata.gsi.go.jp';

// 同一オリジンの必須ファイル（1つでも失敗したらインストール失敗にする）
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/data.js',
  './js/app.js'
];
// 外部CDN（取得失敗してもインストール自体は継続する）
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(LOCAL_ASSETS);
      await Promise.all(
        CDN_ASSETS.map((url) =>
          fetch(url, { mode: 'no-cors' })
            .then((res) => cache.put(url, res))
            .catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, TILE_CACHE_NAME]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => (keep.has(key) ? null : caches.delete(key))))
    )
  );
  self.clients.claim();
});

async function trimTileCache_() {
  const cache = await caches.open(TILE_CACHE_NAME);
  const keys = await cache.keys();
  const overflow = keys.length - TILE_CACHE_MAX_ENTRIES;
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i]); // keys() は追加順のため先頭が最も古い
  }
}

// 航空写真タイル：ネットワーク優先・失敗時（圏外）はキャッシュから表示
async function handleTileRequest_(request) {
  const cache = await caches.open(TILE_CACHE_NAME);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await cache.put(request, res.clone());
      trimTileCache_();
    }
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    return cached || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  // GAS への POST 同期などはキャッシュ対象外
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.hostname === TILE_HOST) {
    event.respondWith(handleTileRequest_(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse)
      );
    })
  );
});
