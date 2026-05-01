// ============================================================
//  AELA — offlineDB.js
//  Wrapper de IndexedDB para operaciones offline.
//
//  Stores:
//    pending_ops   — Operaciones pendientes de sincronizar
//    cache_data    — Datos cacheados (productos, clientes, etc.)
// ============================================================

const DB_NAME    = 'aela_offline';
const DB_VERSION = 1;

let _db = null;

function abrirDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Cola de operaciones pendientes
      if (!db.objectStoreNames.contains('pending_ops')) {
        const store = db.createObjectStore('pending_ops', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('by_timestamp', 'timestamp');
        store.createIndex('by_entidad', 'entidad');
      }

      // Caché de datos de referencia
      if (!db.objectStoreNames.contains('cache_data')) {
        const store = db.createObjectStore('cache_data', { keyPath: 'clave' });
        store.createIndex('by_expires', 'expires');
      }
    };

    req.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

// ─── pending_ops ────────────────────────────────────────────

/**
 * Encolar una operación para cuando vuelva la conexión.
 * @param {Object} op - { entidad, method, url, body, descripcion }
 */
export async function encolarOperacion(op) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_ops', 'readwrite');
    const store = tx.objectStore('pending_ops');
    const registro = {
      ...op,
      timestamp: Date.now(),
      intentos:  0,
      estado:    'pendiente',
    };
    const req = store.add(registro);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Obtener todas las operaciones pendientes, ordenadas por timestamp */
export async function obtenerOperacionesPendientes() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_ops', 'readonly');
    const store = tx.objectStore('pending_ops');
    const idx   = store.index('by_timestamp');
    const req   = idx.getAll();
    req.onsuccess = () => resolve(req.result.filter((op) => op.estado === 'pendiente'));
    req.onerror   = () => reject(req.error);
  });
}

/** Marcar operación como sincronizada (eliminar) */
export async function eliminarOperacion(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_ops', 'readwrite');
    const store = tx.objectStore('pending_ops');
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Marcar operación con error (incrementar intentos) */
export async function marcarError(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_ops', 'readwrite');
    const store = tx.objectStore('pending_ops');
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const op = getReq.result;
      if (!op) { resolve(); return; }
      op.intentos += 1;
      if (op.intentos >= 5) op.estado = 'fallido';
      const putReq = store.put(op);
      putReq.onsuccess = () => resolve();
      putReq.onerror   = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Contar operaciones pendientes */
export async function contarPendientes() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('pending_ops', 'readonly');
    const store = tx.objectStore('pending_ops');
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ─── cache_data ─────────────────────────────────────────────

/** Guardar datos en caché con TTL en segundos */
export async function guardarEnCache(clave, datos, ttlSegundos = 3600) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('cache_data', 'readwrite');
    const store = tx.objectStore('cache_data');
    const req = store.put({
      clave,
      datos,
      guardadoEn: Date.now(),
      expires:    Date.now() + ttlSegundos * 1000,
    });
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

/** Leer de caché (retorna null si expiró o no existe) */
export async function leerDeCache(clave) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('cache_data', 'readonly');
    const store = tx.objectStore('cache_data');
    const req   = store.get(clave);
    req.onsuccess = () => {
      const entry = req.result;
      if (!entry || Date.now() > entry.expires) {
        resolve(null);
      } else {
        resolve(entry.datos);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** Limpiar entradas expiradas */
export async function limpiarCacheExpirado() {
  const db = await abrirDB();
  return new Promise((resolve) => {
    const tx    = db.transaction('cache_data', 'readwrite');
    const store = tx.objectStore('cache_data');
    const idx   = store.index('by_expires');
    const range = IDBKeyRange.upperBound(Date.now());
    idx.openCursor(range).onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
  });
}
