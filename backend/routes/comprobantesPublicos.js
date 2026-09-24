// ====================================
// routes/comprobantesPublicos.js — AELA
// Consulta y descarga pública de facturas electrónicas — SIN autenticación,
// para que el cliente FINAL de un tenant (quien recibió la factura) pueda
// bajar de nuevo su PDF/XML sin depender del portal del SRI ni de haber
// guardado el correo original. Mismo patrón que menuPublico.js: el tenant
// se resuelve por X-Tenant-Slug (resolverTenant, montado global en app.js),
// el frontend público lo lee de la URL, no de una sesión logueada.
//
// Verificación de identidad: el cliente debe conocer SU PROPIA
// identificación (RUC/cédula, tal como quedó en la factura) Y el número de
// factura exacto — dos datos que solo tendría quien de verdad recibió esa
// factura. No se expone nada por solo un ID numérico secuencial.
// ====================================
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const prisma  = require('../config/prisma');
const sri     = require('../utils/sri');

async function getConfigSRI(empresaId, db) {
  return db.configuracion_sri.findFirst({ where: { empresaId, activo: true } });
}

// Rate limit básico en memoria por IP — este endpoint es público y busca
// por datos que un atacante podría intentar adivinar por fuerza bruta
// (números de factura son consecutivos). No sustituye un WAF, pero frena
// un scraping trivial sin agregar una dependencia nueva.
const intentos = new Map(); // ip -> { count, resetAt }
const LIMITE_INTENTOS = 10;
const VENTANA_MS = 10 * 60 * 1000;

function rateLimitBasico(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'desconocida';
  const ahora = Date.now();
  const registro = intentos.get(ip);
  if (!registro || ahora > registro.resetAt) {
    intentos.set(ip, { count: 1, resetAt: ahora + VENTANA_MS });
    return next();
  }
  if (registro.count >= LIMITE_INTENTOS) {
    return res.status(429).json({ success: false, mensaje: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  }
  registro.count += 1;
  next();
}

// Busca la factura que coincide EXACTO con identificación + número — usado
// tanto por /buscar (mostrar los datos antes de descargar) como por
// /pdf y /xml (hay que re-verificar en cada descarga, no solo confiar en
// el :id de la URL, o cualquiera podría enumerar facturas ajenas).
async function buscarFacturaPublica(db, { identificacion, numeroFactura }) {
  const idNorm = String(identificacion || '').trim();
  const numNorm = String(numeroFactura || '').trim();
  if (!idNorm || !numNorm) return null;
  return db.facturas.findFirst({
    where: {
      identificacionComprador: idNorm,
      numeroFactura: numNorm,
      estadoSri: 'AUTORIZADO',
      anulada: false,
    },
  });
}

// POST /api/comprobantes-publicos/buscar
router.post('/buscar', rateLimitBasico, async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const { identificacion, numeroFactura } = req.body || {};
    if (!identificacion || !numeroFactura) {
      return res.status(400).json({ success: false, mensaje: 'Ingresa tu RUC/cédula y el número de factura' });
    }

    const factura = await buscarFacturaPublica(db, { identificacion, numeroFactura });
    if (!factura) {
      return res.status(404).json({
        success: false,
        mensaje: 'No encontramos ninguna factura autorizada con esos datos. Verifica el RUC/cédula del comprador y el número exacto (ej. 001-001-000123456).',
      });
    }

    res.json({
      success: true,
      data: {
        numeroFactura: factura.numeroFactura,
        fechaEmision: factura.fechaEmision,
        importeTotal: factura.importeTotal,
        razonSocialEmisor: factura.razonSocialEmisor,
        razonSocialComprador: factura.razonSocialComprador,
      },
    });
  } catch (error) {
    console.error('POST /comprobantes-publicos/buscar:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo realizar la búsqueda' });
  }
});

// GET /api/comprobantes-publicos/pdf?identificacion=...&numeroFactura=...
router.get('/pdf', rateLimitBasico, async (req, res) => {
  const outPath = path.join(os.tmpdir(), `factura-publica-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`);
  try {
    const db = req.prisma || prisma;
    const factura = await buscarFacturaPublica(db, req.query);
    if (!factura) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });

    const config = await getConfigSRI(factura.empresaId, db);
    const enlacePublico = sri.construirEnlacePublicoFactura({ tenantSlug: req.tenant?.slug, numeroFactura: factura.numeroFactura });
    await sri.generarRIDEFactura(factura, config || {}, outPath, { enlacePublico });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${factura.numeroFactura}.pdf"`);
    const lectura = fs.createReadStream(outPath);
    lectura.pipe(res);
    lectura.on('end', () => { try { fs.unlinkSync(outPath); } catch { /* noop */ } });
    lectura.on('error', () => {
      try { fs.unlinkSync(outPath); } catch { /* noop */ }
      if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'No se pudo generar el PDF' });
    });
  } catch (error) {
    try { fs.unlinkSync(outPath); } catch { /* noop */ }
    console.error('GET /comprobantes-publicos/pdf:', error);
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'No se pudo generar el PDF' });
  }
});

// GET /api/comprobantes-publicos/xml?identificacion=...&numeroFactura=...
router.get('/xml', rateLimitBasico, async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const factura = await buscarFacturaPublica(db, req.query);
    if (!factura) return res.status(404).json({ success: false, mensaje: 'Factura no encontrada' });

    const xml = factura.xmlAutorizado || factura.xmlFirmado || factura.xmlGenerado;
    if (!xml) return res.status(404).json({ success: false, mensaje: 'Esta factura todavía no tiene XML autorizado disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${factura.numeroFactura}.xml"`);
    res.send(xml);
  } catch (error) {
    console.error('GET /comprobantes-publicos/xml:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo descargar el XML' });
  }
});

module.exports = router;
