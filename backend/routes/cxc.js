/**
 * AELA — Cuentas por Cobrar (CxC)
 * Subledger de cobros contra facturas de venta. El saldo pendiente se calcula
 * al vuelo (importeTotal - suma de cobros no anulados), sin columna
 * redundante. Requiere plan Medium o Pro.
 */
const express = require('express');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const {
  crearAsientoCobroCliente,
  crearAsientoReversoCobroCliente,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');

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

module.exports = router;
