// ============================================================
//  AELA — syncQueue.js
//  Gestor de cola de sincronización offline.
//
//  Flujo:
//    1. App llama apiOffline() en lugar de fetch() directamente
//    2. Si hay red → request normal
//    3. Si no hay red → guarda en IndexedDB y retorna respuesta optimista
//    4. Cuando vuelve la red (evento 'online' o mensaje SW) →
//       procesarCola() envía todo lo acumulado al backend
// ============================================================

import {
  encolarOperacion,
  obtenerOperacionesPendientes,
  eliminarOperacion,
  marcarError,
  contarPendientes,
  guardarEnCache,
  leerDeCache,
} from './offlineDB';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';

// ─── Estado de conectividad ─────────────────────────────────
let _estaOnline = navigator.onLine;
let _listeners  = [];

window.addEventListener('online',  () => { _estaOnline = true;  notificarCambio(); procesarCola(); });
window.addEventListener('offline', () => { _estaOnline = false; notificarCambio(); });

function notificarCambio() {
  _listeners.forEach((fn) => fn(_estaOnline));
}

/** Suscribirse a cambios de conectividad */
export function onConectividadChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((l) => l !== fn); };
}

export function estaOnline() {
  return _estaOnline;
}

// ─── Fetch con fallback offline ─────────────────────────────

/**
 * Versión offline-aware de fetch para operaciones de escritura.
 *
 * @param {string} url - URL relativa a API_BASE (ej: '/facturas') o absoluta
 * @param {Object} opciones - { method, body, entidad, descripcion, respuestaOptimista }
 * @returns {Promise<{ok, data, offline, pendienteId}>}
 */
export async function apiOffline(url, {
  method = 'POST',
  body   = null,
  entidad = 'general',
  descripcion = '',
  respuestaOptimista = null,
} = {}) {
  const urlCompleta = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const token = localStorage.getItem('aela_token') || localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  // Si hay conexión → petición normal
  if (_estaOnline) {
    try {
      const resp = await fetch(urlCompleta, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await resp.json().catch(() => ({}));
      return { ok: resp.ok, data, offline: false };
    } catch {
      // Error de red inesperado: volver a modo offline
      _estaOnline = false;
      notificarCambio();
    }
  }

  // Sin conexión → encolar
  const pendienteId = await encolarOperacion({
    url: urlCompleta,
    method,
    body,
    headers: { 'Content-Type': 'application/json', Authorization: headers.Authorization },
    entidad,
    descripcion,
  });

  // Registrar para Background Sync si el navegador lo soporta
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg) => reg.sync.register('aela-sync-queue'))
      .catch(() => {});
  }

  return {
    ok:           true,
    data:         respuestaOptimista || { offline: true, pendienteId },
    offline:      true,
    pendienteId,
  };
}

// ─── Fetch normal con caché de lectura ──────────────────────

/**
 * GET con caché offline. Si no hay red, usa datos cacheados.
 * @param {string} url - URL relativa
 * @param {Object} cacheOpts - { clave, ttl } — si se omite, no cachea
 */
export async function apiGet(url, { clave = null, ttl = 300 } = {}) {
  const urlCompleta = url.startsWith('http') ? url : `${API_BASE}${url}`;
  const token = localStorage.getItem('aela_token') || localStorage.getItem('token');

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  try {
    const resp = await fetch(urlCompleta, { headers });
    if (!resp.ok) return { ok: false, data: null };
    const data = await resp.json();
    if (clave) await guardarEnCache(clave, data, ttl);
    return { ok: true, data, offline: false };
  } catch {
    // Sin conexión → intentar caché
    if (clave) {
      const cached = await leerDeCache(clave);
      if (cached) return { ok: true, data: cached, offline: true, cached: true };
    }
    return { ok: false, data: null, offline: true };
  }
}

// ─── Procesamiento de cola ───────────────────────────────────

let _procesando = false;

export async function procesarCola() {
  if (_procesando || !_estaOnline) return;
  _procesando = true;

  try {
    const ops = await obtenerOperacionesPendientes();
    if (ops.length === 0) return;

    console.log(`[SyncQueue] Procesando ${ops.length} operaciones pendientes...`);

    for (const op of ops) {
      try {
        const resp = await fetch(op.url, {
          method:  op.method,
          headers: op.headers,
          body:    op.body ? JSON.stringify(op.body) : undefined,
        });

        if (resp.ok || resp.status === 409) {
          // 409 Conflict = ya existe (idempotente) — considerar como OK
          await eliminarOperacion(op.id);
          console.log(`[SyncQueue] ✓ Op #${op.id} (${op.entidad}) sincronizada`);
        } else {
          // Error del servidor (400, 422, etc.) → no reintentar
          await marcarError(op.id);
          console.warn(`[SyncQueue] ✗ Op #${op.id} error ${resp.status}`);
        }
      } catch {
        // Error de red → quedó sin internet de nuevo, parar
        _estaOnline = false;
        notificarCambio();
        break;
      }
    }

    // Notificar a los componentes del resultado
    window.dispatchEvent(new CustomEvent('aela:sync-complete', {
      detail: { procesadas: ops.length },
    }));

  } finally {
    _procesando = false;
  }
}

/** Cuántos registros hay pendientes de sync */
export async function pendientesLocales() {
  return contarPendientes();
}

// ─── Escuchar mensajes del Service Worker ───────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'AELA_SYNC_NOW') {
      procesarCola();
    }
  });
}

// ─── Registrar Service Worker ────────────────────────────────
export async function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('[SW] Registrado:', reg.scope);

    // Cuando hay una nueva versión disponible, activarla inmediatamente
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed') {
          // Activar el nuevo SW de inmediato (descarta el viejo)
          newWorker.postMessage({ type: 'SKIP_WAITING' });
          if (navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('aela:sw-update'));
          }
        }
      });
    });
  } catch (err) {
    console.warn('[SW] No se pudo registrar:', err.message);
  }
}
