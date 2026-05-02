// ============================================================
//  AELA ERP — Service Worker (PWA offline)
//  public/sw.js
//
//  Estrategias:
//    - App shell (HTML/CSS/JS): Cache First
//    - API GET (productos/clientes): Network First con fallback a caché
//    - API POST/PUT/DELETE: Network First; si falla por conexión →
//      guarda en cola IndexedDB (Background Sync)
// ============================================================

const CACHE_APP    = 'aela-app-v3';
const CACHE_API    = 'aela-api-v2';
const SYNC_TAG     = 'aela-sync-queue';

// Archivos del app shell que se cachean en la instalación
const APP_SHELL = [
  '/',
  '/index.html',
];

// Rutas de API que se cachean para uso offline (lectura)
const API_CACHEABLE = [
  '/api/productos',
  '/api/clientes',
];

// ─── Instalación ────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_APP)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ─── Activación ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_APP && k !== CACHE_API)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Helpers ────────────────────────────────────────────────
function esRutaAppShell(url) {
  const { pathname } = new URL(url);
  return !pathname.startsWith('/api/') && !pathname.startsWith('/uploads/');
}

function esAPILectura(url, method) {
  if (method !== 'GET') return false;
  const { pathname } = new URL(url);
  return API_CACHEABLE.some((ruta) => pathname.startsWith(ruta));
}

function esErrorConectividad(err) {
  return err instanceof TypeError && (
    err.message.includes('Failed to fetch') ||
    err.message.includes('NetworkError') ||
    err.message.includes('Load failed')
  );
}

// ─── Intercepción de peticiones ─────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const { method, url } = request;

  // 1. index.html → Network First (siempre la versión más reciente para evitar
  //    que el SW sirva el HTML viejo con referencias a bundles JS obsoletos)
  if (esRutaAppShell(url) && method === 'GET') {
    const isHtml = url.endsWith('/') || url.endsWith('/index.html') || !url.split('/').pop().includes('.');
    if (isHtml) {
      event.respondWith(
        fetch(request)
          .then((resp) => {
            if (resp.ok) {
              caches.open(CACHE_APP).then((c) => c.put(request, resp.clone()));
            }
            return resp;
          })
          .catch(() =>
            caches.match(request).then(
              (cached) => cached || new Response('Offline', { status: 503 })
            )
          )
      );
      return;
    }

    // Assets estáticos (JS/CSS con hash) → Cache First (actualiza en background)
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((resp) => {
            if (resp.ok) {
              caches.open(CACHE_APP).then((c) => c.put(request, resp.clone()));
            }
            return resp;
          })
          .catch(() => cached || new Response('Offline', { status: 503 }));

        return cached || networkFetch;
      })
    );
    return;
  }

  // 2. API lectura cacheables → Network First con fallback
  if (esAPILectura(url, method)) {
    event.respondWith(
      fetch(request.clone())
        .then((resp) => {
          if (resp.ok) {
            caches.open(CACHE_API).then((c) => c.put(request, resp.clone()));
          }
          return resp;
        })
        .catch(() =>
          caches.match(request).then(
            (cached) => cached || new Response(
              JSON.stringify({ ok: false, offline: true, data: [] }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
    );
    return;
  }

  // 3. Resto de API GETs → Network Only (datos sensibles/tiempo real)
  // Las escrituras (POST/PUT/DELETE) las maneja el frontend directamente con offlineDB
});

// ─── Background Sync ─────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(procesarColaSync());
  }
});

async function procesarColaSync() {
  // Notificar a las pestañas abiertas para que procesen su cola IndexedDB
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach((client) => {
    client.postMessage({ type: 'AELA_SYNC_NOW' });
  });
}

// ─── Mensajes desde la app ───────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CACHE_INVALIDATE') {
    const { key } = event.data;
    if (key) {
      caches.open(CACHE_API).then((c) => c.delete(key));
    }
  }
});
