// ============================================================
//  SERVICE WORKER — área /campo/  (mismo principio que la demo)
//
//  - App (HTML/JS/iconos): primero la copia guardada (abre sin señal).
//  - Datos /api/ : primero la red (queremos lo más fresco); si no
//    hay señal, la última copia guardada.
//  - El envío de capturas (POST) NO se cachea: lo maneja la cola
//    de la app, que reintenta sola cuando vuelve la conexión.
// ============================================================

const CACHE = 'campo-v1';
const SHELL = ['./', './index.html', './app.js', './manifest.json', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // Borra cachés viejas si subimos una versión nueva (campo-v2, etc.)
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Datos: red primero, copia como respaldo (solo GET).
  if (url.pathname.startsWith('/api/')) {
    if (e.request.method !== 'GET') return;          // POST: lo maneja la cola
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // App: copia primero, red si no está.
  e.respondWith(caches.match(e.request).then((g) => g || fetch(e.request)));
});
