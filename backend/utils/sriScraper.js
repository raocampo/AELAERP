// ============================================================
//  AELA — sriScraper.js
//  Scraping del portal SRI en línea con Puppeteer.
//
//  Flujo:
//    1. scraperSriLogin(ruc, password)        → { cookies }
//    2. scraperSriRecibidos(cookies, params)  → { total, items[] }
//    3. obtenerRecibidosScraper(params)       → items[] (por mes)
//
//  Portal confirmado 2026-06-02:
//    Login : srienlinea.sri.gob.ec/  (redirige a JSF login)
//    Docs  : srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultas/menu.jsf
//    El portal usa filtro AÑO + MES (no rango de fechas).
// ============================================================

const puppeteer = require('puppeteer');
const nodePath   = require('path');
const { execSync } = require('child_process');

const SRI_BASE = 'https://srienlinea.sri.gob.ec';

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
 * Login + consulta de TODOS los comprobantes recibidos en el rango dado.
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

  // Timeout global de 3 minutos para evitar que el job quede colgado indefinidamente
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

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(
      () => reject(new Error(
        'Tiempo de espera agotado (3 min). El portal SRI no respondió a tiempo. ' +
        'Prueba más tarde o descarga el ZIP manualmente desde srienlinea.sri.gob.ec → Comprobantes electrónicos → Recibidos → Descargar XML e impórtalo con "Importar ZIP".'
      )),
      TIMEOUT_TOTAL_MS
    )
  );

  return Promise.race([scraperPromise, timeoutPromise]);
}

module.exports = {
  obtenerRecibidosScraper,
  scraperSriLogin,
  scraperSriRecibidos,
};
