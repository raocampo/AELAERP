/**
 * AELA — Cuentas por Cobrar (CxC)
 * Subledger de cobros contra facturas de venta. El saldo pendiente se calcula
 * al vuelo (importeTotal - suma de cobros no anulados), sin columna
 * redundante. Requiere plan Medium o Pro.
 */
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const XLSX = require('xlsx');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');

const _upload = multer({ storage: multer.memoryStorage() });
const {
  crearAsientoCobroCliente,
  crearAsientoReversoCobroCliente,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');

// ─── Helper: resolver logo (mismo patrón que sri.js / proformas.js) ──────────
function _resolverLogo(logoUrl) {
  if (!logoUrl) return { logoData: null, tienelogo: false };
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return { logoData: Buffer.from(b64, 'base64'), tienelogo: true };
    } catch { return { logoData: null, tienelogo: false }; }
  }
  const logoPath = path.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  const existe = fs.existsSync(logoPath);
  return { logoData: existe ? logoPath : null, tienelogo: existe };
}

const METODO_LABEL = { efectivo: 'Efectivo', transferencia: 'Transferencia', cheque: 'Cheque', tarjeta: 'Tarjeta' };

// ─── Genera el PDF del recibo de cobro (A4, una página) ───────────────────────
function _generarReciboCobroPdf(cobro, saldoFactura, configSri, outputPath) {
  return new Promise((resolve, reject) => {
    const cfg = configSri || {};
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 48, right: 48 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML = 48;
    const W = doc.page.width - ML * 2;
    const NEGRO = '#1e293b';
    const GRIS = '#64748b';
    const VERDE = '#22C55E';

    const fmtFecha = (d) => (d ? new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
    const fmtMoney = (v) => `$${Number(v || 0).toFixed(2)}`;

    const { logoData, tienelogo } = _resolverLogo(cfg.logoUrl);
    let y = 40;

    if (tienelogo) {
      try { doc.image(logoData, ML, y, { fit: [120, 55] }); } catch { /* logo inválido */ }
    }
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text((cfg.razonSocial || '').toUpperCase(), ML + (tienelogo ? 130 : 0), y, { width: W - (tienelogo ? 130 : 0) });
    doc.fontSize(8).font('Helvetica').fillColor(GRIS)
       .text(`RUC: ${cfg.ruc || ''}`, { width: W - (tienelogo ? 130 : 0) });
    if (cfg.dirMatriz) doc.text(cfg.dirMatriz, { width: W - (tienelogo ? 130 : 0) });
    if (cfg.telefono) doc.text(`Telf.: ${cfg.telefono}`, { width: W - (tienelogo ? 130 : 0) });
    y = Math.max(doc.y, y + 55) + 16;

    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke('#e2e8f0');
    y += 20;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(NEGRO)
       .text('RECIBO DE COBRO', ML, y, { width: W, align: 'center' });
    y += 22;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(VERDE)
       .text(`No. ${cobro.numero}`, ML, y, { width: W, align: 'center' });
    y += 24;

    const cliente = cobro.factura?.razonSocialComprador || cobro.cliente?.razonSocial || 'Consumidor final';
    const identificacion = cobro.factura?.identificacionComprador || cobro.cliente?.identificacion || '—';

    const fila = (label, valor, bold = false) => {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text(label, ML, y, { width: 140, continued: false });
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(NEGRO).text(valor, ML + 140, y, { width: W - 140 });
      y = Math.max(y + 16, doc.y + 4);
    };

    fila('Fecha:', fmtFecha(cobro.fecha));
    fila('Recibí de:', cliente, true);
    fila('Identificación:', identificacion);
    fila('Factura Nº:', cobro.factura?.numeroFactura || '—');
    fila('Concepto:', saldoFactura.esTotal ? 'Cancelación total de factura' : 'Abono a factura');

    let formaPago = METODO_LABEL[cobro.metodoPago] || cobro.metodoPago;
    if (cobro.metodoPago === 'transferencia' && cobro.banco?.nombre) formaPago += ` — ${cobro.banco.nombre}`;
    if (cobro.metodoPago === 'cheque' && cobro.cheque?.numero) formaPago += ` Nº ${cobro.cheque.numero}`;
    fila('Forma de pago:', formaPago);
    if (cobro.referencia) fila('Referencia:', cobro.referencia);

    y += 8;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke('#e2e8f0');
    y += 16;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text('Total factura:', ML, y, { width: 140 });
    doc.fontSize(9).font('Helvetica').fillColor(NEGRO).text(fmtMoney(saldoFactura.importeTotal), ML + 140, y, { width: W - 140, align: 'left' });
    y += 16;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text('Saldo pendiente:', ML, y, { width: 140 });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(saldoFactura.saldoPendiente > 0.009 ? '#EF4444' : VERDE)
       .text(fmtMoney(saldoFactura.saldoPendiente), ML + 140, y, { width: W - 140 });
    y += 26;

    doc.roundedRect(ML, y, W, 44, 6).fillAndStroke('#f0fdf4', '#bbf7d0');
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GRIS).text('MONTO RECIBIDO', ML + 16, y + 10);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(VERDE).text(fmtMoney(cobro.monto), ML, y + 8, { width: W - 16, align: 'right' });
    y += 70;

    if (cobro.observaciones) {
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`Observaciones: ${cobro.observaciones}`, ML, y, { width: W });
      y = doc.y + 16;
    }

    y = Math.max(y, doc.page.height - 130);
    doc.moveTo(ML + W * 0.15, y).lineTo(ML + W * 0.85, y).lineWidth(0.75).stroke('#94a3b8');
    y += 6;
    doc.fontSize(8).font('Helvetica').fillColor(GRIS).text('Recibí conforme', ML, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

const router = express.Router();

router.use(proteger);
router.use(soloMediumOPro);

function obtenerEmpresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

function parseIntSafe(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

// Suma de cobros no anulados por factura, en un solo query agrupado.
async function obtenerCobradoPorFactura(db, empresaId, facturaIds) {
  if (facturaIds.length === 0) return new Map();
  const agrupado = await db.cobros_cliente.groupBy({
    by: ['facturaId'],
    where: { empresaId, facturaId: { in: facturaIds }, anulado: false },
    _sum: { monto: true },
  });
  return new Map(agrupado.map((g) => [g.facturaId, round2(g._sum.monto || 0)]));
}

// GET /api/cxc/vigentes — facturas autorizadas, no anuladas, con saldo pendiente > 0
router.get('/vigentes', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const facturas = await db.facturas.findMany({
      where: { empresaId, anulada: false, estadoSri: 'AUTORIZADA' },
      select: {
        id: true, numeroFactura: true, fechaEmision: true, importeTotal: true,
        razonSocialComprador: true, identificacionComprador: true, clienteId: true,
      },
      orderBy: { fechaEmision: 'desc' },
    });

    const cobrado = await obtenerCobradoPorFactura(db, empresaId, facturas.map((f) => f.id));
    const vigentes = facturas
      .map((f) => ({ ...f, cobrado: cobrado.get(f.id) || 0, saldoPendiente: round2(f.importeTotal - (cobrado.get(f.id) || 0)) }))
      .filter((f) => f.saldoPendiente > 0.009);

    res.json({ success: true, data: vigentes });
  } catch (error) {
    console.error('GET /cxc/vigentes:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener las cuentas vigentes' });
  }
});

// GET /api/cxc/canceladas — facturas con saldo 0 y al menos un cobro no anulado
router.get('/canceladas', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const facturas = await db.facturas.findMany({
      where: { empresaId, anulada: false, estadoSri: 'AUTORIZADA' },
      select: {
        id: true, numeroFactura: true, fechaEmision: true, importeTotal: true,
        razonSocialComprador: true, identificacionComprador: true, clienteId: true,
      },
      orderBy: { fechaEmision: 'desc' },
    });

    const cobrado = await obtenerCobradoPorFactura(db, empresaId, facturas.map((f) => f.id));
    const canceladas = facturas
      .map((f) => ({ ...f, cobrado: cobrado.get(f.id) || 0, saldoPendiente: round2(f.importeTotal - (cobrado.get(f.id) || 0)) }))
      .filter((f) => f.cobrado > 0 && f.saldoPendiente <= 0.009);

    res.json({ success: true, data: canceladas });
  } catch (error) {
    console.error('GET /cxc/canceladas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener las cuentas canceladas' });
  }
});

// GET /api/cxc/facturas/:facturaId/cobros — historial de una factura
router.get('/facturas/:facturaId/cobros', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const facturaId = parseIntSafe(req.params.facturaId);
    if (!facturaId) return res.status(400).json({ success: false, mensaje: 'Factura inválida' });

    const cobros = await db.cobros_cliente.findMany({
      where: { empresaId, facturaId },
      include: { banco: { select: { nombre: true } }, cheque: { select: { numero: true } } },
      orderBy: { fecha: 'desc' },
    });
    res.json({ success: true, data: cobros });
  } catch (error) {
    console.error('GET /cxc/facturas/:facturaId/cobros:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial de cobros' });
  }
});

// GET /api/cxc/cobros — historial global con filtros
router.get('/cobros', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { clienteId, desde, hasta, metodoPago, anulado } = req.query;

    const where = { empresaId };
    if (clienteId) where.clienteId = parseIntSafe(clienteId);
    if (metodoPago) where.metodoPago = metodoPago;
    if (anulado !== undefined) where.anulado = anulado === 'true';
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setHours(23, 59, 59, 999); where.fecha.lte = h; }
    }

    const cobros = await db.cobros_cliente.findMany({
      where,
      include: {
        factura: { select: { numeroFactura: true, razonSocialComprador: true } },
        banco: { select: { nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: cobros });
  } catch (error) {
    console.error('GET /cxc/cobros:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial de cobros' });
  }
});

// GET /api/cxc/cobros/:id/recibo — PDF imprimible del cobro
router.get('/cobros/:id/recibo', autorizarPermiso('cxc.ver'), async (req, res) => {
  let outPath = null;
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cobro = await db.cobros_cliente.findFirst({
      where: { id, empresaId },
      include: {
        factura: { select: { numeroFactura: true, razonSocialComprador: true, identificacionComprador: true, importeTotal: true } },
        cliente: { select: { razonSocial: true, identificacion: true } },
        banco: { select: { nombre: true } },
        cheque: { select: { numero: true } },
      },
    });
    if (!cobro) return res.status(404).json({ success: false, mensaje: 'Cobro no encontrado' });

    const importeTotal = round2(cobro.factura?.importeTotal || 0);
    const cobrado = await obtenerCobradoPorFactura(db, empresaId, [cobro.facturaId]);
    const saldoPendiente = round2(importeTotal - (cobrado.get(cobro.facturaId) || 0));
    const saldoFactura = { importeTotal, saldoPendiente, esTotal: saldoPendiente <= 0.009 };

    const configSri = await db.configuracion_sri.findFirst({ where: { empresaId, activo: true } });

    outPath = path.join(os.tmpdir(), `cxc-recibo-${cobro.id}-${Date.now()}.pdf`);
    await _generarReciboCobroPdf(cobro, saldoFactura, configSri, outPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Recibo-${cobro.numero}.pdf"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(outPath); } catch { /* noop */ } });
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  } catch (error) {
    console.error('GET /cxc/cobros/:id/recibo:', error);
    if (outPath) { try { fs.unlinkSync(outPath); } catch { /* noop */ } }
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'No se pudo generar el recibo' });
  }
});

// POST /api/cxc/cobros — registrar cobro (parcial o total)
router.post('/cobros', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { facturaId, monto, metodoPago, fecha, bancoId, chequeId, referencia, observaciones } = req.body || {};

    const facturaIdNum = parseIntSafe(facturaId);
    if (!facturaIdNum) return res.status(400).json({ success: false, mensaje: 'Factura requerida' });

    const montoNum = round2(monto);
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });

    if (!METODOS_VALIDOS.includes(String(metodoPago))) {
      return res.status(400).json({ success: false, mensaje: `metodoPago debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });
    }

    const cobro = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${facturaIdNum} FOR UPDATE`;

      const factura = await tx.facturas.findFirst({ where: { id: facturaIdNum, empresaId } });
      if (!factura) throw Object.assign(new Error('Factura no encontrada'), { status: 404 });
      if (factura.anulada) throw Object.assign(new Error('La factura está anulada'), { status: 400 });
      if (factura.estadoSri !== 'AUTORIZADA') throw Object.assign(new Error('La factura no está autorizada por el SRI'), { status: 400 });

      const agregados = await tx.cobros_cliente.aggregate({
        where: { empresaId, facturaId: facturaIdNum, anulado: false },
        _sum: { monto: true },
      });
      const saldoPendiente = round2(factura.importeTotal - (agregados._sum.monto || 0));
      if (montoNum > saldoPendiente + 0.01) {
        throw Object.assign(new Error(`El monto excede el saldo pendiente (${saldoPendiente.toFixed(2)})`), { status: 409 });
      }

      const numero = await siguienteNumeroGenerico({ modelo: 'cobros_cliente', prefijo: 'REC', empresaId, fecha: fecha || new Date(), tx });

      const nuevo = await tx.cobros_cliente.create({
        data: {
          empresaId, facturaId: facturaIdNum, clienteId: factura.clienteId || null,
          numero, fecha: fecha ? new Date(fecha) : new Date(), monto: montoNum, metodoPago,
          bancoId: bancoId ? parseIntSafe(bancoId) : null,
          chequeId: chequeId ? parseIntSafe(chequeId) : null,
          referencia: referencia || null, observaciones: observaciones || null,
          usuarioId: req.usuario?.id || null,
        },
      });

      await crearAsientoCobroCliente({ cobroId: nuevo.id, usuarioId: req.usuario?.id, fecha: nuevo.fecha, db: tx });
      return nuevo;
    });

    res.status(201).json({ success: true, data: cobro });
  } catch (error) {
    console.error('POST /cxc/cobros:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'No se pudo registrar el cobro' });
  }
});

// GET /api/cxc/reporte/antiguedad — antigüedad de saldos por rangos
router.get('/reporte/antiguedad', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const hoy = new Date();

    const facturas = await db.facturas.findMany({
      where: { empresaId, anulada: false, estadoSri: 'AUTORIZADA' },
      select: { id: true, numeroFactura: true, fechaEmision: true, importeTotal: true, razonSocialComprador: true, identificacionComprador: true, clienteId: true },
    });

    const cobrado = await obtenerCobradoPorFactura(db, empresaId, facturas.map((f) => f.id));
    const vigentes = facturas
      .map((f) => ({ ...f, cobrado: cobrado.get(f.id) || 0, saldoPendiente: round2(f.importeTotal - (cobrado.get(f.id) || 0)) }))
      .filter((f) => f.saldoPendiente > 0.009);

    const totales = { d0_30: 0, d31_60: 0, d61_90: 0, d91_mas: 0 };
    const detalle = { d0_30: [], d31_60: [], d61_90: [], d91_mas: [] };
    vigentes.forEach((f) => {
      const dias = Math.floor((hoy - new Date(f.fechaEmision)) / (1000 * 60 * 60 * 24));
      const rango = dias <= 30 ? 'd0_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd91_mas';
      totales[rango] = round2(totales[rango] + f.saldoPendiente);
      detalle[rango].push({ ...f, diasVencidos: dias });
    });

    res.json({ success: true, data: { totales, detalle, totalGeneral: round2(vigentes.reduce((s, f) => s + f.saldoPendiente, 0)) } });
  } catch (error) {
    console.error('GET /cxc/reporte/antiguedad:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte' });
  }
});

// GET /api/cxc/reporte/estado-cuenta — clientes con saldo o detalle de uno
router.get('/reporte/estado-cuenta', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const clienteId = parseIntSafe(req.query.clienteId);

    if (!clienteId) {
      const facturas = await db.facturas.findMany({
        where: { empresaId, anulada: false, estadoSri: 'AUTORIZADA' },
        select: { id: true, clienteId: true, importeTotal: true, razonSocialComprador: true, identificacionComprador: true },
      });
      const cobrado = await obtenerCobradoPorFactura(db, empresaId, facturas.map((f) => f.id));
      const clientesMap = new Map();
      facturas.forEach((f) => {
        const saldo = round2(f.importeTotal - (cobrado.get(f.id) || 0));
        if (saldo > 0.009) {
          const key = f.identificacionComprador || `noid-${f.id}`;
          if (!clientesMap.has(key)) clientesMap.set(key, { razonSocial: f.razonSocialComprador, identificacion: f.identificacionComprador, clienteId: f.clienteId, saldoTotal: 0 });
          clientesMap.get(key).saldoTotal = round2(clientesMap.get(key).saldoTotal + saldo);
        }
      });
      return res.json({ success: true, data: Array.from(clientesMap.values()).sort((a, b) => b.saldoTotal - a.saldoTotal) });
    }

    const [facturas, cobros] = await Promise.all([
      db.facturas.findMany({
        where: { empresaId, clienteId, anulada: false, estadoSri: 'AUTORIZADA' },
        select: { id: true, numeroFactura: true, fechaEmision: true, importeTotal: true },
        orderBy: { fechaEmision: 'asc' },
      }),
      db.cobros_cliente.findMany({
        where: { empresaId, clienteId, anulado: false },
        select: { id: true, numero: true, fecha: true, monto: true, metodoPago: true, facturaId: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);
    const cobrado = await obtenerCobradoPorFactura(db, empresaId, facturas.map((f) => f.id));

    res.json({
      success: true,
      data: {
        facturas: facturas.map((f) => ({ ...f, cobrado: cobrado.get(f.id) || 0, saldoPendiente: round2(f.importeTotal - (cobrado.get(f.id) || 0)) })),
        cobros,
      },
    });
  } catch (error) {
    console.error('GET /cxc/reporte/estado-cuenta:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte' });
  }
});

// ─── CHEQUES RECIBIDOS ────────────────────────────────────────────

const ESTADOS_CHEQUE = ['PENDIENTE', 'DEPOSITADO', 'PROTESTADO', 'ANULADO'];

// GET /api/cxc/cheques
router.get('/cheques', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const { estado, desde, hasta, q } = req.query;

    const rows = await db.$queryRaw`
      SELECT cr.*, cl.identificacion AS cliente_ident
      FROM "cheques_recibidos" cr
      LEFT JOIN "clientes" cl ON cl.id = cr."clienteId" AND cl."empresaId" = ${empresaId}
      WHERE cr."empresaId" = ${empresaId}
        AND (${estado ?? null} IS NULL OR cr.estado = ${estado ?? ''})
        AND (${desde  ?? null} IS NULL OR cr.fecha >= ${desde  ? new Date(desde)  : new Date(0)})
        AND (${hasta  ?? null} IS NULL OR cr.fecha <= ${hasta  ? new Date(new Date(hasta).setHours(23,59,59)) : new Date()})
        AND (${q ?? null} IS NULL OR cr.numero ILIKE ${'%' + (q ?? '') + '%'} OR cr.banco ILIKE ${'%' + (q ?? '') + '%'} OR cr."clienteNombre" ILIKE ${'%' + (q ?? '') + '%'})
      ORDER BY cr.fecha DESC, cr.id DESC
      LIMIT 200
    `;
    const data = rows.map((r) => ({
      id: Number(r.id),
      numero: r.numero,
      banco: r.banco,
      monto: parseFloat(r.monto || 0),
      fecha: r.fecha,
      fechaRecepcion: r.fechaRecepcion,
      fechaDeposito: r.fechaDeposito || null,
      clienteId: r.clienteId ? Number(r.clienteId) : null,
      clienteNombre: r.clienteNombre,
      facturaId: r.facturaId ? Number(r.facturaId) : null,
      estado: r.estado,
      observaciones: r.observaciones || null,
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /cxc/cheques:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener los cheques' });
  }
});

// POST /api/cxc/cheques
router.post('/cheques', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const { numero, banco, monto, fecha, fechaRecepcion, fechaDeposito, clienteId, clienteNombre, facturaId, observaciones } = req.body || {};

    if (!numero?.trim()) return res.status(400).json({ success: false, mensaje: 'El número de cheque es requerido' });
    if (!banco?.trim())  return res.status(400).json({ success: false, mensaje: 'El banco es requerido' });
    const montoNum = round2(monto);
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });
    if (!fecha) return res.status(400).json({ success: false, mensaje: 'La fecha del cheque es requerida' });

    const fechaD     = new Date(fecha);
    const recepcionD = fechaRecepcion ? new Date(fechaRecepcion) : new Date();
    const depositoD  = fechaDeposito  ? new Date(fechaDeposito)  : null;
    const cliId      = clienteId      ? parseIntSafe(clienteId)  : null;
    const facId      = facturaId      ? parseIntSafe(facturaId)  : null;
    const usuarioId  = req.usuario?.id || null;

    const result = await db.$queryRaw`
      INSERT INTO "cheques_recibidos"
        ("empresaId", "numero", "banco", "monto", "fecha", "fechaRecepcion", "fechaDeposito",
         "clienteId", "clienteNombre", "facturaId", "observaciones", "usuarioId", "createdAt", "updatedAt")
      VALUES (
        ${empresaId}, ${numero.trim()}, ${banco.trim()}, ${montoNum}, ${fechaD}, ${recepcionD},
        ${depositoD}, ${cliId}, ${(clienteNombre || '').trim()}, ${facId},
        ${observaciones || null}, ${usuarioId}, NOW(), NOW()
      )
      RETURNING id
    `;
    res.status(201).json({ success: true, data: { id: Number(result[0].id) } });
  } catch (error) {
    console.error('POST /cxc/cheques:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo registrar el cheque' });
  }
});

// PATCH /api/cxc/cheques/:id/estado
router.patch('/cheques/:id/estado', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { estado, fechaDeposito, observaciones } = req.body || {};
    if (!ESTADOS_CHEQUE.includes(estado)) {
      return res.status(400).json({ success: false, mensaje: `Estado inválido. Válidos: ${ESTADOS_CHEQUE.join(', ')}` });
    }

    const rows = await db.$queryRaw`SELECT id FROM "cheques_recibidos" WHERE id = ${id} AND "empresaId" = ${empresaId}`;
    if (!rows.length) return res.status(404).json({ success: false, mensaje: 'Cheque no encontrado' });

    const depositoD = fechaDeposito ? new Date(fechaDeposito) : null;
    await db.$queryRaw`
      UPDATE "cheques_recibidos"
      SET estado = ${estado},
          "fechaDeposito" = COALESCE(${depositoD}, "fechaDeposito"),
          "observaciones" = COALESCE(${observaciones || null}, "observaciones"),
          "updatedAt" = NOW()
      WHERE id = ${id} AND "empresaId" = ${empresaId}
    `;
    res.json({ success: true });
  } catch (error) {
    console.error('PATCH /cxc/cheques/:id/estado:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar el estado' });
  }
});

// PATCH /api/cxc/cobros/:id/anular
router.patch('/cobros/:id/anular', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cobro = await db.cobros_cliente.findFirst({ where: { id, empresaId } });
    if (!cobro) return res.status(404).json({ success: false, mensaje: 'Cobro no encontrado' });
    if (cobro.anulado) return res.status(400).json({ success: false, mensaje: 'El cobro ya está anulado' });

    await db.$transaction(async (tx) => {
      await crearAsientoReversoCobroCliente({ cobroId: id, usuarioId: req.usuario?.id, db: tx });
      await tx.cobros_cliente.update({
        where: { id },
        data: {
          anulado: true,
          motivoAnulacion: req.body?.motivo || null,
          fechaAnulacion: new Date(),
          usuarioAnulacionId: req.usuario?.id || null,
        },
      });
    });

    res.json({ success: true });
  } catch (error) {
    console.error('PATCH /cxc/cobros/:id/anular:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo anular el cobro' });
  }
});

// GET /api/cxc/cobros/importar/plantilla — descarga Excel vacío con encabezados
router.get('/cobros/importar/plantilla', autorizarPermiso('cxc.ver'), (req, res) => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Número Factura', 'Monto', 'Fecha', 'Método de Pago', 'Referencia', 'Observaciones'],
    ['001-001-000000001', 100.00, '2026-07-13', 'efectivo', '', ''],
    ['001-001-000000002', 250.50, '2026-07-13', 'transferencia', 'TRF-12345', 'Abono parcial'],
  ]);
  ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 25 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cobros');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="plantilla-cobros.xlsx"',
  });
  res.send(buf);
});

// POST /api/cxc/cobros/importar — importar cobros masivos desde Excel
router.post('/cobros/importar', autorizarPermiso('cxc.gestionar'), _upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, mensaje: 'Adjunta un archivo Excel (.xlsx / .xls / .csv)' });
    }

    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', cellDates: true });

    if (filas.length < 2) {
      return res.status(400).json({ success: false, mensaje: 'El archivo no tiene filas de datos (fila 1 es encabezado)' });
    }

    const exitosas = [];
    const errores  = [];

    for (let i = 1; i < filas.length; i++) {
      const fila         = filas[i];
      const numeroFact   = String(fila[0] || '').trim();
      const montoRaw     = fila[1];
      const fechaRaw     = fila[2];
      const metodoPago   = String(fila[3] || '').trim().toLowerCase();
      const referencia   = String(fila[4] || '').trim() || null;
      const observaciones = String(fila[5] || '').trim() || null;
      const filaNum      = i + 1;

      if (!numeroFact && !montoRaw) continue; // fila vacía

      if (!numeroFact)                    { errores.push({ fila: filaNum, numeroFactura: '—', error: 'Número de factura requerido' }); continue; }
      const montoNum = round2(montoRaw);
      if (!(montoNum > 0))                { errores.push({ fila: filaNum, numeroFactura: numeroFact, error: 'Monto inválido o cero' }); continue; }
      if (!METODOS_VALIDOS.includes(metodoPago)) { errores.push({ fila: filaNum, numeroFactura: numeroFact, error: `Método de pago inválido: "${metodoPago || '?'}"` }); continue; }

      let fechaObj;
      if (fechaRaw instanceof Date && !isNaN(fechaRaw.getTime())) {
        fechaObj = fechaRaw;
      } else if (fechaRaw && String(fechaRaw).trim()) {
        fechaObj = new Date(String(fechaRaw).trim());
      } else {
        fechaObj = new Date();
      }
      if (isNaN(fechaObj.getTime())) { errores.push({ fila: filaNum, numeroFactura: numeroFact, error: 'Fecha inválida' }); continue; }

      try {
        const cobro = await db.$transaction(async (tx) => {
          const factura = await tx.facturas.findFirst({ where: { empresaId, numeroFactura: numeroFact } });
          if (!factura) throw new Error('Factura no encontrada');
          if (factura.anulada) throw new Error('La factura está anulada');
          if (factura.estadoSri !== 'AUTORIZADA') throw new Error('Factura no autorizada por el SRI');

          await tx.$queryRaw`SELECT id FROM facturas WHERE id = ${factura.id} FOR UPDATE`;

          const agg = await tx.cobros_cliente.aggregate({
            where: { empresaId, facturaId: factura.id, anulado: false },
            _sum: { monto: true },
          });
          const saldo = round2(factura.importeTotal - (agg._sum.monto || 0));
          if (montoNum > saldo + 0.01) throw new Error(`Monto excede el saldo pendiente ($${saldo.toFixed(2)})`);

          const numero = await siguienteNumeroGenerico({ modelo: 'cobros_cliente', prefijo: 'REC', empresaId, fecha: fechaObj, tx });
          const nuevo = await tx.cobros_cliente.create({
            data: {
              empresaId, facturaId: factura.id, clienteId: factura.clienteId || null,
              numero, fecha: fechaObj, monto: montoNum, metodoPago,
              referencia, observaciones,
              usuarioId: req.usuario?.id || null,
            },
          });
          await crearAsientoCobroCliente({ cobroId: nuevo.id, usuarioId: req.usuario?.id, fecha: fechaObj, db: tx });
          return nuevo;
        });
        exitosas.push({ fila: filaNum, numeroFactura: numeroFact, monto: montoNum, numero: cobro.numero });
      } catch (err) {
        errores.push({ fila: filaNum, numeroFactura: numeroFact, monto: montoNum, error: err.message });
      }
    }

    res.json({ ok: true, data: { exitosas, errores, totalExitosas: exitosas.length, totalErrores: errores.length } });
  } catch (error) {
    console.error('POST /cxc/cobros/importar:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'Error al procesar el archivo' });
  }
});

module.exports = router;
