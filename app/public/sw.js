// Service worker РЕцепта: приложение открывается без сети и ставится на телефон.
//
// Правила простые и безопасные:
//   • запросы к API никогда не кэшируются — данные всегда свежие;
//   • страница берётся из сети, а при обрыве связи — из кэша;
//   • файлы сборки (/assets/…) лежат в кэше навсегда: их имена содержат хэш.

const CACHE = 'recept-v1';
const OFFLINE_FALLBACK = 'index.html';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([OFFLINE_FALLBACK]).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isApi(url) {
  return url.pathname.includes('/api/') || url.searchParams.has('r');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;                       // данные — только из сети

  // Переходы по страницам: сначала сеть, при обрыве — сохранённая копия.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE);
        cache.put(OFFLINE_FALLBACK, response.clone()).catch(() => {});
        return response;
      } catch {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(OFFLINE_FALLBACK);
        return cached ?? new Response('Нет сети и сохранённой копии', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  // Файлы сборки с хэшем в имени — сразу из кэша.
  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })());
    return;
  }

  // Остальное (картинки, прайс, шаблоны): отдаём из кэша и тихо обновляем.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    }).catch(() => cached);
    return cached ?? network;
  })());
});
