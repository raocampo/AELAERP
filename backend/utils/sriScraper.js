// ============================================================
//  AELA — sriScraper.js
//  Scraping del portal SRI en línea con Puppeteer.
//
//  Flujo:
//    1. scraperSriLogin(ruc, password)        → session cookies
//    2. scraperSriRecibidos(cookies, params)  → { total, items[] }
//    3. obtenerRecibidosScraper(params)       → items[] (paginado)
//
//  La clave de acceso de cada comprobante se extrae de la tabla
//  "Comprobantes Recibidos" del portal srienlinea.sri.gob.ec.
// ============================================================

const puppeteer = require('puppeteer');

const SRI_BASE          = 'https://srienlinea.sri.gob.ec';
const SRI_LOGIN_URL     = `${SRI_BASE}/sri-en-linea/SriLoginInternet/ConsultaRucActionInternet/AgregarServicio`;
const SRI_RECIBIDOS_URL = `${SRI_BASE}/sri-en-linea/VOE/consultas/recepcionComprobantes/RecepcionComprobantes.jsf`;

const TIMEOUT_NAV    = 45_000;
const TIMEOUT_SEL    = 20_000;
const MAX_PAGINAS    = 30;  // máx 3 000 docs (30 páginas × 100)

// ─── Lanzar navegador ────────────────────────────────────────
async function _lanzarNavegador() {
  const execPath =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    process.env.CHROMIUM_PATH ||
    null; // null → puppeteer usa el Chrome que descargó

  const opts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
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
    throw new Error(
      `No se pudo iniciar el navegador para el scraping del SRI: ${err.message}. ` +
      'Asegúrate de que Chromium/Chrome esté instalado en el servidor.'
    );
  }
}

async function _buscarPrimerSelector(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch {
      // Algunos selectores pueden dejar de ser válidos si cambia el portal.
    }
  }
  return null;
}

async function _clickControlPorTexto(page, textos = []) {
  return page.evaluate((labels) => {
    const normalizar = (txt) => String(txt || '').trim().toLowerCase();
    const buscados = labels.map(normalizar);
    const controles = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a'));
    const encontrado = controles.find((el) => {
      const texto = normalizar(el.textContent || el.value || el.getAttribute('aria-label'));
      return buscados.some((label) => texto.includes(label));
    });
    if (!encontrado) return false;
    encontrado.click();
    return true;
  }, textos).catch(() => false);
}

// ─── Autenticación ───────────────────────────────────────────
/**
 * Autenticar en el portal SRI y retornar cookies de sesión.
 * @returns {Array} cookies del navegador tras login exitoso
 */
async function scraperSriLogin(identificacion, password) {
  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();

    // Silenciar errores de recursos externos
    page.on('requestfailed', () => {});
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-EC,es;q=0.9' });

    // ── Ir a la página de login ──────────────────────────────
    await page.goto(SRI_LOGIN_URL, {
      waitUntil: 'networkidle2',
      timeout: TIMEOUT_NAV,
    });

    // ── Detectar campos de login ─────────────────────────────
    // El portal SRI usa distintos IDs según la versión; intentamos varios
    const SELECTORS_USER = [
      '#usuario',
      '#ruc',
      'input[name="usuario"]',
      'input[name="ruc"]',
      'input[id*="usuario"]',
      'input[type="text"]:first-of-type',
    ];
    const SELECTORS_PASS = [
      '#contrasenia',
      '#password',
      'input[name="contrasenia"]',
      'input[name="password"]',
      'input[id*="contrasenia"]',
      'input[type="password"]',
    ];

    const userField = await _buscarPrimerSelector(page, SELECTORS_USER);
    if (!userField) {
      await browser.close();
      throw new Error(
        'No se encontró el campo de usuario en el portal SRI. ' +
        'El portal puede haber cambiado su estructura. Usa la pestaña "Importar ZIP".'
      );
    }

    const passField = await _buscarPrimerSelector(page, SELECTORS_PASS);
    if (!passField) {
      await browser.close();
      throw new Error('No se encontró el campo de contraseña en el portal SRI.');
    }

    // ── Llenar credenciales ──────────────────────────────────
    await userField.click({ clickCount: 3 });
    await userField.type(identificacion, { delay: 40 });

    await passField.click({ clickCount: 3 });
    await passField.type(password, { delay: 40 });

    // ── Submit ───────────────────────────────────────────────
    const SELECTORS_SUBMIT = [
      'button[type="submit"]',
      'input[type="submit"]',
      '#btnIngresar',
      '[id*="btnIngresar"]',
      '[id*="ingresar"]',
    ];

    let submitted = false;
    const btn = await _buscarPrimerSelector(page, SELECTORS_SUBMIT);
    if (btn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }),
        btn.click(),
      ]).catch(() => {}); // ignora timeout de navegación; revisamos URL después
      submitted = true;
    } else {
      submitted = await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }).catch(() => {}),
        _clickControlPorTexto(page, ['Ingresar', 'Entrar', 'Acceder']),
      ]).then(([, clicked]) => Boolean(clicked)).catch(() => false);
    }

    if (!submitted) {
      // Fallback: Enter en el campo de contraseña
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }),
        passField.press('Enter'),
      ]).catch(() => {});
    }

    // ── Verificar login exitoso ──────────────────────────────
    const urlActual = page.url();

    // Si sigue en la página de login → credenciales incorrectas
    if (urlActual.includes('SriLoginInternet') || urlActual.includes('AgregarServicio')) {
      // Revisar si hay mensaje de error en la página
      const mensajeError = await page.$eval(
        '[id*="mensajeError"], .msgError, .error-message, .ui-messages-error-detail',
        (el) => el.textContent.trim()
      ).catch(() => null);

      await browser.close();
      throw new Error(
        mensajeError ||
        'Las credenciales del portal SRI son incorrectas. ' +
        'Verifica el RUC/cédula y la contraseña del portal srienlinea.sri.gob.ec.'
      );
    }

    const cookies = await page.cookies();
    await browser.close();
    return cookies;
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Consulta de comprobantes recibidos ──────────────────────
/**
 * Consultar comprobantes recibidos usando las cookies de sesión.
 * @param {Array}  cookies     Cookies obtenidas en scraperSriLogin
 * @param {object} params      { ruc, fechaDesde, fechaHasta, tipoComprobante }
 *   fechaDesde / fechaHasta en formato 'dd/mm/yyyy' o 'yyyy-mm-dd'
 * @returns {{ total: number, items: Array }}
 */
async function scraperSriRecibidos(cookies, {
  ruc,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
} = {}) {
  const fDesde = _normalizarFecha(fechaDesde);
  const fHasta = _normalizarFecha(fechaHasta);

  let browser;
  try {
    browser = await _lanzarNavegador();
    const page = await browser.newPage();
    page.on('requestfailed', () => {});

    // ── Restaurar sesión ─────────────────────────────────────
    await page.setCookie(...cookies);

    // ── Ir a comprobantes recibidos ──────────────────────────
    await page.goto(SRI_RECIBIDOS_URL, {
      waitUntil: 'networkidle2',
      timeout: TIMEOUT_NAV,
    });

    // Si nos redirigió a login, la sesión expiró
    if (page.url().includes('SriLoginInternet')) {
      await browser.close();
      throw new Error('La sesión del portal SRI expiró. Vuelve a intentar.');
    }

    // ── Llenar filtro de fechas ──────────────────────────────
    await _llenarFiltroFechas(page, fDesde, fHasta, tipoComprobante);

    // ── Recolectar resultados paginados ──────────────────────
    const items = [];
    let paginaActual = 0;
    let totalReportado = 0;

    for (paginaActual = 0; paginaActual < MAX_PAGINAS; paginaActual++) {
      if (paginaActual > 0) {
        const hayMas = await _irSiguientePagina(page);
        if (!hayMas) break;
      }

      // Esperar tabla
      await page.waitForSelector(
        'table[id*="comprobante"], table[id*="Comprobante"], .dataTable, [role="grid"]',
        { timeout: TIMEOUT_SEL }
      ).catch(() => {});

      const { rows, total } = await _extraerFilas(page);
      if (total > 0 && totalReportado === 0) totalReportado = total;
      if (rows.length === 0) break;

      items.push(...rows);
      if (items.length >= totalReportado && totalReportado > 0) break;
    }

    await browser.close();
    return {
      total: totalReportado || items.length,
      items: _deduplicar(items),
    };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

// ─── Llenar filtro de fechas ─────────────────────────────────
async function _llenarFiltroFechas(page, fechaDesde, fechaHasta, tipoComprobante) {
  // Intentar localizar y llenar el campo fechaDesde
  const SEL_DESDE = [
    '#fecDatDesde',
    '[id*="fechaDesde"]',
    '[id*="fecDesde"]',
    'input[name*="fechaDesde"]',
    'input[name*="fecDesde"]',
  ];
  const SEL_HASTA = [
    '#fecDatHasta',
    '[id*="fechaHasta"]',
    '[id*="fecHasta"]',
    'input[name*="fechaHasta"]',
    'input[name*="fecHasta"]',
  ];
  const SEL_BUSCAR = [
    '#btnBuscar',
    '[id*="btnBuscar"]',
    '[id*="buscar"]',
    'input[value*="Buscar"]',
  ];

  const desde = await _buscarPrimerSelector(page, SEL_DESDE);
  if (desde) { await desde.click({ clickCount: 3 }); await desde.type(fechaDesde); }

  const hasta = await _buscarPrimerSelector(page, SEL_HASTA);
  if (hasta) { await hasta.click({ clickCount: 3 }); await hasta.type(fechaHasta); }

  // Tipo de comprobante si aplica
  if (tipoComprobante && tipoComprobante !== 'TODOS') {
    const SEL_TIPO = ['#tipoComprobante', '[id*="tipoCom"]', 'select[name*="tipo"]'];
    for (const sel of SEL_TIPO) {
      try {
        const el = await page.$(sel);
        if (!el) continue;
        await page.select(sel, tipoComprobante).catch(() => {});
        break;
      } catch {
        // Continuar con el siguiente selector si el portal cambió.
      }
    }
  }

  // Click en Buscar y esperar resultado
  let buscado = false;
  const buscar = await _buscarPrimerSelector(page, SEL_BUSCAR);
  if (buscar) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }).catch(() => {}),
      buscar.click(),
    ]);
    buscado = true;
  } else {
    buscado = await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }).catch(() => {}),
      _clickControlPorTexto(page, ['Buscar', 'Consultar']),
    ]).then(([, clicked]) => Boolean(clicked)).catch(() => false);
  }

  if (!buscado) {
    // Intentar presionar Enter en el campo de fecha
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 }).catch(() => {});
  }
}

// ─── Extraer filas de la tabla ───────────────────────────────
async function _extraerFilas(page) {
  return page.evaluate(() => {
    // Buscar la tabla de resultados
    const tablas = Array.from(document.querySelectorAll('table'));
    let tabla = null;

    // Priorizar la tabla con más columnas (probablemente la de datos)
    let maxCols = 0;
    for (const t of tablas) {
      const headers = t.querySelectorAll('thead th, thead td');
      if (headers.length > maxCols) { maxCols = headers.length; tabla = t; }
    }

    if (!tabla) return { rows: [], total: 0 };

    // Detectar índice de columna que contiene la clave de acceso (49 dígitos)
    const rows = [];
    const trs  = Array.from(tabla.querySelectorAll('tbody tr'));

    // Total de registros del portal (si hay paginador)
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

      // Buscar la clave de acceso (49 dígitos numéricos) en alguna celda
      let claveAcceso = null;
      for (const t of textos) {
        const solo = t.replace(/\s/g, '');
        if (/^\d{49}$/.test(solo)) { claveAcceso = solo; break; }
      }
      // También puede estar en un enlace
      if (!claveAcceso) {
        const links = tr.querySelectorAll('a[href]');
        for (const a of links) {
          const m = (a.href || '').match(/claveAcceso=(\d{49})/i)
                 || (a.textContent || '').match(/\d{49}/);
          if (m) { claveAcceso = m[1]; break; }
        }
      }

      if (!claveAcceso) continue;

      // Extraer otros campos de las celdas restantes
      const razonSocial = textos.find((t) => t.length > 5 && !/^\d+$/.test(t) && t !== claveAcceso) || null;
      const fechaMatch  = textos.find((t) => /\d{2}\/\d{2}\/\d{4}/.test(t)) || null;
      const totalMatch  = textos.find((t) => /^\$?\s*[\d.,]+$/.test(t.replace(/\s/g, ''))) || null;

      rows.push({
        claveAcceso,
        razonSocialEmisor: razonSocial,
        fechaEmision: fechaMatch,
        importeTotal: totalMatch ? parseFloat(totalMatch.replace(/[$, ]/g, '')) || 0 : 0,
      });
    }

    return { rows, total };
  });
}

// ─── Ir a la siguiente página ────────────────────────────────
async function _irSiguientePagina(page) {
  const SEL_NEXT = [
    '.ui-paginator-next:not(.ui-state-disabled)',
    '[id*="next"]:not([disabled])',
    'a[title*="iguiente"]',
    'a.paginadorSiguiente',
    '.paginadorSig',
  ];

  for (const sel of SEL_NEXT) {
    const btn = await page.$(sel);
    if (btn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: TIMEOUT_NAV }).catch(() => {}),
        btn.click(),
      ]);
      return true;
    }
  }
  return false;
}

// ─── Deduplicar por clave de acceso ─────────────────────────
function _deduplicar(items) {
  const visto = new Set();
  return items.filter((it) => {
    if (visto.has(it.claveAcceso)) return false;
    visto.add(it.claveAcceso);
    return true;
  });
}

// ─── Normalizar fecha a dd/mm/yyyy ───────────────────────────
function _normalizarFecha(fecha) {
  if (!fecha) return '';
  // Si viene en yyyy-mm-dd, convertir
  const m = String(fecha).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return fecha;
}

// ─── Función principal exportada ─────────────────────────────
/**
 * Autenticar y obtener TODOS los comprobantes recibidos
 * en el rango de fechas dado usando scraping del portal SRI.
 *
 * @param {{ identificacion, password, ruc, fechaDesde, fechaHasta, tipoComprobante }} params
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

  const cookies = await scraperSriLogin(identificacion, password);

  const { items } = await scraperSriRecibidos(cookies, {
    ruc: identificacion,
    fechaDesde,
    fechaHasta,
    tipoComprobante,
  });

  return items;
}

module.exports = {
  obtenerRecibidosScraper,
  scraperSriLogin,
  scraperSriRecibidos,
};
