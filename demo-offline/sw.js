// ============================================================
//  SERVICE WORKER  —  el "ayudante" que hace que la página
//  funcione sin internet.
//
//  Idea simple:
//   - Cuando se instala, GUARDA una copia de la página.
//   - Cuando el navegador pide algo, primero mira en la copia
//     guardada. Si está, la entrega (¡sin tocar internet!).
//     Si no está, va a la red.
// ============================================================

const CACHE = 'cuaderno-v1';

// Archivos que queremos que funcionen sin señal
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg'
];

// 1) Instalación: guardamos la copia
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ARCHIVOS))
  );
  self.skipWaiting();
});

// 2) Cada pedido: primero la copia, si no, la red
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((guardado) => {
      return guardado || fetch(e.request);
    })
  );
});
