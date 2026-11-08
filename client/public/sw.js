// Минимальный service worker: приложение открывается и без сети (оболочка),
// данные (/api) всегда берутся с сервера и не кэшируются.
const CACHE = 'shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? '/' : req)),
  );
});
