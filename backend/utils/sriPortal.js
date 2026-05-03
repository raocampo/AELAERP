// ============================================================
//  AELA — sriPortal.js
//  Consulta de comprobantes electrónicos recibidos vía la API
//  del portal del SRI (srienlinea.sri.gob.ec).
//
//  Flujo:
//    1. autenticarSriPortal(ruc, password)  → token JWT
//    2. consultarRecibidos(token, params)   → { total, items[] }
//    3. obtenerTodosLosRecibidos(token, ...) → items[] (paginado)
//
//  NOTAS:
//  - Las credenciales del portal SRI NO se persisten.
//  - Los endpoints provienen de la API pública del portal móvil
//    del SRI (app oficial SRI Ecuador).  Si el SRI cambia las rutas
//    actualizar SRI_AUTH_URL / SRI_RECIBIDOS_URL.
// ============================================================

const SRI_PORTAL_BASE  = 'https://srienlinea.sri.gob.ec';
const SRI_AUTH_URL     = `${SRI_PORTAL_BASE}/movil-servicios/api/v2.0/contribuyente/login`;
const SRI_RECIBIDOS_URL = `${SRI_PORTAL_BASE}/movil-servicios/api/v1.0/comprobante/recibidos`;

const TIMEOUT_MS = 30_000;
const LIMIT_POR_PAGINA = 100;

// ─── Fetch con timeout ───────────────────────────────────────
async function _fetch(url, opts = {}) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado al conectar con el portal SRI');
    throw new Error(`No se pudo conectar al portal SRI: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Autenticación ───────────────────────────────────────────

/**
 * Autenticar en el portal SRI con RUC/CI + contraseña.
 * @returns {string} token JWT para llamadas subsiguientes
 */
async function autenticarSriPortal(identificacion, password) {
  let resp;
  try {
    resp = await _fetch(SRI_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept':        'application/json',
        'User-Agent':    'AELA-ERP/1.0',
      },
      body: JSON.stringify({ user: identificacion, password }),
    });
  } catch (err) {
    throw err; // ya viene con mensaje amigable de _fetch
  }

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Credenciales SRI incorrectas. Verifica el RUC/cédula y la clave del portal.');
  }
  if (resp.status === 429) {
    throw new Error('Demasiados intentos. Espera unos minutos antes de volver a intentar.');
  }
  if (!resp.ok) {
    const contentType = resp.headers.get('content-type') || '';
    const txt = await resp.text().catch(() => '');
    // El SRI devuelve HTML cuando el endpoint no existe — evitar mostrar HTML crudo
    if (resp.status === 404 || contentType.includes('text/html') || txt.trim().startsWith('<')) {
      throw new Error(
        'El servicio de consulta automática del portal SRI no está disponible ' +
        `(HTTP ${resp.status}). El SRI no expone una API pública para esta operación. ` +
        'Usa la pestaña "Importar ZIP" para importar comprobantes descargados manualmente desde srienlinea.sri.gob.ec.'
      );
    }
    throw new Error(`Error del portal SRI al autenticar (${resp.status}): ${txt.slice(0, 150)}`);
  }

  const data = await resp.json().catch(() => null);
  if (!data) throw new Error('Respuesta inválida del portal SRI al autenticar');

  // El portal puede devolver el token bajo distintos nombres
  const token =
    data?.token ||
    data?.access_token ||
    data?.accessToken ||
    data?.userToken ||
    data?.tokenAcceso;

  if (!token) {
    throw new Error(
      'El portal SRI no devolvió un token de acceso. ' +
      'Verifica que la cuenta esté activa y que las credenciales sean del portal srienlinea.sri.gob.ec'
    );
  }

  return token;
}

// ─── Consulta paginada ───────────────────────────────────────

/**
 * Consultar una página de comprobantes recibidos.
 * @param {string} token
 * @param {{ ruc, fechaDesde, fechaHasta, tipoComprobante?, offset?, limit? }} params
 *   fechaDesde / fechaHasta en formato 'dd/mm/yyyy'
 * @returns {{ total: number, items: Array }}
 */
async function consultarRecibidos(token, {
  ruc,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
  offset = 0,
  limit  = LIMIT_POR_PAGINA,
} = {}) {
  const qs = new URLSearchParams({
    identificacion:    ruc,
    fechaEmisionDesde: fechaDesde,
    fechaEmisionHasta: fechaHasta,
    tipoComprobante,
    start: String(offset),
    limit: String(limit),
  });

  const resp = await _fetch(`${SRI_RECIBIDOS_URL}?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        'application/json',
      'User-Agent':  'AELA-ERP/1.0',
    },
  });

  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Sesión SRI expirada o sin permisos. Vuelve a ingresar las credenciales.');
  }
  if (!resp.ok) {
    throw new Error(`Error del SRI al consultar comprobantes recibidos (${resp.status})`);
  }

  const data = await resp.json().catch(() => null);
  if (!data) throw new Error('Respuesta inválida del portal SRI al consultar comprobantes');

  // Normalizar estructura — el portal puede devolver distintos formatos
  const rawItems =
    Array.isArray(data)                       ? data :
    Array.isArray(data?.comprobantes)         ? data.comprobantes :
    Array.isArray(data?.data)                 ? data.data :
    Array.isArray(data?.items)                ? data.items :
    Array.isArray(data?.listadoComprobantes)  ? data.listadoComprobantes :
    [];

  const total =
    data?.total               ??
    data?.totalRegistros      ??
    data?.cantidadRegistros   ??
    rawItems.length;

  // Normalizar cada item
  const items = rawItems.map((it) => ({
    claveAcceso: (
      it.claveAcceso || it.clave_acceso || it.claveacceso ||
      it.clave       || it.claveDeAcceso
    )?.replace(/\s/g, '') || null,

    tipoComprobante:
      it.tipoComprobante || it.tipo_comprobante || it.tipo || null,

    rucEmisor:
      it.rucEmisor || it.ruc_emisor || it.rucemisor || it.ruc || null,

    razonSocialEmisor:
      it.razonSocialEmisor || it.razon_social   ||
      it.razonSocial       || it.emisor          || null,

    fechaEmision:
      it.fechaEmision || it.fecha_emision || it.fecha || null,

    importeTotal:
      Number(it.importeTotal || it.importe_total || it.total || it.valor || 0),

    estado:
      it.estado || it.estadoInterno || null,

    numeroComprobante:
      it.numeroComprobante || it.numero || it.num_comprobante || null,
  })).filter((it) => it.claveAcceso && it.claveAcceso.length === 49);

  return { total: Number(total), items };
}

// ─── Paginación completa ─────────────────────────────────────

/**
 * Obtener TODOS los comprobantes recibidos en el rango dado,
 * recorriendo todas las páginas automáticamente.
 * @returns {Array<{ claveAcceso, tipoComprobante, ... }>}
 */
async function obtenerTodosLosRecibidos(token, {
  ruc,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  const todos  = [];
  let   offset = 0;

  for (let pagina = 0; pagina < 20; pagina++) { // máx 2 000 docs (20 * 100)
    const { total, items } = await consultarRecibidos(token, {
      ruc, fechaDesde, fechaHasta, tipoComprobante,
      offset, limit: LIMIT_POR_PAGINA,
    });

    todos.push(...items);
    offset += items.length;

    if (offset >= total || items.length === 0) break;
  }

  return todos;
}

// ─── Helper: convertir yyyy-mm-dd → dd/mm/yyyy ──────────────
function isoAFormatoSri(fechaIso) {
  if (!fechaIso) return null;
  const [y, m, d] = String(fechaIso).split('-');
  if (!y || !m || !d) return fechaIso;
  return `${d}/${m}/${y}`;
}

module.exports = {
  autenticarSriPortal,
  consultarRecibidos,
  obtenerTodosLosRecibidos,
  isoAFormatoSri,
};
