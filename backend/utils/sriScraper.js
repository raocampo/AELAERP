// ============================================================
//  AELA — sriScraper.js
//
//  ESTRATEGIA ACTUAL (2026-06-20):
//    1. Keycloak ROPC fetch (preferido, sin Puppeteer)
//       - sriLoginKeycloak(ruc, password)      → { token, expiresAt }
//       - sriGetComprobantesRecibidos(token)   → items[] (TBD: URL pendiente)
//    2. Puppeteer legacy (fallback)
//       - scraperSriLogin / scraperSriRecibidos
//
//  Datos confirmados del JWT (2026-06-20):
//    Auth:      https://srienlinea.sri.gob.ec/auth/realms/Internet
//    client_id: app-sri-claves-angular
//    TTL token: 300 s
//    Endpoint obligaciones/vigentes:
//      https://srienlinea.sri.gob.ec/sri-obligacion-beneficio-servicio-internet/
//      rest/privado/obligaciones/tributarias/vigentes
//
//  Pendiente: URL de comprobantes recibidos. El usuario debe navegar a la
//  sección "Comprobantes Electrónicos → Recibidos" del portal SRI y capturar
//  la request en DevTools → Network → Fetch/XHR.
// ============================================================

const puppeteer  = require('puppeteer');
const nodePath   = require('path');
const { execSync } = require('child_process');

const SRI_BASE = 'https://srienlinea.sri.gob.ec';

// ═══════════════════════════════════════════════════════════════
//  BLOQUE 1 — SCRAPER FETCH+JSF (sin Puppeteer)
//
//  Flujo confirmado 2026-06-20:
//    1. GET /comprobantes-electronicos-internet/.../comprobantesRecibidos.jsf
//       → 302 a Keycloak login (realm Internet)
//    2. GET Keycloak auth page → 200 con form HTML
//    3. POST credenciales → 302 de vuelta a la app → cookies con JSESSIONID
//    4. GET página JSF → extraer ViewState + nombres de campos dinámicos
//    5. POST JSF AJAX (faces-request: partial/ajax) → XML con tabla de resultados
//    6. Parsear XML → extraer claves de acceso
// ═══════════════════════════════════════════════════════════════

const SRI_JSF_URL =
  `${SRI_BASE}/comprobantes-electronicos-internet/pages/consultas/recibidos/comprobantesRecibidos.jsf`;

// Headers que imitan un navegador real (necesarios para que el portal no rechace)
const _HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept-Language': 'es-EC,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
};

// ─── Cookie jar helpers ───────────────────────────────────────
function _parsearSetCookie(headers) {
  // getSetCookie() disponible en Node 20+; fallback para Node 18
  let values = [];
  if (typeof headers.getSetCookie === 'function') {
    values = headers.getSetCookie();
  } else {
    const raw = headers.get('set-cookie');
    if (raw) values = [raw];
  }
  const jar = {};
  for (const h of values) {
    if (!h) continue;
    const eq = h.indexOf('=');
    const sc = h.indexOf(';');
    if (eq < 0) continue;
    const name  = h.substring(0, eq).trim();
    const value = h.substring(eq + 1, sc > eq ? sc : undefined).trim();
    if (name) jar[name] = value;
  }
  return jar;
}

function _cookieStr(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function _resolverUrl(url, base) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return new URL(url, base).toString();
}

// ─── Paso 1: login via Keycloak redirect chain ───────────────
async function _loginJSFFetch(ruc, password) {
  const jar = {};
  const T   = 25_000;

  // 1a. GET la página JSF → debe redirigir a Keycloak
  const r1 = await fetch(SRI_JSF_URL, {
    redirect: 'manual',
    headers:  { ..._HEADERS, 'Accept': 'text/html,application/xhtml+xml,*/*' },
    signal:   AbortSignal.timeout(T),
  });
  Object.assign(jar, _parsearSetCookie(r1.headers));

  if (r1.status === 200) {
    // Podría devolver 200 si el servidor tiene un bypass o ya está autenticado
    const html = await r1.text();
    if (html.includes('javax.faces.ViewState')) return { jar, paginaJSF: html };
  }
  if (r1.status !== 302 && r1.status !== 301) {
    throw new Error(`El portal SRI respondió ${r1.status} al acceder al formulario de comprobantes`);
  }

  const keycloakAuthUrl = _resolverUrl(r1.headers.get('location'), SRI_BASE);
  if (!keycloakAuthUrl) {
    throw new Error('El portal SRI no proporcionó URL de autenticación');
  }

  // 1b. GET la página de login de Keycloak
  const r2 = await fetch(keycloakAuthUrl, {
    redirect: 'manual',
    headers:  { ..._HEADERS, 'Accept': 'text/html', 'Cookie': _cookieStr(jar) },
    signal:   AbortSignal.timeout(T),
  });
  Object.assign(jar, _parsearSetCookie(r2.headers));

  if (r2.status === 302 || r2.status === 301) {
    // Keycloak redirige directamente (sesión SSO activa?) — seguir
    const nextUrl = _resolverUrl(r2.headers.get('location'), SRI_BASE);
    if (nextUrl) return _seguirRedirects(nextUrl, jar, T, null);
  }
  if (r2.status !== 200) {
    throw new Error(`Keycloak devolvió ${r2.status} al cargar el formulario de login del SRI`);
  }

  const loginHtml = await r2.text();

  // Extraer action URL del formulario (<form ... action="...">)
  const actionMatch = loginHtml.match(/<form[^>]+action="([^"]+)"/i);
  if (!actionMatch) {
    throw new Error('No se encontró el formulario de login en el portal SRI (Keycloak)');
  }
  const loginActionUrl = _resolverUrl(
    actionMatch[1].replace(/&amp;/g, '&'),
    keycloakAuthUrl
  );

  // 1c. POST credenciales
  const r3 = await fetch(loginActionUrl, {
    method:   'POST',
    redirect: 'manual',
    headers:  {
      ..._HEADERS,
      'Accept':        'text/html',
      'Content-Type':  'application/x-www-form-urlencoded',
      'Cookie':        _cookieStr(jar),
      'Referer':       keycloakAuthUrl,
      'Origin':        SRI_BASE,
    },
    body:   new URLSearchParams({ username: ruc, password, credentialId: '' }).toString(),
    signal: AbortSignal.timeout(T),
  });
  Object.assign(jar, _parsearSetCookie(r3.headers));

  if (r3.status === 200) {
    // Login fallido → Keycloak vuelve a mostrar el form con mensaje de error
    const errHtml = await r3.text();
    const errMatch = errHtml.match(/class="[^"]*kc-feedback-text[^"]*"[^>]*>([\s\S]*?)<\/\w+>/i)
                  || errHtml.match(/id="input-error[^"]*"[^>]*>([\s\S]*?)<\/\w+>/i)
                  || errHtml.match(/alert-error[^>]*>([\s\S]*?)<\/\w+>/i);
    const msgErr = errMatch
      ? errMatch[1].replace(/<[^>]+>/g, '').trim()
      : 'RUC o contraseña incorrectos';
    throw new Error(`Credenciales del portal SRI incorrectas: ${msgErr}`);
  }
  if (r3.status !== 302 && r3.status !== 301) {
    throw new Error(`Error al enviar credenciales al portal SRI (${r3.status})`);
  }

  const appCallbackUrl = _resolverUrl(r3.headers.get('location'), SRI_BASE);
  return _seguirRedirects(appCallbackUrl, jar, T, null);
}

// ─── Seguir redirects hasta obtener JSESSIONID + HTML JSF ────
async function _seguirRedirects(url, jar, timeout, paginaJSF) {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(url, {
      redirect: 'manual',
      headers:  { ..._HEADERS, 'Accept': 'text/html', 'Cookie': _cookieStr(jar) },
      signal:   AbortSignal.timeout(timeout),
    });
    Object.assign(jar, _parsearSetCookie(r.headers));

    if (r.status === 302 || r.status === 301) {
      url = _resolverUrl(r.headers.get('location'), SRI_BASE);
      if (!url) break;
      continue;
    }
    if (r.status === 200) {
      const html = await r.text();
      if (html.includes('javax.faces.ViewState')) {
        return { jar, paginaJSF: html };
      }
      paginaJSF = html; // guardar aunque no tenga ViewState aún
      // Puede que haya redirigido a otra página intermedia — seguir si hay redirect en HTML
      const metaMatch = html.match(/<meta[^>]+http-equiv="refresh"[^>]+content="[^"]*url=([^"]+)"/i);
      if (metaMatch) {
        url = _resolverUrl(metaMatch[1], SRI_BASE);
        continue;
      }
      break;
    }
    break;
  }

  if (!jar.JSESSIONID) {
    // Buscar JSESSIONID en la URL si no vino como cookie (algunos servidores JSF lo meten en la URL)
    const jsInUrl = url && url.match(/jsessionid=([A-Z0-9._-]+)/i);
    if (jsInUrl) jar.JSESSIONID = jsInUrl[1];
  }

  if (!jar.JSESSIONID) {
    throw new Error(
      'No se pudo establecer sesión con el portal de comprobantes SRI. ' +
      'Verifica que las credenciales sean correctas y que el portal esté disponible.'
    );
  }

  return { jar, paginaJSF };
}

// ─── Paso 2: GET página JSF (si no la tenemos del login) ──────
async function _obtenerPaginaJSF(jar) {
  const r = await fetch(SRI_JSF_URL, {
    headers: { ..._HEADERS, 'Accept': 'text/html', 'Cookie': _cookieStr(jar) },
    signal:  AbortSignal.timeout(20_000),
  });
  Object.assign(jar, _parsearSetCookie(r.headers));
  if (!r.ok) throw new Error(`Error cargando el formulario del SRI (${r.status})`);
  return r.text();
}

// ─── Paso 3: Extraer campos del formulario JSF desde HTML ────
function _extraerCamposJSF(html) {
  const vsMatch = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)
                || html.match(/id="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
  if (!vsMatch) throw new Error('No se pudo leer el estado del formulario JSF (ViewState ausente)');
  const viewState = vsMatch[1];

  // Extraer el ID del form principal
  const formMatch = html.match(/<form[^>]+id="([^"]+)"/i);
  const formId    = formMatch ? formMatch[1] : '';

  // Helper para extraer el primer `name` que coincida con algún patrón
  const campo = (...pats) => {
    for (const p of pats) {
      const m = html.match(p);
      if (m) return m[1];
    }
    return null;
  };

  const fieldTipoIdent = campo(
    /name="([^"]*tipoIdentificacion[^"]*)"/i,
    /name="([^"]*tipo[_-]?ident[^"]*)"/i,
  );
  const fieldIdent = campo(
    /name="([^"]*:identificacion)"/i,
    /name="([^"]*identificacion[^"]*)"\s+(?:type="text"|class=)/i,
  );
  const fieldAnio = campo(
    /name="([^"]*[Aa]n[ií]o[^"]*)"[^>]*>[^<]{0,50}<option/,
    /name="([^"]*[Aa]ni[oo][^"]*)"/i,
    /id="([^"]*[Aa]ni[oo][^"]*)"/i,
  );
  const fieldMes = campo(
    /name="([^"]*[Mm]es[^"]*)"[^>]*>[^<]{0,50}<option/,
    /name="([^"]*[Mm]es[^"]*)"/i,
  );
  const fieldTipoComp = campo(
    /name="([^"]*tipo[^"]*)"[^>]*>[^<]{0,200}<option[^>]*value="01"/,
    /name="([^"]*[Tt]ipo[Cc]omprobante[^"]*)"/i,
  );
  const fieldBtn = campo(
    /name="([^"]*[Cc]onsultar[^"]*)"[^>]*(?:type="submit"|value="[Cc]onsultar")/i,
    /id="([^"]*[Cc]onsultar[^"]*)"/i,
    /id="([^"]*[Bb]tn[^"]*)"/i,
    /name="([^"]*[Bb]tn[^"]*)"/i,
  );

  return { viewState, formId, fieldTipoIdent, fieldIdent, fieldAnio, fieldMes, fieldTipoComp, fieldBtn };
}

// ─── Paso 4: POST JSF AJAX ───────────────────────────────────
async function _postJSF(jar, campos, { ruc, anio, mes, tipoComprobante }) {
  const { viewState, formId, fieldTipoIdent, fieldIdent, fieldAnio, fieldMes, fieldTipoComp, fieldBtn } = campos;

  if (!fieldBtn || !viewState) {
    throw new Error('No se pudieron identificar los campos del formulario JSF del SRI');
  }

  const p = new URLSearchParams();
  p.append('javax.faces.partial.ajax',   'true');
  p.append('javax.faces.source',         fieldBtn);
  p.append('javax.faces.partial.execute', '@all');
  p.append('javax.faces.partial.render',  '@all');
  p.append(fieldBtn, fieldBtn);
  if (formId)         p.append(formId, formId);
  if (fieldTipoIdent) p.append(fieldTipoIdent, 'R');         // R = RUC/Cédula
  if (fieldIdent)     p.append(fieldIdent, ruc);
  if (fieldAnio)      p.append(fieldAnio, String(anio));
  if (fieldMes)       p.append(fieldMes,  String(mes));
  if (fieldTipoComp && tipoComprobante && tipoComprobante !== 'TODOS') {
    p.append(fieldTipoComp, tipoComprobante);
  }
  p.append('javax.faces.ViewState', viewState);

  const r = await fetch(SRI_JSF_URL, {
    method:  'POST',
    headers: {
      ..._HEADERS,
      'Cookie':        _cookieStr(jar),
      'Content-Type':  'application/x-www-form-urlencoded; charset=UTF-8',
      'Faces-Request': 'partial/ajax',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept':        'application/xml, text/xml, */*; q=0.01',
      'Origin':        SRI_BASE,
      'Referer':       SRI_JSF_URL,
    },
    body:   p.toString(),
    signal: AbortSignal.timeout(30_000),
  });
  Object.assign(jar, _parsearSetCookie(r.headers));

  if (!r.ok) throw new Error(`Error consultando el portal SRI (${r.status}): ${r.statusText}`);
  return r.text();
}

// ─── Paso 5: Parsear XML de respuesta JSF ───────────────────
function _parsearXmlJSF(xml) {
  const items = [];
  const cdataRe = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let cdataMatch;

  while ((cdataMatch = cdataRe.exec(xml)) !== null) {
    const html = cdataMatch[1];
    const rowRe  = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;

    while ((rowMatch = rowRe.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const celdas  = [];
      const cellRe  = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let cellMatch;

      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        celdas.push(
          cellMatch[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
            .trim().replace(/\s+/g, ' ')
        );
      }
      if (celdas.length < 2) continue;

      // Buscar clave de acceso de 49 dígitos en las celdas
      let claveAcceso = null;
      for (const c of celdas) {
        if (/^\d{49}$/.test(c.replace(/\s/g, ''))) { claveAcceso = c.replace(/\s/g, ''); break; }
      }
      // También buscar en hrefs de la fila
      if (!claveAcceso) {
        const hrefM = rowHtml.match(/claveAcceso[=:](\d{49})/i);
        if (hrefM) claveAcceso = hrefM[1];
      }
      if (!claveAcceso) continue;

      const fechaCell = celdas.find((c) => /\d{2}\/\d{2}\/\d{4}/.test(c));
      const totalCell = celdas.find((c) => /^\$?\s*\d[\d.,]*$/.test(c.trim()));
      const razonCell = celdas.find((c) =>
        c.length > 3 && !/^\d+$/.test(c) && c !== claveAcceso &&
        !/^\d{2}\/\d{2}\/\d{4}$/.test(c) && !/^\$?\s*\d[\d.,]*$/.test(c.trim())
      );

      items.push({
        claveAcceso,
        razonSocialEmisor: razonCell  || '',
        fechaEmision:      fechaCell  || '',
        importeTotal:      totalCell  ? parseFloat(totalCell.replace(/[$, ]/g, '')) || 0 : 0,
      });
    }
  }

  // Loguear si el SRI devolvió un mensaje (sin resultados o error)
  if (items.length === 0) {
    const msgMatch = xml.match(/<update[^>]*>\s*<!\[CDATA\[([\s\S]{0,400})\]\]>/i);
    if (msgMatch) {
      const msg = msgMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (msg) console.log('[SRI JSF] Mensaje del portal:', msg.substring(0, 200));
    }
  }

  return items;
}

// ─── Función principal fetch-based ──────────────────────────
async function obtenerRecibidosFetch({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  if (!identificacion || !password) {
    throw new Error('Se requiere identificación y contraseña del portal SRI');
  }

  const fDesde = _normalizarFecha(fechaDesde);
  const fHasta = _normalizarFecha(fechaHasta);
  const meses  = _mesesEnRango(fDesde, fHasta);

  // 1. Login
  let jar, paginaJSF;
  try {
    ({ jar, paginaJSF } = await _loginJSFFetch(identificacion, password));
  } catch (err) {
    throw err;
  }

  // 2. Obtener ViewState (del HTML del login si ya lo tenemos, o haciendo GET)
  const html   = paginaJSF || await _obtenerPaginaJSF(jar);
  let campos   = _extraerCamposJSF(html);

  const todosPorDuplicar = [];

  // 3. Consultar cada mes del rango
  for (const { anio, mes } of meses) {
    const xml   = await _postJSF(jar, campos, { ruc: identificacion, anio, mes, tipoComprobante });
    const items = _parsearXmlJSF(xml);
    todosPorDuplicar.push(...items);

    // Refrescar ViewState para la siguiente consulta
    if (meses.length > 1) {
      try {
        const freshHtml = await _obtenerPaginaJSF(jar);
        campos = _extraerCamposJSF(freshHtml);
      } catch { /* continuar con campos anteriores */ }
    }
  }

  return _deduplicar(todosPorDuplicar);
}

// Alias de compatibilidad (por si se importa directamente)
const sriLoginKeycloak = async () => {
  throw new Error('sriLoginKeycloak ya no se usa; usa obtenerRecibidosFetch()');
};
const sriGetComprobantesRecibidos = async () => {
  throw new Error('sriGetComprobantesRecibidos ya no se usa; usa obtenerRecibidosFetch()');
};

// ═══════════════════════════════════════════════════════════════
//  BLOQUE 2 — LEGACY PUPPETEER (mantenido como referencia)
// ═══════════════════════════════════════════════════════════════

// ── URLs confirmadas del portal SRI (JSF, vigente al 2026-06-02) ─
const SRI_LOGIN_URL     = `${SRI_BASE}/`;                 // redirige al login JSF si no autenticado
const SRI_LOGIN_URL_ALT = `${SRI_BASE}/sri-en-linea/`;   // home del portal
const SRI_LOGIN_JSF     = `${SRI_BASE}/sri-en-linea/SriLoginInternet/ConsultaRucActionInternet/AgregarServicio`;

// URL real de comprobantes recibidos (confirmada 2026-06-02)
const SRI_RECIBIDOS_URL = `${SRI_BASE}/comprobantes-electronicos-internet/pages/consultas/menu.jsf`;

const TIMEOUT_NAV  = 20_000;   // reducido de 40s: falla más rápido si el portal no responde
const TIMEOUT_SEL  = 12_000;
const MAX_PAGINAS  = 30;   // máx 3 000 docs (30 páginas × 100)

// ── Detectar si la URL es la página de login ─────────────────
function _esUrlLogin(url) {
  return url.includes('/auth/login') ||
         url.includes('SriLoginInternet') ||
         url.includes('AgregarServicio') ||
         url.includes('/login');
}

// ── Detectar si el login fue exitoso ─────────────────────────
// Se agrega el patrón de la URL de comprobantes y del home JSF
function _esUrlAutenticada(url) {
  return url.includes('/contribuyente/') ||
         url.includes('/sri-en-linea/home') ||
         url.includes('/sri-en-linea/inicio') ||
         url.includes('/comprobantes/') ||
         url.includes('/comprobantes-electronicos-internet/') ||
         url.includes('/menuOpciones') ||
         url.includes('/Servicios.jsf') ||
         url.includes('/menu.jsf');
}

// ─── Resolver ruta absoluta de Chromium ──────────────────────
function _resolverRutaChromium() {
  const raw = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  if (!raw) return null;
  if (nodePath.isAbsolute(raw)) return raw;
  try {
    const fullPath = execSync(`which "${raw}" 2>/dev/null`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      encoding: 'utf8',
    }).trim();
    if (fullPath) return fullPath;
  } catch { /* noop */ }
  return raw;
}

// ─── Lanzar navegador ─────────────────────────────────────────
async function _lanzarNavegador() {
  const execPath = _resolverRutaChromium();

  const opts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',              // requerido en Docker/Railway: sin él Chrome no puede iniciarse
      '--no-proxy-server',        // evitar detección automática de proxy (puede colgar)
      '--ignore-certificate-errors',
      '--disable-extensions',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--window-size=1280,800',
    ],
    timeout: 30_000,
    defaultViewport: { width: 1280, height: 800 },
  };

  if (execPath) opts.executablePath = execPath;

  try {
    return await puppeteer.launch(opts);
  } catch (err) {
    throw new Error(`BROWSER_UNAVAILABLE: No se pudo iniciar el navegador: ${err.message}`);
  }
}

async function _buscarPrimerSelector(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch { /* continuar */ }
  }
  return null;
}

async function _clickControlPorTexto(page, textos = []) {
  return page.evaluate((labels) => {
    const normalizar = (txt) => String(txt || '').trim().toLowerCase();
    const buscados = labels.map(normalizar);
    const controles = Array.from(document.querySelectorAll(
      'button, input[type="submit"], input[type="button"], a'
    ));
    const encontrado = controles.find((el) => {
      const texto = normalizar(el.textContent || el.value || el.getAttribute('aria-label'));
      return buscados.some((label) => texto.includes(label));
    });
    if (!encontrado) return false;
    encontrado.click();
    return true;
  }, textos).catch(() => false);
}

// ─── Descomponer rango de fechas en meses ─────────────────────
// Entrada: dd/mm/yyyy — Salida: [{ anio, mes }, ...]
function _mesesEnRango(fechaDesde, fechaHasta) {
  const pd = String(fechaDesde || '').split('/');
  const ph = String(fechaHasta || '').split('/');
  const anioIni = parseInt(pd[2], 10) || new Date().getFullYear();
  const mesIni  = parseInt(pd[1], 10) || 1;
  const anioFin = parseInt(ph[2], 10) || anioIni;
  const mesFin  = parseInt(ph[1], 10) || 12;

  const meses = [];
  let y = anioIni, m = mesIni;
  while (y < anioFin || (y === anioFin && m <= mesFin)) {
    meses.push({ anio: y, mes: m });
    if (++m > 12) { m = 1; y++; }
  }
  return meses.length > 0 ? meses : [{ anio: anioIni, mes: mesIni }];
}

// ─── Llenar el formulario JSF de comprobantes (año + mes) ─────
// El portal SRI filtra por período (año + mes), no por rango de fechas.
async function _consultarMesJsf(page, ruc, anio, mes, tipoComprobante) {
  // 1. Seleccionar radio "Ruc/Cédula/Pasaporte" (primer radio del formulario)
  await page.evaluate(() => {
    const radios = document.querySelectorAll('input[type="radio"]');
    if (radios[0]) radios[0].click();
  }).catch(() => {});

  // 2. Llenar campo RUC (puede estar pre-relleno por la sesión)
  if (ruc) {
    const rucSels = [
      'input[id*="identificacion"]', 'input[name*="identificacion"]',
      'input[id*="ruc"]',            'input[name*="ruc"]',
      'input[id*="cedula"]',         'input[name*="cedula"]',
    ];
    for (const sel of rucSels) {
      const el = await page.$(sel).catch(() => null);
      if (!el) continue;
      const visible = await el.evaluate(e => e.offsetParent !== null).catch(() => false);
      if (!visible) continue;
      const actual = await el.evaluate(e => e.value).catch(() => '');
      if (actual !== ruc) {
        await el.click({ clickCount: 3 });
        await el.type(ruc, { delay: 30 });
      }
      break;
    }
  }

  // 3. Seleccionar año
  const anioSels = [
    'select[id*="anio"]', 'select[name*="anio"]',
    'select[id*="ano"]',  'select[name*="ano"]',
    'select[id*="year"]', 'select[name*="year"]',
    'select[id*="Year"]',
  ];
  for (const sel of anioSels) {
    try {
      if (!await page.$(sel)) continue;
      await page.select(sel, String(anio));
      break;
    } catch { /* continuar */ }
  }

  // 4. Seleccionar mes (puede ser "1"-"12" o "01"-"12")
  const mesSels = [
    'select[id*="mes"]',   'select[name*="mes"]',
    'select[id*="month"]', 'select[name*="month"]',
    'select[id*="Mes"]',
  ];
  for (const sel of mesSels) {
    try {
      if (!await page.$(sel)) continue;
      const mesStr    = String(mes);
      const mesStr2   = mesStr.padStart(2, '0');
      let seleccionado = false;
      for (const v of [mesStr, mesStr2]) {
        try { await page.select(sel, v); seleccionado = true; break; } catch { /* probar siguiente */ }
      }
      if (seleccionado) break;
    } catch { /* continuar */ }
  }

  // 5. Tipo de comprobante (dejar en default si es TODOS)
  if (tipoComprobante && tipoComprobante !== 'TODOS') {
    const tipoSels = [
      'select[id*="tipo"]',       'select[name*="tipo"]',
      'select[id*="comprobante"]', 'select[name*="comprobante"]',
    ];
    for (const sel of tipoSels) {
      try {
        if (!await page.$(sel)) continue;
        await page.select(sel, tipoComprobante).catch(() => {});
        break;
      } catch { /* continuar */ }
    }
  }

  // 6. Click en "Consultar"
  const btnSels = [
    'input[value="Consultar"]',
    'input[value="consultar"]',
    '[id*="btnConsultar"]',
    '[id*="consultar"]',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  let clicked = false;
  for (const sel of btnSels) {
    const btn = await page.$(sel).catch(() => null);
    if (!btn) continue;
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
      btn.click(),
    ]);
    clicked = true;
    break;
  }
  if (!clicked) {
    const ok = await _clickControlPorTexto(page, ['Consultar', 'Buscar']);
    if (ok) {
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    }
  }

  // Esperar a que aparezca la tabla o alguna señal de resultado
  await page.waitForSelector(
    'table, .lista, .dataTable, [class*="comprobante"]',
    { timeout: TIMEOUT_SEL }
  ).catch(() => {});
}

// ─── Extraer filas de la tabla de resultados ──────────────────
async function _extraerFilas(page) {
  return page.evaluate(() => {
    // Buscar la tabla con más columnas (la de datos)
    const tablas = Array.from(document.querySelectorAll('table'));
    let tabla = null;
    let maxCols = 0;
    for (const t of tablas) {
      const headers = t.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
      if (headers.length > maxCols) { maxCols = headers.length; tabla = t; }
    }
    if (!tabla) return { rows: [], total: 0 };

    const rows = [];
    const trs  = Array.from(tabla.querySelectorAll('tbody tr, tr:not(:first-child)'));

    // Paginador (total de registros reportado por el portal)
    let total = 0;
    const paginador = document.querySelector(
      '[id*="paginador"], [id*="paginator"], .ui-paginator-current, [id*="totalRegistros"]'
    );
    if (paginador) {
      const m = paginador.textContent.match(/(\d+)\s*(registro|resultado|total)/i)
             || paginador.textContent.match(/de\s+(\d+)/i);
      if (m) total = parseInt(m[1], 10);
    }

    for (const tr of trs) {
      const celdas = Array.from(tr.querySelectorAll('td'));
      const textos = celdas.map((c) => c.textContent.trim().replace(/\s+/g, ' '));

      // Clave de acceso: 49 dígitos en celda o enlace
      let claveAcceso = null;
      for (const t of textos) {
        const solo = t.replace(/\s/g, '');
        if (/^\d{49}$/.test(solo)) { claveAcceso = solo; break; }
      }
      if (!claveAcceso) {
        const links = tr.querySelectorAll('a');
        for (const a of links) {
          const href = a.href || '';
          const txt  = (a.textContent || '').replace(/\s/g, '');
          const m = href.match(/claveAcceso[=:](\d{49})/i) || txt.match(/^(\d{49})$/);
          if (m) { claveAcceso = m[1]; break; }
        }
      }
      if (!claveAcceso) continue;

      const razonSocial = textos.find((t) => t.length > 5 && !/^\d+$/.test(t) && t !== claveAcceso) || null;
      const fechaMatch  = textos.find((t) => /\d{2}\/\d{2}\/\d{4}/.test(t)) || null;
      const totalMatch  = textos.find((t) => /^\$?\s*[\d.,]+$/.test(t.replace(/\s/g, ''))) || null;

      rows.push({
        claveAcceso,
        razonSocialEmisor: razonSocial,
        fechaEmision:      fechaMatch,
        importeTotal:      totalMatch ? parseFloat(totalMatch.replace(/[$, ]/g, '')) || 0 : 0,
      });
    }

    return { rows, total };
  });
}

// ─── Siguiente página (JSF y PrimeFaces) ─────────────────────
async function _irSiguientePagina(page) {
  const SEL_NEXT = [
    // PrimeFaces
    '.ui-paginator-next:not(.ui-state-disabled)',
    // Botones genéricos de siguiente
    '[id*="next"]:not([disabled])',
    'a[title="Siguiente"]',
    'a[title="siguiente"]',
    'a.paginadorSiguiente',
    '.paginadorSig',
    'input[value="Siguiente"]',
  ];

  for (const sel of SEL_NEXT) {
    const btn = await page.$(sel).catch(() => null);
    if (btn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        btn.click(),
      ]);
      return true;
    }
  }

  // Buscar por texto como fallback
  const clicked = await _clickControlPorTexto(page, ['Siguiente', 'siguiente', 'Next']);
  if (clicked) {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {});
    return true;
  }

  return false;
}

// ─── Deduplicar por clave de acceso ──────────────────────────
function _deduplicar(items) {
  const visto = new Set();
  return items.filter((it) => {
    if (visto.has(it.claveAcceso)) return false;
    visto.add(it.claveAcceso);
    return true;
  });
}

// ─── Normalizar fecha a dd/mm/yyyy ────────────────────────────
function _normalizarFecha(fecha) {
  if (!fecha) return '';
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return fecha;
}

// ─── Login en el portal SRI ───────────────────────────────────
/**
 * Autenticar en el portal SRI (JSF) y retornar { cookies, token }.
 * Para el portal JSF, token siempre es null (usa JSESSIONID en cookies).
 */
async function scraperSriLogin(identificacion, password) {
  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();

    page.on('requestfailed', () => {});
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-EC,es;q=0.9' });

    // ── Navegar al portal (el orden asegura llegar al formulario de login) ──
    let loginExitoso = false;
    for (const loginUrl of [SRI_LOGIN_URL, SRI_LOGIN_URL_ALT, SRI_LOGIN_JSF]) {
      try {
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV });
        const url = page.url();
        if (_esUrlAutenticada(url)) { loginExitoso = true; break; }
        if (url.includes('srienlinea.sri.gob.ec')) break;
      } catch { /* intentar siguiente */ }
    }

    if (loginExitoso) {
      const cookies = await page.cookies();
      await browser.close();
      return { cookies, token: null };
    }

    // ── Detectar campos del formulario ───────────────────────
    const SELECTORS_USER = [
      // Portal JSF (IDs confirmados del portal SRI)
      '#usuario',
      'input[name="usuario"]',
      'input[id*="usuario"]',
      '#ruc',
      'input[name="ruc"]',
      // SPA / Angular fallbacks
      'input[formcontrolname="usuario"]',
      'input[formcontrolname="ruc"]',
      'input[autocomplete="username"]',
      'input[type="text"]:first-of-type',
    ];
    const SELECTORS_PASS = [
      '#contrasenia',
      'input[name="contrasenia"]',
      'input[id*="contrasenia"]',
      '#password',
      'input[name="password"]',
      // Angular fallbacks
      'input[formcontrolname="contrasenia"]',
      'input[autocomplete="current-password"]',
      'input[type="password"]',
    ];

    // Esperar a que aparezca el formulario
    await page.waitForSelector('input[type="text"], input[type="password"]', { timeout: TIMEOUT_SEL }).catch(() => {});

    const userField = await _buscarPrimerSelector(page, SELECTORS_USER);
    if (!userField) {
      await browser.close();
      throw new Error(
        'No se encontró el campo de usuario en el portal SRI. ' +
        'Puede que el portal haya cambiado su estructura. Usa "Importar TXT del SRI" o "Importar ZIP".'
      );
    }

    const passField = await _buscarPrimerSelector(page, SELECTORS_PASS);
    if (!passField) {
      await browser.close();
      throw new Error('No se encontró el campo de contraseña en el portal SRI.');
    }

    // ── Llenar credenciales ───────────────────────────────────
    await userField.click({ clickCount: 3 });
    await userField.type(identificacion, { delay: 40 });

    await passField.click({ clickCount: 3 });
    await passField.type(password, { delay: 40 });

    // ── Enviar formulario ────────────────────────────────────
    const SELECTORS_SUBMIT = [
      'input[value="Ingresar"]',
      'button[type="submit"]',
      'input[type="submit"]',
      '#btnIngresar',
      '[id*="btnIngresar"]',
      '[id*="ingresar"]',
    ];

    let submitted = false;
    const btnSubmit = await _buscarPrimerSelector(page, SELECTORS_SUBMIT);
    if (btnSubmit) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        btnSubmit.click(),
      ]);
      submitted = true;
    }

    if (!submitted) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV }).catch(() => {}),
        _clickControlPorTexto(page, ['Ingresar', 'Entrar', 'Acceder', 'Login']),
      ]).catch(() => {});
    }

    // ── Verificar resultado del login ─────────────────────────
    const urlActual = page.url();

    if (_esUrlLogin(urlActual) || !_esUrlAutenticada(urlActual)) {
      const mensajeError = await page.$eval(
        '[id*="mensajeError"], .msgError, .error-message, .ui-messages-error-detail, ' +
        '.alert-danger, .mat-error, [class*="error"]:not(input)',
        (el) => el.textContent.trim()
      ).catch(() => null);

      await browser.close();
      throw new Error(
        mensajeError ||
        'Las credenciales del portal SRI son incorrectas. ' +
        'Verifica el RUC/cédula y la contraseña de srienlinea.sri.gob.ec.'
      );
    }

    const cookies = await page.cookies();
    await browser.close();
    return { cookies, token: null };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Consulta de comprobantes recibidos ──────────────────────
/**
 * Consultar comprobantes recibidos usando cookies de sesión.
 * Itera por cada mes del rango dado (el portal SRI filtra por año+mes).
 *
 * @param {Array|{cookies}}  cookies   Cookies de scraperSriLogin
 * @param {{ ruc, fechaDesde, fechaHasta, tipoComprobante }} params
 * @returns {{ total: number, items: Array }}
 */
async function scraperSriRecibidos(cookies, {
  ruc,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  const fDesde  = _normalizarFecha(fechaDesde);
  const fHasta  = _normalizarFecha(fechaHasta);
  const meses   = _mesesEnRango(fDesde, fHasta);

  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();
    page.on('requestfailed', () => {});

    // Restaurar sesión
    const cookiesArr = Array.isArray(cookies) ? cookies : (cookies?.cookies || []);
    if (cookiesArr.length > 0) await page.setCookie(...cookiesArr);

    // Navegar a comprobantes recibidos
    await page.goto(SRI_RECIBIDOS_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_NAV });

    if (_esUrlLogin(page.url())) {
      await browser.close();
      throw new Error('La sesión del portal SRI expiró. Vuelve a intentar.');
    }

    const todosLosItems = [];

    // El portal filtra por mes — iterar sobre cada mes del rango
    for (const { anio, mes } of meses) {
      await _consultarMesJsf(page, ruc, anio, mes, tipoComprobante);

      // Extraer todas las páginas del mes actual
      for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
        if (pagina > 0) {
          const hayMas = await _irSiguientePagina(page);
          if (!hayMas) break;
        }

        const { rows } = await _extraerFilas(page);
        if (rows.length === 0) break;
        todosLosItems.push(...rows);
      }
    }

    await browser.close();
    const items = _deduplicar(todosLosItems);
    return { total: items.length, items };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Función principal exportada ──────────────────────────────
/**
 * Login + consulta de comprobantes recibidos.
 * Intenta primero con fetch-based JSF (sin Puppeteer).
 * Si falla por razones técnicas (no por credenciales), reintenta con Puppeteer.
 *
 * @param {{ identificacion, password, fechaDesde, fechaHasta, tipoComprobante }} params
 * @returns {Array<{ claveAcceso, razonSocialEmisor, fechaEmision, importeTotal }>}
 */
async function obtenerRecibidosScraper({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  if (!identificacion || !password) {
    throw new Error('Se requiere identificación y contraseña del portal SRI');
  }
  if (!fechaDesde || !fechaHasta) {
    throw new Error('Se requiere rango de fechas (fechaDesde, fechaHasta)');
  }

  const params = { identificacion, password, fechaDesde, fechaHasta, tipoComprobante };

  // ── Intento 1: fetch-based (sin Puppeteer, funciona en Railway) ──
  try {
    console.log('[SRI] Intentando scraper fetch-based (JSF)...');
    const items = await obtenerRecibidosFetch(params);
    console.log(`[SRI] Fetch-based OK: ${items.length} comprobantes`);
    return items;
  } catch (fetchErr) {
    console.warn('[SRI] Fetch-based falló:', fetchErr.message);
    // Si el error es de credenciales, no tiene sentido reintentar con Puppeteer
    if (/credenciales|contraseña|password|incorrectos|incorrectas|usuario/i.test(fetchErr.message)) {
      throw fetchErr;
    }
    // Otros errores → intentar con Puppeteer como fallback
  }

  // ── Intento 2: Puppeteer (fallback, no disponible en Railway) ──
  console.log('[SRI] Intentando scraper Puppeteer (fallback)...');
  const TIMEOUT_TOTAL_MS = 3 * 60 * 1000;

  const scraperPromise = (async () => {
    const session = await scraperSriLogin(identificacion, password);
    const { items } = await scraperSriRecibidos(session, {
      ruc: identificacion,
      fechaDesde,
      fechaHasta,
      tipoComprobante,
    });
    return items;
  })();

  return Promise.race([
    scraperPromise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(
          'Tiempo de espera agotado (3 min). El portal SRI no respondió a tiempo. ' +
          'Prueba más tarde o descarga el ZIP desde srienlinea.sri.gob.ec → Comprobantes electrónicos → Recibidos → Descargar XML e impórtalo con "Importar ZIP".'
        )),
        TIMEOUT_TOTAL_MS
      )
    ),
  ]);
}

module.exports = {
  // Fetch-based (Keycloak, sin Puppeteer) — preferido
  sriLoginKeycloak,
  sriGetComprobantesRecibidos,
  obtenerRecibidosFetch,
  // Legacy Puppeteer
  obtenerRecibidosScraper,
  scraperSriLogin,
  scraperSriRecibidos,
};
