// ====================================
// RUTAS: PROFORMAS (Cotizaciones / Presupuestos)
// backend/routes/proformas.js
// ====================================

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const os       = require('os');
const nodePath = require('path');
const { proteger, permitir } = require('../middleware/auth');
const { normalizarRol }      = require('../utils/roles');
const prisma                 = require('../config/prisma');
const { enviarConFallback }  = require('../utils/email');

// ─── Helper: generar HTML de la proforma (para PDF y email adjunto) ───────────
function _htmlProforma(p, empresaNombre) {
  const detalles = Array.isArray(p.detalles) ? p.detalles
    : (typeof p.detalles === 'string' ? JSON.parse(p.detalles) : []);

  const fmtFecha = (d) => {
    if (!d) return '—';
    const f = new Date(d);
    return f.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const fmtMoney = (v) => `$${parseFloat(v || 0).toFixed(2)}`;

  const filas = detalles.map((d, i) => {
    const cant   = parseFloat(d.cantidad || 1);
    const precio = parseFloat(d.precioUnitario || 0);
    const desc   = parseFloat(d.descuento || 0);
    const total  = cant * precio - desc;
    return `<tr style="background:${i % 2 === 0 ? '#fff' : '#f8f7ff'}">
      <td style="padding:6px 10px;font-size:9.5pt;border-bottom:1px solid #f1f5f9">
        ${d.descripcion || ''}
        ${d.codigo ? `<br/><span style="font-size:8pt;color:#94a3b8">${d.codigo}</span>` : ''}
      </td>
      <td style="padding:6px 10px;text-align:center;font-size:9.5pt;border-bottom:1px solid #f1f5f9">${cant}</td>
      <td style="padding:6px 10px;text-align:right;font-size:9.5pt;border-bottom:1px solid #f1f5f9">${fmtMoney(precio)}</td>
      <td style="padding:6px 10px;text-align:right;font-size:9.5pt;border-bottom:1px solid #f1f5f9">${desc > 0 ? fmtMoney(desc) : '—'}</td>
      <td style="padding:6px 10px;text-align:right;font-size:9.5pt;font-weight:600;border-bottom:1px solid #f1f5f9">${fmtMoney(total)}</td>
    </tr>`;
  }).join('');

  const tieneDesc  = parseFloat(p.totalDescuento || 0) > 0;
  const tiene0     = parseFloat(p.subtotal0  || 0) > 0;
  const tiene5     = parseFloat(p.subtotal5  || 0) > 0;
  const tiene15    = parseFloat(p.subtotal15 || 0) > 0;

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family:Arial,Helvetica,sans-serif; font-size:10pt; color:#1e293b; padding:28px 36px; }
</style>
</head>
<body>
<!-- HEADER -->
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:3px solid #7c3aed;padding-bottom:14px;margin-bottom:20px">
  <tr>
    <td style="vertical-align:top">
      <div style="font-size:15pt;font-weight:bold;color:#7c3aed">${empresaNombre || 'AELA ERP'}</div>
      <div style="font-size:8.5pt;color:#64748b;margin-top:4px;line-height:1.7">
        ${p.empresaRuc ? `RUC: ${p.empresaRuc}<br/>` : ''}
        ${p.empresaDireccion ? `${p.empresaDireccion}<br/>` : ''}
        ${p.empresaEmail ? `${p.empresaEmail}` : ''}
      </div>
    </td>
    <td style="text-align:right;vertical-align:top">
      <div style="font-size:14pt;font-weight:bold;color:#7c3aed">PROFORMA</div>
      <div style="font-size:11pt;font-weight:600;margin-top:4px">${p.numero || ''}</div>
      <div style="display:inline-block;background:#7c3aed;color:#fff;padding:2px 10px;border-radius:12px;font-size:8.5pt;margin-top:6px">${p.estado || 'BORRADOR'}</div>
      <div style="font-size:8.5pt;color:#64748b;margin-top:6px">Fecha: ${fmtFecha(p.createdAt)}</div>
    </td>
  </tr>
</table>

<!-- CLIENTE -->
<div style="margin-bottom:16px">
  <div style="font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:#7c3aed;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:10px">Cliente</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="width:50%;padding-right:12px">
        <div style="font-size:8pt;color:#94a3b8;text-transform:uppercase;margin-bottom:2px">Razón Social</div>
        <div style="font-size:10.5pt;font-weight:600">${p.razonSocial || 'CONSUMIDOR FINAL'}</div>
      </td>
      <td style="width:25%;padding-right:12px">
        <div style="font-size:8pt;color:#94a3b8;text-transform:uppercase;margin-bottom:2px">Identificación</div>
        <div style="font-size:10pt">${p.tipoIdentificacion === '07' ? '—' : (p.identificacion || '—')}</div>
      </td>
      <td style="width:25%">
        <div style="font-size:8pt;color:#94a3b8;text-transform:uppercase;margin-bottom:2px">Teléfono</div>
        <div style="font-size:10pt">${p.telefono || '—'}</div>
      </td>
    </tr>
    ${p.direccion ? `<tr><td colspan="3" style="padding-top:8px">
      <div style="font-size:8pt;color:#94a3b8;text-transform:uppercase;margin-bottom:2px">Dirección</div>
      <div style="font-size:10pt">${p.direccion}</div>
    </td></tr>` : ''}
  </table>
</div>

<!-- DETALLE PRODUCTOS -->
<div style="margin-bottom:16px">
  <div style="font-size:8.5pt;font-weight:bold;text-transform:uppercase;color:#7c3aed;letter-spacing:0.5px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:10px">Detalle de productos / servicios</div>
  <table width="100%" cellpadding="0" cellspacing="0">
    <thead>
      <tr style="background:#7c3aed">
        <th style="padding:7px 10px;color:#fff;font-size:9pt;text-align:left;font-weight:600">Descripción</th>
        <th style="padding:7px 10px;color:#fff;font-size:9pt;text-align:center;font-weight:600;width:60px">Cant.</th>
        <th style="padding:7px 10px;color:#fff;font-size:9pt;text-align:right;font-weight:600;width:90px">P. Unit.</th>
        <th style="padding:7px 10px;color:#fff;font-size:9pt;text-align:right;font-weight:600;width:80px">Desc.</th>
        <th style="padding:7px 10px;color:#fff;font-size:9pt;text-align:right;font-weight:600;width:90px">Total</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
</div>

<!-- TOTALES -->
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
  <tr>
    <td></td>
    <td style="width:240px">
      ${tiene0  ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt"><span style="color:#64748b">Subtotal 0%</span><span>${fmtMoney(p.subtotal0)}</span></div>` : ''}
      ${tiene5  ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt"><span style="color:#64748b">Subtotal 5%</span><span>${fmtMoney(p.subtotal5)}</span></div>` : ''}
      ${tiene15 ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt"><span style="color:#64748b">Subtotal 15%</span><span>${fmtMoney(p.subtotal15)}</span></div>` : ''}
      ${tieneDesc ? `<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt"><span style="color:#64748b">Descuento</span><span>-${fmtMoney(p.totalDescuento)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:3px 0;font-size:9.5pt"><span style="color:#64748b">IVA</span><span>${fmtMoney(p.totalIva)}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13pt;font-weight:bold;color:#7c3aed;border-top:2px solid #7c3aed;margin-top:4px">
        <span>TOTAL</span><span>${fmtMoney(p.importeTotal)}</span>
      </div>
    </td>
  </tr>
</table>

<!-- VIGENCIA Y CONDICIONES -->
${(p.vigenciaDesde || p.vigenciaHasta || p.formaPago || p.formapago) ? `
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px">
  <tr>
    ${p.vigenciaDesde || p.vigenciaHasta ? `
    <td style="width:50%;padding-right:12px">
      <div style="background:#f8f7ff;border-left:3px solid #7c3aed;padding:10px 14px;border-radius:0 6px 6px 0">
        <div style="font-size:8.5pt;font-weight:bold;color:#7c3aed;margin-bottom:4px">Vigencia</div>
        <div style="font-size:10pt">${fmtFecha(p.vigenciaDesde)} al ${fmtFecha(p.vigenciaHasta)}</div>
      </div>
    </td>` : '<td></td>'}
    ${(p.formaPago || p.formapago) ? `
    <td style="width:50%">
      <div style="background:#f8f7ff;border-left:3px solid #7c3aed;padding:10px 14px;border-radius:0 6px 6px 0">
        <div style="font-size:8.5pt;font-weight:bold;color:#7c3aed;margin-bottom:4px">Forma de pago</div>
        <div style="font-size:10pt;font-weight:600">${p.formaPago || p.formapago}</div>
      </div>
    </td>` : '<td></td>'}
  </tr>
</table>` : ''}

<!-- OBSERVACIONES -->
${p.observaciones ? `
<div style="background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:14px">
  <div style="font-size:8.5pt;font-weight:bold;color:#b45309;margin-bottom:4px">Observaciones / Condiciones</div>
  <div style="font-size:10pt;color:#1e293b">${p.observaciones}</div>
</div>` : ''}

<!-- FOOTER -->
<table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;padding-top:10px;margin-top:8px">
  <tr>
    <td style="font-size:8.5pt;color:#94a3b8">Documento generado por AELA ERP · CorpSimtelec</td>
    <td style="text-align:right;font-size:8.5pt;color:#94a3b8">${p.numero} · ${fmtFecha(p.createdAt)}</td>
  </tr>
</table>
</body>
</html>`;
}

// ─── Helper: generar PDF Buffer con Puppeteer ─────────────────────────────────
async function _generarPdfBuffer(htmlContent) {
  const puppeteer = require('puppeteer');
  const { execSync } = require('child_process');

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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-gpu', '--no-zygote', '--no-proxy-server'],
    timeout: 30000,
  };
  if (execPath) opts.executablePath = execPath;

  let browser;
  try {
    browser = await puppeteer.launch(opts);
    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdf;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Todas las rutas requieren autenticación
router.use(proteger);

// Fallback: en modo monoempresa (sin tenant resuelto) req.prisma es undefined;
// usar el proxy global que apunta a DATABASE_URL
router.use((req, _res, next) => { if (!req.prisma) req.prisma = prisma; next(); });

// ─── Helper: siguiente secuencial ────────────────────────────────────────────
async function siguienteSecuencial(prisma, empresaId) {
  const last = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX("secuencial"), 0) + 1 AS next FROM proformas WHERE "empresaId" = $1`,
    empresaId
  );
  return parseInt(last[0]?.next || 1, 10);
}

function formatNumero(sec) {
  return `PRF-001-${String(sec).padStart(9, '0')}`;
}

function calcularTotales(detalles) {
  let sub0 = 0, sub5 = 0, sub15 = 0, totalDesc = 0, totalIva = 0;
  for (const d of detalles) {
    const cant   = parseFloat(d.cantidad)       || 0;
    const precio = parseFloat(d.precioUnitario) || 0;
    const desc   = parseFloat(d.descuento)      || 0;
    const iva    = parseInt(d.ivaPorcentaje)    || 0;
    const sub    = cant * precio - desc;
    totalDesc += desc;
    if (iva === 0 || iva === 6 || iva === 7) sub0  += sub;
    if (iva === 5)  sub5  += sub;
    if (iva === 15) sub15 += sub;
    if (iva === 5)  totalIva += sub * 0.05;
    if (iva === 15) totalIva += sub * 0.15;
  }
  return {
    subtotal0:      parseFloat(sub0.toFixed(2)),
    subtotal5:      parseFloat(sub5.toFixed(2)),
    subtotal15:     parseFloat(sub15.toFixed(2)),
    totalDescuento: parseFloat(totalDesc.toFixed(2)),
    totalIva:       parseFloat(totalIva.toFixed(2)),
    importeTotal:   parseFloat((sub0 + sub5 + sub15 + totalIva).toFixed(2)),
  };
}

// ─── GET / — listar proformas con filtros ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { estado, q, desde, hasta, page = 1, limit = 25 } = req.query;
    const empresaId = req.empresa.id;
    const offset    = (parseInt(page) - 1) * parseInt(limit);

    let where = `WHERE p."empresaId" = $1`;
    const params = [empresaId];
    let i = 2;

    if (estado) { where += ` AND p.estado = $${i++}`; params.push(estado); }
    if (q)      { where += ` AND (p."razonSocial" ILIKE $${i} OR p.numero ILIKE $${i})`; params.push(`%${q}%`); i++; }
    if (desde)  { where += ` AND p."createdAt" >= $${i++}`; params.push(desde); }
    if (hasta)  { where += ` AND p."createdAt" <= $${i++}`; params.push(hasta); }

    const countSql = `SELECT COUNT(*) FROM proformas p ${where}`;
    const dataSql  = `
      SELECT p.id, p.numero, p."razonSocial", p."identificacion",
             p."importeTotal", p.estado, p."vigenciaHasta", p."createdAt", p."facturaId"
      FROM proformas p ${where}
      ORDER BY p."createdAt" DESC
      LIMIT $${i} OFFSET $${i+1}
    `;
    params.push(parseInt(limit), offset);

    const [countRes, dataRes] = await Promise.all([
      req.prisma.$queryRawUnsafe(countSql, ...params.slice(0, i - 1)),
      req.prisma.$queryRawUnsafe(dataSql,  ...params),
    ]);

    res.json({
      ok: true,
      data:  dataRes,
      total: parseInt(countRes[0]?.count || 0),
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('[proformas] GET /', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al listar proformas' });
  }
});

// ─── POST / — crear proforma ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      tipoIdentificacion = '07',
      identificacion     = '9999999999999',
      razonSocial,
      direccion, email, telefono, clienteId,
      detalles = [],
      observaciones,
      vigenciaDesde, vigenciaHasta,
      formaPago,
    } = req.body;

    if (!razonSocial?.trim()) return res.status(400).json({ ok: false, mensaje: 'Razón social requerida' });
    if (!detalles.length)     return res.status(400).json({ ok: false, mensaje: 'Debe incluir al menos un detalle' });

    const empresaId = req.empresa.id;
    const totales   = calcularTotales(detalles);
    const sec       = await siguienteSecuencial(req.prisma, empresaId);
    const numero    = formatNumero(sec);

    const [row] = await req.prisma.$queryRawUnsafe(`
      INSERT INTO proformas (
        "empresaId", "numero", "secuencial",
        "tipoIdentificacion", "identificacion", "razonSocial",
        "direccion", "email", "telefono", "clienteId",
        "subtotal0", "subtotal5", "subtotal15",
        "totalDescuento", "totalIva", "importeTotal",
        "detalles", "observaciones",
        "vigenciaDesde", "vigenciaHasta",
        "estado", "creadoPor", "formaPago"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::timestamp,$20::timestamp,$21,$22,$23
      ) RETURNING *
    `,
      empresaId, numero, sec,
      tipoIdentificacion, identificacion, razonSocial.trim(),
      direccion || null, email || null, telefono || null, clienteId || null,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      vigenciaDesde || null, vigenciaHasta || null,
      'BORRADOR', req.usuario.id, formaPago || null,
    );

    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] POST /', err.message, err.stack);
    res.status(500).json({ ok: false, mensaje: err.message || 'Error al crear proforma' });
  }
});

// ─── GET /:id — detalle ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [row] = await req.prisma.$queryRawUnsafe(
      `SELECT * FROM proformas WHERE id = $1 AND "empresaId" = $2`,
      parseInt(req.params.id), req.empresa.id
    );
    if (!row) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al obtener proforma' });
  }
});

// ─── PUT /:id — editar (solo BORRADOR o ENVIADA) ──────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id        = parseInt(req.params.id);

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual)                                                  return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (!['BORRADOR', 'ENVIADA'].includes(actual.estado))        return res.status(400).json({ ok: false, mensaje: `No se puede editar una proforma en estado ${actual.estado}` });

    const {
      tipoIdentificacion, identificacion, razonSocial,
      direccion, email, telefono, clienteId,
      detalles = [], observaciones, vigenciaDesde, vigenciaHasta,
      formaPago,
    } = req.body;

    if (!razonSocial?.trim()) return res.status(400).json({ ok: false, mensaje: 'Razón social requerida' });
    if (!detalles.length)     return res.status(400).json({ ok: false, mensaje: 'Debe incluir al menos un detalle' });

    const totales = calcularTotales(detalles);

    const [row] = await req.prisma.$queryRawUnsafe(`
      UPDATE proformas SET
        "tipoIdentificacion" = $3, "identificacion" = $4, "razonSocial" = $5,
        "direccion" = $6, "email" = $7, "telefono" = $8, "clienteId" = $9,
        "subtotal0" = $10, "subtotal5" = $11, "subtotal15" = $12,
        "totalDescuento" = $13, "totalIva" = $14, "importeTotal" = $15,
        "detalles" = $16::jsonb, "observaciones" = $17,
        "vigenciaDesde" = $18::timestamp, "vigenciaHasta" = $19::timestamp,
        "formaPago" = $20, "updatedAt" = NOW()
      WHERE id = $1 AND "empresaId" = $2
      RETURNING *
    `,
      id, empresaId,
      tipoIdentificacion, identificacion, razonSocial.trim(),
      direccion || null, email || null, telefono || null, clienteId || null,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      vigenciaDesde || null, vigenciaHasta || null,
      formaPago || null,
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] PUT /:id', err.message, err.stack);
    res.status(500).json({ ok: false, mensaje: err.message || 'Error al actualizar proforma' });
  }
});

// ─── POST /:id/estado — cambiar estado (enviar, aceptar, rechazar) ────────────
router.post('/:id/estado', async (req, res) => {
  try {
    const { nuevoEstado } = req.body;
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    const TRANSICIONES = {
      BORRADOR: ['ENVIADA'],
      ENVIADA:  ['ACEPTADA', 'RECHAZADA'],
    };

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const permitidos = TRANSICIONES[actual.estado] || [];
    if (!permitidos.includes(nuevoEstado)) {
      return res.status(400).json({ ok: false, mensaje: `No se puede cambiar de ${actual.estado} a ${nuevoEstado}` });
    }

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = $3, "updatedAt" = NOW() WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId, nuevoEstado
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al cambiar estado' });
  }
});

// ─── POST /:id/marcar-convertida — marcar como CONVERTIDA con facturaId ───────
router.post('/:id/marcar-convertida', async (req, res) => {
  try {
    const { facturaId } = req.body;
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    if (!['admin', 'supervisor', 'facturador'].includes(rol)) {
      return res.status(403).json({ ok: false, mensaje: 'Sin permiso para convertir proformas' });
    }

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (['CONVERTIDA', 'ANULADA'].includes(actual.estado)) {
      return res.status(400).json({ ok: false, mensaje: `La proforma ya está en estado ${actual.estado}` });
    }

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = 'CONVERTIDA', "facturaId" = $3, "updatedAt" = NOW()
       WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId, facturaId || null
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al marcar proforma como convertida' });
  }
});

// ─── POST /:id/enviar-email — enviar proforma por correo al cliente ───────────
router.post('/:id/enviar-email', async (req, res) => {
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const { emailDestino } = req.body; // opcional: sobreescribe el email del cliente

    const [p] = await req.prisma.$queryRawUnsafe(
      `SELECT p.*, e."razonSocial" AS "razonSocialEmisor", e."nombreComercial" AS "nombreComercialEmisor"
       FROM proformas p
       LEFT JOIN empresas e ON e.id = p."empresaId"
       WHERE p.id = $1 AND p."empresaId" = $2`,
      id, empresaId
    );
    if (!p) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const destino = emailDestino || p.email;
    if (!destino) return res.status(400).json({ ok: false, mensaje: 'El cliente no tiene email registrado. Ingresa un correo manualmente.' });

    // Construir tabla de detalles en HTML
    const detalles = typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles || []);
    const filasDetalle = detalles.map(d => {
      const cant   = parseFloat(d.cantidad       || 1);
      const precio = parseFloat(d.precioUnitario || 0);
      const desc   = parseFloat(d.descuento      || 0);
      const total  = (cant * precio - desc).toFixed(2);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${d.descripcion || ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${cant}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${parseFloat(precio).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">$${total}</td>
      </tr>`;
    }).join('');

    const vigencia = p.vigenciaHasta
      ? new Date(p.vigenciaHasta).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : null;
    const emisorLabel = p.nombreComercialEmisor || p.razonSocialEmisor || 'AELA ERP';

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#7C3AED,#6d28d9);padding:36px 40px 28px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">${emisorLabel}</h1>
            <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px">AELA ERP · by CorpSimtelec</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="color:#64748b;margin:0 0 4px;font-size:14px">Estimado/a cliente,</p>
            <h2 style="color:#1e293b;margin:0 0 6px;font-size:20px;font-weight:700">
              Proforma <span style="color:#7C3AED">${p.numero}</span>
            </h2>
            <p style="color:#475569;margin:0 0 28px;font-size:14px;line-height:1.6">
              Le enviamos la cotización/presupuesto detallada a continuación.<br/>
              ${vigencia ? `Esta proforma tiene validez hasta el <strong>${vigencia}</strong>.` : ''}
            </p>
            <!-- Datos cliente -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:24px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;color:#94a3b8">Cliente</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#1e293b">${p.razonSocial || ''}</p>
                ${p.identificacion && p.tipoIdentificacion !== '07' ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b">${p.identificacion}</p>` : ''}
              </td></tr>
            </table>
            <!-- Tabla de detalles -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Descripción</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Cant.</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">P. Unit.</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Total</th>
                </tr>
              </thead>
              <tbody>${filasDetalle}</tbody>
            </table>
            <!-- Total -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td style="text-align:right;padding:4px 0;color:#64748b;font-size:13px">IVA incluido</td></tr>
              <tr><td style="text-align:right;padding:8px 0;">
                <span style="font-size:22px;font-weight:800;color:#7C3AED">TOTAL: $${parseFloat(p.importeTotal || 0).toFixed(2)}</span>
              </td></tr>
            </table>
            ${p.observaciones ? `<p style="color:#475569;font-size:13px;background:#f8fafc;padding:12px 16px;border-radius:8px;border-left:3px solid #7C3AED;margin-bottom:24px">${p.observaciones}</p>` : ''}
            <p style="color:#94a3b8;font-size:13px;margin:0">Si tiene consultas sobre esta proforma, contáctenos por los medios indicados abajo.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="color:#94a3b8;font-size:13px;margin:0 0 6px">¿Necesitas ayuda? Estamos disponibles <strong>24/7</strong>.</p>
            <p style="margin:0;font-size:13px">
              <a href="https://wa.me/5930978893520" style="color:#16a34a;font-weight:600;text-decoration:none">WhatsApp</a>
              &nbsp;·&nbsp;
              <a href="mailto:info@corpsimtelec.com" style="color:#7C3AED;font-weight:600;text-decoration:none">info@corpsimtelec.com</a>
            </p>
            <p style="color:#cbd5e1;font-size:12px;margin:14px 0 0">AELA ERP © ${new Date().getFullYear()} CorpSimtelec · Ecuador</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Generar PDF y adjuntar al email
    let pdfTmpPath = null;
    const attachments = [];
    try {
      const pdfHtml = _htmlProforma(p, emisorLabel);
      const pdfBuf  = await _generarPdfBuffer(pdfHtml);
      pdfTmpPath = nodePath.join(os.tmpdir(), `prf-${id}-${Date.now()}.pdf`);
      fs.writeFileSync(pdfTmpPath, pdfBuf);
      attachments.push({ filename: `${p.numero || 'proforma'}.pdf`, path: pdfTmpPath });
    } catch (pdfErr) {
      console.warn('[proformas] email: PDF no generado, se envía sin adjunto:', pdfErr.message);
    }

    try {
      await enviarConFallback({
        from:    process.env.SMTP_FROM || `${emisorLabel} <info@corpsimtelec.com>`,
        to:      destino,
        subject: `Proforma ${p.numero} — ${emisorLabel}`,
        html,
        attachments,
      });
    } finally {
      if (pdfTmpPath && fs.existsSync(pdfTmpPath)) fs.unlinkSync(pdfTmpPath);
    }

    res.json({ ok: true, mensaje: `Proforma enviada a ${destino}${attachments.length ? ' con PDF adjunto' : ''}` });
  } catch (err) {
    console.error('[proformas] POST /:id/enviar-email', err.message);
    const esEmailFail = /sin método|resend|smtp/i.test(err.message);
    res.status(esEmailFail ? 503 : 500).json({ ok: false, mensaje: esEmailFail ? 'No hay configuración de email activa en el servidor.' : 'Error al enviar email' });
  }
});

// ─── POST /:id/anular ─────────────────────────────────────────────────────────
router.post('/:id/anular', async (req, res) => {
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    if (!['admin', 'supervisor'].includes(rol)) {
      return res.status(403).json({ ok: false, mensaje: 'Solo admin o supervisor puede anular proformas' });
    }

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (actual.estado === 'ANULADA') return res.status(400).json({ ok: false, mensaje: 'Ya está anulada' });

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = 'ANULADA', "updatedAt" = NOW()
       WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al anular proforma' });
  }
});

// ─── GET /:id/pdf — descargar proforma como PDF ───────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;

    const [p] = await req.prisma.$queryRawUnsafe(
      `SELECT p.*, e."razonSocial" AS "razonSocialEmisor", e."nombreComercial" AS "nombreComercialEmisor",
              e.ruc AS "empresaRuc", e.direccion AS "empresaDireccion", e.email AS "empresaEmail"
       FROM proformas p
       LEFT JOIN empresas e ON e.id = p."empresaId"
       WHERE p.id = $1 AND p."empresaId" = $2`,
      id, empresaId
    );
    if (!p) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const emisorLabel = p.nombreComercialEmisor || p.razonSocialEmisor || 'AELA ERP';
    const html = _htmlProforma(p, emisorLabel);
    const pdfBuf = await _generarPdfBuffer(html);

    const nombre = `${(p.numero || 'proforma').replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.setHeader('Content-Length', pdfBuf.length);
    res.send(pdfBuf);
  } catch (err) {
    console.error('[proformas] GET /:id/pdf', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al generar PDF: ' + err.message });
  }
});

module.exports = router;
