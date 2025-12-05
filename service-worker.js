const CACHE_NAME = 'flybondi-scanner-v1';
const ASSETS = [
  '.',                // start_url
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'sounds/beep_ok.wav',
  'sounds/beep_err.wav',
  'manifest.json'
];

// Instalar: precache de recursos básicos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar: limpiar caches viejos
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch: estrategia cache-first para GET
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req).catch(() => {
          // Podrías devolver una página offline custom acá si querés
          return cached;
        })
      );
    })
  );
});
