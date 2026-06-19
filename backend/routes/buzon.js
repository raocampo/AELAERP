// ============================================================
//  AELA — Buzón SRI: rutas de importación en lote
//  backend/routes/buzon.js
//
//  POST /api/buzon/consultar             → preview de N claves
//  POST /api/buzon/importar              → importación confirmada
//  POST /api/buzon/importar-zip          → ZIP de XMLs
//  POST /api/buzon/sri-portal/consultar  → portal REST (API móvil)
//  POST /api/buzon/sri-scraper/consultar → portal via Puppeteer
//  POST /api/buzon/sri-scraper/importar  → scraper + importar directo
// ============================================================

const express = require('express');
const multer  = require('multer');
const AdmZip  = require('adm-zip');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { obtenerXmlDesdeAutorizacion } = require('../utils/importacionProductos');
const {
  detectarTipoDesdeClaveAcceso,
  importarDocumentoRecibido,
  TIPOS_DOCUMENTO,
} = require('../utils/buzon');
const {
  autenticarSriPortal,
  obtenerTodosLosRecibidos,
  isoAFormatoSri,
} = require('../utils/sriPortal');
const { obtenerRecibidosScraper } = require('../utils/sriScraper');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const MAX_CLAVES_LOTE = 50;

// ─── Store en memoria para jobs async del scraper SRI ─────────
// Evita el timeout de 60 s del proxy de Railway respondiendo de inmediato
// con un jobId y ejecutando el scraper en background.
const SCRAPER_JOBS = new Map();
function _limpiarJobsViejos() {
  const limite = Date.now() - 15 * 60 * 1000;
  for (const [id, job] of SCRAPER_JOBS) {
    if (job.startedAt < limite) SCRAPER_JOBS.delete(id);
  }
}

router.use(proteger);
router.use(requiereModulo('comprasHabilitadas'));
router.use(autorizarPermiso('compras.gestionar'));

// ─── Normalizar clave ────────────────────────────────────────
function limpiarClave(texto) {
  return String(texto || '').replace(/\s+/g, '').trim();
}

// ─── Verificar si ya existe en BD ───────────────────────────
async function yaExisteEnBd(empresaId, clave, tipoDoc) {
  if (!clave) return false;
  const destino = TIPOS_DOCUMENTO[tipoDoc]?.destino;
  if (destino === 'facturas_compra') {
    const r = await prisma.facturas_compra.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  if (destino === 'retenciones_recibidas') {
    const r = await prisma.retenciones_recibidas.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  if (destino === 'docs_recibidos_otros') {
    const r = await prisma.docs_recibidos_otros.findFirst({ where: { empresaId, claveAcceso: clave }, select: { id: true } });
    return r ? r.id : false;
  }
  return false;
}

// ─── Obtener preview básico del XML (sin parseo pesado) ──────
function previewDeXml(xmlEnvuelto, tipoDoc) {
  const rucMatch   = xmlEnvuelto?.match(/<ruc>([^<]+)<\/ruc>/i);
  const rsMatch    = xmlEnvuelto?.match(/<razonSocial>([^<]+)<\/razonSocial>/i);
  const fechaMatch = xmlEnvuelto?.match(/<fechaEmision>([^<]+)<\/fechaEmision>/i);
  const totalMatch = xmlEnvuelto?.match(/<importeTotal>([^<]+)<\/importeTotal>/i)
    || xmlEnvuelto?.match(/<totalComprobante>([^<]+)<\/totalComprobante>/i)
    || xmlEnvuelto?.match(/<importe_total>([^<]+)<\/importe_total>/i);

  return {
    emisorRuc:    rucMatch   ? rucMatch[1].trim()   : null,
    emisorNombre: rsMatch    ? rsMatch[1].trim()     : null,
    fecha:        fechaMatch ? fechaMatch[1].trim()  : null,
    total:        totalMatch ? Number(totalMatch[1]) || 0 : 0,
    tipo:         TIPOS_DOCUMENTO[tipoDoc]?.nombre || tipoDoc,
  };
}

// ─── Helpers descarga automática SRI ─────────────────────────
function validarPayloadConsultaSri({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
} = {}) {
  if (!identificacion || !password) {
    return 'Se requiere identificación y contraseña del portal SRI';
  }
  if (!fechaDesde || !fechaHasta) {
    return 'Se requiere rango de fechas (fechaDesde, fechaHasta)';
  }
  return null;
}

async function obtenerRecibidosPortalRest({
  identificacion,
  password,
  fechaDesde,
  fechaHasta,
  tipoComprobante = 'TODOS',
}) {
  const token = await autenticarSriPortal(identificacion, password);
  return obtenerTodosLosRecibidos(token, {
    ruc: identificacion,
    fechaDesde: isoAFormatoSri(fechaDesde) || fechaDesde,
    fechaHasta: isoAFormatoSri(fechaHasta) || fechaHasta,
    tipoComprobante,
  });
}

async function armarRespuestaConsultaRecibidos(empresaId, docsPortal = []) {
  const resultados = [];

  for (const doc of docsPortal) {
    const clave = limpiarClave(doc.claveAcceso);
    const tipo  = detectarTipoDesdeClaveAcceso(clave);

    if (!tipo) {
      resultados.push({
        clave,
        estado: 'error',
        error:  'Tipo de documento no reconocido en la clave',
        preview: {
          emisorNombre: doc.razonSocialEmisor,
          emisorRuc:    doc.rucEmisor,
          fecha:        doc.fechaEmision,
          total:        doc.importeTotal,
          tipo:         doc.tipoComprobante,
        },
      });
      continue;
    }

    const idExistente = await yaExisteEnBd(empresaId, clave, tipo.cod);
    resultados.push({
      clave,
      estado:   idExistente ? 'existe' : 'nuevo',
      tipo:     tipo.nombre,
      tipoCod:  tipo.cod,
      destino:  tipo.destino,
      idExistente: idExistente || undefined,
      preview: {
        emisorNombre: doc.razonSocialEmisor,
        emisorRuc:    doc.rucEmisor,
        fecha:        doc.fechaEmision,
        total:        doc.importeTotal,
        tipo:         tipo.nombre,
      },
    });
  }

  return {
    success:  true,
    total:    docsPortal.length,
    nuevos:   resultados.filter((r) => r.estado === 'nuevo').length,
    resultados,
  };
}

function statusErrorConsultaSri(err) {
  const msg = err?.message || '';
  if (/credenciales|contraseña|password|incorrectas/i.test(msg)) return 422;
  if (/no disponible|HTTP|conectar|tiempo|timeout|SRI/i.test(msg)) return 502;
  return 422;
}

function esErrorCredencialesSri(err) {
  const msg = err?.message || '';
  return /credenciales|contraseña|password|incorrectas/i.test(msg);
}

// ─── POST /consultar ─────────────────────────────────────────
router.post('/consultar', async (req, res) => {
  try {
    const { claves = [] } = req.body || {};
    const empresaId = req.empresa.id;

    const clavesLimpias = [...new Set(
      claves.map(limpiarClave).filter((c) => c.length === 49)
    )].slice(0, MAX_CLAVES_LOTE);

    if (clavesLimpias.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se proporcionaron claves de acceso válidas (49 dígitos)' });
    }

    const resultados = [];

    for (const clave of clavesLimpias) {
      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ clave, estado: 'error', error: 'Tipo de documento no reconocido en la clave' });
        continue;
      }

      // ¿Ya existe?
      const idExistente = await yaExisteEnBd(empresaId, clave, tipo.cod);
      if (idExistente) {
        resultados.push({ clave, estado: 'existe', tipo: tipo.nombre, idExistente });
        continue;
      }

      // Consultar SRI
      try {
        const respSRI = await obtenerXmlDesdeAutorizacion(clave);
        const preview = previewDeXml(respSRI.xml, tipo.cod);
        resultados.push({
          clave,
          estado: 'nuevo',
          tipo: tipo.nombre,
          tipoCod: tipo.cod,
          destino: tipo.destino,
          preview,
          numeroAutorizacion: respSRI.numeroAutorizacion,
          ambiente: respSRI.ambiente,
          // El XML no se devuelve al cliente por tamaño; se re-consultará al importar
        });
      } catch (err) {
        resultados.push({ clave, estado: 'error', tipo: tipo.nombre, error: err.message || 'No se pudo obtener el XML del SRI' });
      }
    }

    // Detectar fallo masivo del servicio SRI (todas las claves nuevas dieron error de red/servicio)
    const nuevas  = resultados.filter((r) => r.estado !== 'existe');
    const errores = nuevas.filter((r) => r.estado === 'error');
    const avisoSri = nuevas.length > 0 && errores.length === nuevas.length &&
      errores.every((r) => /sri|servicio|timeout|red|http|disponible/i.test(r.error || ''))
      ? 'El servicio de autorización del SRI no está disponible en este momento. Intenta más tarde o usa "Importar ZIP" con los XMLs descargados de srienlinea.sri.gob.ec.'
      : null;

    res.json({ success: true, total: clavesLimpias.length, resultados, avisoSri });
  } catch (error) {
    console.error('Error en /buzon/consultar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar el SRI' });
  }
});

// ─── POST /importar ──────────────────────────────────────────
router.post('/importar', async (req, res) => {
  try {
    const { items = [], opciones = {} } = req.body || {};
    const empresaId  = req.empresa.id;
    const usuarioId  = req.usuario?.id || null;

    if (items.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se enviaron documentos a importar' });
    }
    if (items.length > MAX_CLAVES_LOTE) {
      return res.status(400).json({ success: false, mensaje: `Máximo ${MAX_CLAVES_LOTE} documentos por lote` });
    }

    const resultados = [];

    for (const item of items) {
      const clave = limpiarClave(item.clave);
      if (!clave || clave.length !== 49) {
        resultados.push({ clave, estado: 'error', error: 'Clave inválida' });
        continue;
      }

      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ clave, estado: 'error', error: 'Tipo de documento no reconocido' });
        continue;
      }

      try {
        // Re-consultar SRI para obtener XML fresco
        const respSRI = await obtenerXmlDesdeAutorizacion(clave);

        const resultado = await prisma.$transaction(async (tx) => {
          return importarDocumentoRecibido({
            tx,
            empresaId,
            usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: respSRI.xml,
            xmlEnvuelto: respSRI.xml,
            claveAcceso: clave,
            numeroAutorizacion: respSRI.numeroAutorizacion || clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          });
        });

        resultados.push({ clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id, motivo: resultado.motivo });
      } catch (err) {
        console.error(`[Buzón] Error importando ${clave}:`, err.message);
        resultados.push({ clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const omitidos = resultados.filter((r) => r.estado === 'omitido').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({ success: true, resumen: { creados, omitidos, errores }, resultados });
  } catch (error) {
    console.error('Error en /buzon/importar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al importar los documentos' });
  }
});

// ─── POST /importar-zip ──────────────────────────────────────
router.post('/importar-zip', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });
    }

    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const opciones  = req.body?.opciones ? JSON.parse(req.body.opciones || '{}') : {};

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ success: false, mensaje: 'El archivo no es un ZIP válido' });
    }

    const entries = zip.getEntries().filter((e) => !e.isDirectory && e.name.toLowerCase().endsWith('.xml'));
    if (entries.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El ZIP no contiene archivos XML' });
    }
    if (entries.length > MAX_CLAVES_LOTE) {
      return res.status(400).json({ success: false, mensaje: `El ZIP contiene ${entries.length} archivos. Máximo ${MAX_CLAVES_LOTE} por lote.` });
    }

    const resultados = [];

    for (const entry of entries) {
      const xmlString = entry.getData().toString('utf8');
      const filename  = entry.name;

      // Extraer clave de acceso del XML (infoTributaria/claveAcceso)
      const claveMatch = xmlString.match(/<claveAcceso>([^<]{49})<\/claveAcceso>/i);
      const clave = claveMatch ? claveMatch[1].trim() : null;

      if (!clave) {
        resultados.push({ archivo: filename, estado: 'error', error: 'No se encontró clave de acceso (49 dígitos) en el XML' });
        continue;
      }

      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ archivo: filename, clave, estado: 'error', error: 'Tipo de documento no reconocido' });
        continue;
      }

      try {
        const resultado = await prisma.$transaction(async (tx) => {
          return importarDocumentoRecibido({
            tx,
            empresaId,
            usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: xmlString,
            xmlEnvuelto: xmlString,
            claveAcceso: clave,
            numeroAutorizacion: clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          });
        });

        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id, motivo: resultado.motivo });
      } catch (err) {
        console.error(`[Buzón ZIP] Error importando ${filename}:`, err.message);
        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const omitidos = resultados.filter((r) => r.estado === 'omitido').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({ success: true, resumen: { creados, omitidos, errores, totalArchivos: entries.length }, resultados });
  } catch (error) {
    console.error('Error en /buzon/importar-zip:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el archivo ZIP' });
  }
});

// ─── POST /importar-xml ──────────────────────────────────────
// Permite subir uno o varios archivos XML directamente (sin ZIP).
router.post('/importar-xml', upload.array('archivos', MAX_CLAVES_LOTE), async (req, res) => {
  try {
    const archivos = req.files || [];
    if (archivos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se recibieron archivos XML' });
    }
    if (archivos.length > MAX_CLAVES_LOTE) {
      return res.status(400).json({ success: false, mensaje: `Máximo ${MAX_CLAVES_LOTE} archivos XML por lote` });
    }

    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const opciones  = req.body?.opciones ? JSON.parse(req.body.opciones || '{}') : {};

    const resultados = [];

    for (const file of archivos) {
      const filename  = file.originalname;
      const xmlString = file.buffer.toString('utf8');

      const claveMatch = xmlString.match(/<claveAcceso>([^<]{49})<\/claveAcceso>/i);
      const clave = claveMatch ? claveMatch[1].trim() : null;

      if (!clave) {
        resultados.push({ archivo: filename, estado: 'error', error: 'No se encontró clave de acceso (49 dígitos) en el XML' });
        continue;
      }

      const tipo = detectarTipoDesdeClaveAcceso(clave);
      if (!tipo) {
        resultados.push({ archivo: filename, clave, estado: 'error', error: 'Tipo de documento no reconocido' });
        continue;
      }

      try {
        const resultado = await prisma.$transaction(async (tx) => {
          return importarDocumentoRecibido({
            tx, empresaId, usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: xmlString,
            xmlEnvuelto: xmlString,
            claveAcceso: clave,
            numeroAutorizacion: clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          });
        });
        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id, motivo: resultado.motivo });
      } catch (err) {
        console.error(`[Buzón XML] Error importando ${filename}:`, err.message);
        resultados.push({ archivo: filename, clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const omitidos = resultados.filter((r) => r.estado === 'omitido').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({ success: true, resumen: { creados, omitidos, errores, totalArchivos: archivos.length }, resultados });
  } catch (error) {
    console.error('Error en /buzon/importar-xml:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar los archivos XML' });
  }
});

// ─── GET /historial ──────────────────────────────────────────
router.get('/historial', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { tipo = 'todos', page = 1, limit = 30 } = req.query;
    const take = parseInt(limit, 10) || 30;
    const skip = ((parseInt(page, 10) || 1) - 1) * take;

    const [facturas, retenciones, docsOtros] = await Promise.all([
      (tipo === 'todos' || tipo === 'facturas') ? prisma.facturas_compra.findMany({
        where: { empresaId, origenRegistro: 'BUZON_SRI' },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, numeroFactura: true, razonSocialProveedor: true, fechaEmision: true, importeTotal: true, createdAt: true },
      }) : Promise.resolve([]),
      (tipo === 'todos' || tipo === 'retenciones') ? prisma.retenciones_recibidas.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, claveAcceso: true, razonSocialAgente: true, fechaEmision: true, totalRetencionIva: true, totalRetencionRenta: true, createdAt: true },
      }) : Promise.resolve([]),
      (tipo === 'todos' || tipo === 'otros') ? prisma.docs_recibidos_otros.findMany({
        where: { empresaId },
        orderBy: { createdAt: 'desc' },
        take: tipo === 'todos' ? 10 : take,
        select: { id: true, claveAcceso: true, tipoDescripcion: true, razonSocialEmisor: true, fechaEmision: true, importeTotal: true, createdAt: true },
      }) : Promise.resolve([]),
    ]);

    res.json({
      success: true,
      data: { facturas, retenciones, docsOtros },
    });
  } catch (error) {
    console.error('Error en /buzon/historial:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener el historial' });
  }
});

// ─── GET /sri/screenshot ─────────────────────────────────────
// Diagnóstico visual: captura lo que ve Puppeteer/Chromium en el portal SRI.
// Devuelve { screenshot (base64), url, title, inputs[], buttons[] }
// IMPORTANTE: usa waitUntil:'commit' para no colgarse si el portal no dispara
// domcontentloaded, y un Promise.race de 45 s para responder antes del timeout
// del proxy de Railway (evita el CORS error por 499).
router.get('/sri/screenshot', async (req, res) => {
  const TIMEOUT_MS = 45_000;

  const capturar = async () => {
    let browser;
    try {
      const puppeteer = require('puppeteer');
      const { execSync } = require('child_process');
      const nodePath = require('path');

      const raw = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
      let execPath = null;
      if (raw) {
        execPath = nodePath.isAbsolute(raw) ? raw : (() => {
          try { return execSync(`which "${raw}" 2>/dev/null`, { timeout: 3000, encoding: 'utf8' }).trim() || raw; }
          catch { return raw; }
        })();
      }

      const opts = {
        headless: true,
        args: [
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
          '--disable-gpu', '--no-proxy-server', '--ignore-certificate-errors',
          '--disable-extensions', '--window-size=1280,800',
        ],
        defaultViewport: { width: 1280, height: 800 },
        timeout: 30000,
      };
      if (execPath) opts.executablePath = execPath;

      browser = await puppeteer.launch(opts);
      const page = await browser.newPage();
      // Timeouts individuales cortos para no colgarse en ninguna operación
      page.setDefaultNavigationTimeout(15000);
      page.setDefaultTimeout(10000);
      page.on('requestfailed', () => {});
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-EC,es;q=0.9' });

      // ── Test 1: example.com para verificar si Chrome tiene red ──
      let exampleOk = false;
      let exampleUrl = '';
      const pageEx = await browser.newPage();
      pageEx.setDefaultNavigationTimeout(12000);
      await pageEx.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 12000 })
        .then(() => { exampleOk = true; exampleUrl = pageEx.url(); })
        .catch(() => {});
      await pageEx.close().catch(() => {});

      // ── Test 2: navegar al portal SRI, capturando el error ────
      let gotoError = null;
      await page.goto('https://srienlinea.sri.gob.ec/', {
        waitUntil: 'domcontentloaded', timeout: 15000,
      }).catch((err) => { gotoError = err.message || String(err); });

      // Dar tiempo al JS para renderizar (JSF/Angular pueden tardar)
      await new Promise((r) => setTimeout(r, 3000));

      const url   = page.url();
      const title = await page.title().catch(() => '');

      const inputs = await page.$$eval('input', (els) => els.map((e) => ({
        type: e.type, id: e.id, name: e.name,
        class: (e.className || '').substring(0, 100),
        placeholder: e.placeholder,
        visible: e.offsetParent !== null,
      }))).catch(() => []);

      const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) => els.map((e) => ({
        tag: e.tagName, type: e.type || '',
        id: e.id, name: e.name || '',
        text: (e.textContent || e.value || '').trim().substring(0, 80),
        visible: e.offsetParent !== null,
      }))).catch(() => []);

      const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false }).catch(() => null);

      return { success: true, url, title, inputs, buttons, screenshot, gotoError, exampleOk, exampleUrl };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  };

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout 45s: el navegador no respondió. Puede que Railway no alcance el portal SRI con Puppeteer.')), TIMEOUT_MS)
  );

  try {
    const resultado = await Promise.race([capturar(), timeoutPromise]);
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /sri/diagnostico ────────────────────────────────────
router.get('/sri/diagnostico', async (req, res) => {
  const resultado = { timestamp: new Date().toISOString(), checks: [] };

  // 1. Verificar portal JSF (URL real confirmada 2026-06-02)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const resp = await fetch('https://srienlinea.sri.gob.ec/', {
      method: 'GET',
      headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0' },
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    const ct = resp.headers.get('content-type') || '';
    resultado.checks.push({
      tipo: 'SRI-Portal',
      url:  'https://srienlinea.sri.gob.ec/',
      status: resp.status,
      ok:   resp.ok || resp.status < 500,
      nota: resp.ok
        ? 'Portal accesible — scraping disponible'
        : `HTTP ${resp.status}`,
    });
  } catch (err) {
    resultado.checks.push({ tipo: 'SRI-Portal', url: 'https://srienlinea.sri.gob.ec/', ok: false, error: err.message });
  }

  // 2. Verificar API móvil SRI (estaba activa, actualmente retorna 404)
  const apiUrl = 'https://srienlinea.sri.gob.ec/movil-servicios/api/v2.0/contribuyente/login';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json',
                 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 12)', 'X-Requested-With': 'ec.gob.sri.sri_movil' },
      body: JSON.stringify({ user: 'test', password: 'test' }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    const ct = resp.headers.get('content-type') || '';
    resultado.checks.push({
      tipo: 'SRI-API-Movil', url: apiUrl,
      status: resp.status,
      ok: resp.status === 401 || resp.status === 200,
      nota: resp.status === 401 ? 'API activa (401=credenciales incorrectas esperado)' :
            resp.status === 404 ? 'API desactivada por el SRI (404) — solo scraping disponible' :
            `HTTP ${resp.status}`,
    });
  } catch (err) {
    resultado.checks.push({ tipo: 'SRI-API-Movil', url: apiUrl, ok: false, error: err.message });
  }

  // 3. Verificar Chrome/Puppeteer
  try {
    const { execSync } = require('child_process');
    const chromiumPath = process.env.PUPPETEER_EXECUTABLE_PATH || 'chromium';
    let pathResuelto = chromiumPath;
    try { pathResuelto = execSync(`which "${chromiumPath}"`, { timeout: 3000, encoding: 'utf8' }).trim(); } catch {}
    const version = execSync(`"${pathResuelto}" --version --no-sandbox 2>&1 || echo "ERROR"`,
      { timeout: 5000, encoding: 'utf8' }).trim();
    resultado.checks.push({ tipo: 'Chrome', path: pathResuelto, version, ok: !version.includes('ERROR') });
  } catch (err) {
    resultado.checks.push({ tipo: 'Chrome', ok: false, error: err.message });
  }

  res.json({ success: true, data: resultado });
});

// ─── GET /sri/job/:jobId ────────────────────────────────────
// Polling del estado de un job de scraper iniciado con POST /sri/consultar.
// Devuelve { status: 'pending'|'done'|'error', ... }
router.get('/sri/job/:jobId', (req, res) => {
  // Evitar caché HTTP (304 Not Modified) para que el frontend siempre reciba el estado actual
  res.set('Cache-Control', 'no-store');
  const job = SCRAPER_JOBS.get(req.params.jobId);
  if (!job) return res.status(404).json({ success: false, mensaje: 'Job no encontrado o expirado' });
  if (job.status === 'pending') return res.json({ status: 'pending', mensaje: job.mensaje });
  if (job.status === 'done')    return res.json({ status: 'done', ...job.result });
  return res.status(422).json({ status: 'error', success: false, mensaje: job.error, erroresConsulta: job.erroresConsulta });
});

// ─── POST /sri/consultar ────────────────────────────────────
// Inicia un job async para evitar el timeout de 60 s del proxy de Railway.
// Responde de inmediato con { jobId, status: 'pending' }.
// El frontend hace polling a GET /sri/job/:jobId cada 3 s.
router.post('/sri/consultar', async (req, res) => {
  const {
    identificacion,
    password,
    fechaDesde,
    fechaHasta,
    tipoComprobante = 'TODOS',
    metodo = 'auto',
  } = req.body || {};

  const errorValidacion = validarPayloadConsultaSri({ identificacion, password, fechaDesde, fechaHasta });
  if (errorValidacion) return res.status(400).json({ success: false, mensaje: errorValidacion });

  const empresaId = req.empresa.id;
  const payload   = { identificacion, password, fechaDesde, fechaHasta, tipoComprobante };
  const metodos   = metodo === 'portal' ? ['portal'] : metodo === 'scraper' ? ['scraper'] : ['scraper', 'portal'];

  // Responder de inmediato con jobId para no exceder el timeout del proxy
  const jobId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  SCRAPER_JOBS.set(jobId, { status: 'pending', startedAt: Date.now(), mensaje: 'Iniciando navegador...' });
  _limpiarJobsViejos();
  res.json({ jobId, status: 'pending' });

  // ── Ejecutar el scraper en background ──────────────────────
  (async () => {
    const get    = () => SCRAPER_JOBS.get(jobId) || {};
    const update = (patch) => SCRAPER_JOBS.set(jobId, { ...get(), ...patch });
    const erroresConsulta = [];

    for (const metodoConsulta of metodos) {
      try {
        update({ mensaje: metodoConsulta === 'scraper' ? 'Navegando portal SRI...' : 'Consultando API del SRI...' });
        const docsPortal = metodoConsulta === 'scraper'
          ? await obtenerRecibidosScraper(payload)
          : await obtenerRecibidosPortalRest(payload);
        const respuesta = await armarRespuestaConsultaRecibidos(empresaId, docsPortal);
        update({ status: 'done', result: { ...respuesta, metodo: metodoConsulta } });
        setTimeout(() => SCRAPER_JOBS.delete(jobId), 15 * 60 * 1000);
        return;
      } catch (err) {
        erroresConsulta.push({ metodo: metodoConsulta, mensaje: err.message });
        if (esErrorCredencialesSri(err)) break;
      }
    }

    const ultimoError  = erroresConsulta[erroresConsulta.length - 1];
    const mensajeBase  = ultimoError?.mensaje || 'No se pudo consultar el portal SRI';
    const mensajeFinal = erroresConsulta.length > 1
      ? `${mensajeBase} También falló el respaldo (${erroresConsulta[0].metodo}: ${erroresConsulta[0].mensaje}).`
      : mensajeBase;
    update({ status: 'error', error: mensajeFinal, erroresConsulta });
    setTimeout(() => SCRAPER_JOBS.delete(jobId), 15 * 60 * 1000);
  })();
});

// ─── POST /sri-portal/consultar ─────────────────────────────
// Autentica en el portal SRI y devuelve los comprobantes
// recibidos en el rango de fechas indicado, sin importarlos.
router.post('/sri-portal/consultar', async (req, res) => {
  try {
    const {
      identificacion,
      password,
      fechaDesde,
      fechaHasta,
      tipoComprobante = 'TODOS',
    } = req.body || {};

    const errorValidacion = validarPayloadConsultaSri({ identificacion, password, fechaDesde, fechaHasta });
    if (errorValidacion) return res.status(400).json({ success: false, mensaje: errorValidacion });

    const empresaId = req.empresa.id;

    let docsPortal;
    try {
      docsPortal = await obtenerRecibidosPortalRest({ identificacion, password, fechaDesde, fechaHasta, tipoComprobante });
    } catch (err) {
      // IMPORTANTE: usar 422/502, NO 401. El 401 dispara el interceptor axios
      // de la app y desloguea al usuario de AELA.
      return res.status(statusErrorConsultaSri(err)).json({ success: false, mensaje: err.message });
    }

    if (docsPortal.length === 0) {
      return res.json({ success: true, total: 0, resultados: [] });
    }

    const respuesta = await armarRespuestaConsultaRecibidos(empresaId, docsPortal);
    res.json({ ...respuesta, metodo: 'portal' });
  } catch (error) {
    console.error('Error en /buzon/sri-portal/consultar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar el portal SRI' });
  }
});

// ─── POST /sri-scraper/consultar ────────────────────────────
// Usa Puppeteer para autenticarse en el portal SRI y devolver
// la lista de comprobantes recibidos en el rango de fechas.
// NO importa — solo hace preview para confirmación.
router.post('/sri-scraper/consultar', async (req, res) => {
  try {
    const {
      identificacion,
      password,
      fechaDesde,
      fechaHasta,
      tipoComprobante = 'TODOS',
    } = req.body || {};

    const errorValidacion = validarPayloadConsultaSri({ identificacion, password, fechaDesde, fechaHasta });
    if (errorValidacion) return res.status(400).json({ success: false, mensaje: errorValidacion });

    const empresaId = req.empresa.id;

    let docsPortal;
    try {
      docsPortal = await obtenerRecibidosScraper({ identificacion, password, fechaDesde, fechaHasta, tipoComprobante });
    } catch (err) {
      return res.status(422).json({ success: false, mensaje: err.message });
    }

    if (docsPortal.length === 0) {
      return res.json({ success: true, total: 0, resultados: [] });
    }

    const respuesta = await armarRespuestaConsultaRecibidos(empresaId, docsPortal);
    res.json({ ...respuesta, metodo: 'scraper' });
  } catch (error) {
    console.error('Error en /buzon/sri-scraper/consultar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar el portal SRI vía scraper' });
  }
});

// ─── POST /sri-scraper/importar ──────────────────────────────
// Scraping + importación directa en un solo paso.
// Autentica en SRI, obtiene los docs del rango, descarga XMLs e importa.
router.post('/sri-scraper/importar', async (req, res) => {
  try {
    const {
      identificacion,
      password,
      fechaDesde,
      fechaHasta,
      tipoComprobante = 'TODOS',
      opciones = {},
    } = req.body || {};

    if (!identificacion || !password) {
      return res.status(400).json({ success: false, mensaje: 'Se requiere identificación y contraseña del portal SRI' });
    }
    if (!fechaDesde || !fechaHasta) {
      return res.status(400).json({ success: false, mensaje: 'Se requiere rango de fechas' });
    }

    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;

    // 1. Obtener lista de claves via scraper
    let docsPortal;
    try {
      docsPortal = await obtenerRecibidosScraper({ identificacion, password, fechaDesde, fechaHasta, tipoComprobante });
    } catch (err) {
      return res.status(422).json({ success: false, mensaje: err.message });
    }

    if (docsPortal.length === 0) {
      return res.json({ success: true, resumen: { creados: 0, omitidos: 0, errores: 0 }, resultados: [] });
    }

    // 2. Filtrar los que ya existen
    const porImportar = [];
    for (const doc of docsPortal) {
      const tipo = detectarTipoDesdeClaveAcceso(doc.claveAcceso);
      if (!tipo) continue;
      const existe = await yaExisteEnBd(empresaId, doc.claveAcceso, tipo.cod);
      if (!existe) porImportar.push({ clave: doc.claveAcceso, tipo });
    }

    // 3. Importar cada documento
    const resultados = [];
    for (const { clave, tipo } of porImportar) {
      try {
        const respSRI = await obtenerXmlDesdeAutorizacion(clave);
        const resultado = await prisma.$transaction(async (tx) =>
          importarDocumentoRecibido({
            tx, empresaId, usuarioId,
            tipoDoc: tipo.cod,
            xmlAutorizado: respSRI.xml,
            xmlEnvuelto: respSRI.xml,
            claveAcceso: clave,
            numeroAutorizacion: respSRI.numeroAutorizacion || clave,
            fechaAutorizacion: null,
            opcionesFactura: opciones,
          })
        );
        resultados.push({ clave, tipo: tipo.nombre, estado: resultado.accion, id: resultado.id });
      } catch (err) {
        console.error(`[Scraper importar] Error en ${clave}:`, err.message);
        resultados.push({ clave, tipo: tipo.nombre, estado: 'error', error: err.message });
      }
    }

    // Omitidos = los que ya existían (total - los que intentamos importar)
    const omitidos = docsPortal.length - porImportar.length;
    const creados  = resultados.filter((r) => r.estado === 'creado').length;
    const errores  = resultados.filter((r) => r.estado === 'error').length;

    res.json({
      success: true,
      resumen: { total: docsPortal.length, creados, omitidos, errores },
      resultados,
    });
  } catch (error) {
    console.error('Error en /buzon/sri-scraper/importar:', error);
    res.status(500).json({ success: false, mensaje: 'Error en la importación automática desde el SRI' });
  }
});

module.exports = router;
