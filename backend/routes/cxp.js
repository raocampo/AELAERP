/**
 * AELA — Cuentas por Pagar (CxP)
 * Subledger de pagos contra facturas de compra. El saldo pendiente se calcula
 * al vuelo (importeTotal - suma de pagos no anulados), sin columna
 * redundante. Requiere plan Medium o Pro.
 */
const express = require('express');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const {
  crearAsientoPagoProveedor,
  crearAsientoReversoPagoProveedor,
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

async function obtenerPagadoPorCompra(db, empresaId, compraIds) {
  if (compraIds.length === 0) return new Map();
  const agrupado = await db.pagos_proveedor.groupBy({
    by: ['compraId'],
    where: { empresaId, compraId: { in: compraIds }, anulado: false },
    _sum: { monto: true },
  });
  return new Map(agrupado.map((g) => [g.compraId, round2(g._sum.monto || 0)]));
}

// GET /api/cxp/vigentes — compras no anuladas con saldo pendiente > 0
router.get('/vigentes', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const compras = await db.facturas_compra.findMany({
      where: { empresaId, anulada: false },
      select: {
        id: true, numeroFactura: true, fechaEmision: true, importeTotal: true,
        razonSocialProveedor: true, identificacionProveedor: true, proveedorId: true,
      },
      orderBy: { fechaEmision: 'desc' },
    });

    const pagado = await obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id));
    const vigentes = compras
      .map((c) => ({ ...c, pagado: pagado.get(c.id) || 0, saldoPendiente: round2(c.importeTotal - (pagado.get(c.id) || 0)) }))
      .filter((c) => c.saldoPendiente > 0.009);

    res.json({ success: true, data: vigentes });
  } catch (error) {
    console.error('GET /cxp/vigentes:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener las cuentas vigentes' });
  }
});

// GET /api/cxp/canceladas — compras con saldo 0 y al menos un pago no anulado
router.get('/canceladas', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const compras = await db.facturas_compra.findMany({
      where: { empresaId, anulada: false },
      select: {
        id: true, numeroFactura: true, fechaEmision: true, importeTotal: true,
        razonSocialProveedor: true, identificacionProveedor: true, proveedorId: true,
      },
      orderBy: { fechaEmision: 'desc' },
    });

    const pagado = await obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id));
    const canceladas = compras
      .map((c) => ({ ...c, pagado: pagado.get(c.id) || 0, saldoPendiente: round2(c.importeTotal - (pagado.get(c.id) || 0)) }))
      .filter((c) => c.pagado > 0 && c.saldoPendiente <= 0.009);

    res.json({ success: true, data: canceladas });
  } catch (error) {
    console.error('GET /cxp/canceladas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener las cuentas canceladas' });
  }
});

// GET /api/cxp/compras/:compraId/pagos — historial de una compra
router.get('/compras/:compraId/pagos', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const compraId = parseIntSafe(req.params.compraId);
    if (!compraId) return res.status(400).json({ success: false, mensaje: 'Compra inválida' });

    const pagos = await db.pagos_proveedor.findMany({
      where: { empresaId, compraId },
      include: { banco: { select: { nombre: true } }, cheque: { select: { numero: true } } },
      orderBy: { fecha: 'desc' },
    });
    res.json({ success: true, data: pagos });
  } catch (error) {
    console.error('GET /cxp/compras/:compraId/pagos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial de pagos' });
  }
});

// GET /api/cxp/pagos — historial global con filtros
router.get('/pagos', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { proveedorId, desde, hasta, metodoPago, anulado } = req.query;

    const where = { empresaId };
    if (proveedorId) where.proveedorId = parseIntSafe(proveedorId);
    if (metodoPago) where.metodoPago = metodoPago;
    if (anulado !== undefined) where.anulado = anulado === 'true';
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha.gte = new Date(desde);
      if (hasta) { const h = new Date(hasta); h.setHours(23, 59, 59, 999); where.fecha.lte = h; }
    }

    const pagos = await db.pagos_proveedor.findMany({
      where,
      include: {
        compra: { select: { numeroFactura: true, razonSocialProveedor: true } },
        banco: { select: { nombre: true } },
      },
      orderBy: { fecha: 'desc' },
      take: 200,
    });
    res.json({ success: true, data: pagos });
  } catch (error) {
    console.error('GET /cxp/pagos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial de pagos' });
  }
});

// POST /api/cxp/pagos — registrar pago (parcial o total)
router.post('/pagos', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { compraId, monto, metodoPago, fecha, bancoId, chequeId, referencia, observaciones } = req.body || {};

    const compraIdNum = parseIntSafe(compraId);
    if (!compraIdNum) return res.status(400).json({ success: false, mensaje: 'Compra requerida' });

    const montoNum = round2(monto);
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });

    if (!METODOS_VALIDOS.includes(String(metodoPago))) {
      return res.status(400).json({ success: false, mensaje: `metodoPago debe ser uno de: ${METODOS_VALIDOS.join(', ')}` });
    }

    const pago = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM facturas_compra WHERE id = ${compraIdNum} FOR UPDATE`;

      const compra = await tx.facturas_compra.findFirst({ where: { id: compraIdNum, empresaId } });
      if (!compra) throw Object.assign(new Error('Compra no encontrada'), { status: 404 });
      if (compra.anulada) throw Object.assign(new Error('La compra está anulada'), { status: 400 });

      const agregados = await tx.pagos_proveedor.aggregate({
        where: { empresaId, compraId: compraIdNum, anulado: false },
        _sum: { monto: true },
      });
      const saldoPendiente = round2(compra.importeTotal - (agregados._sum.monto || 0));
      if (montoNum > saldoPendiente + 0.01) {
        throw Object.assign(new Error(`El monto excede el saldo pendiente (${saldoPendiente.toFixed(2)})`), { status: 409 });
      }

      const numero = await siguienteNumeroGenerico({ modelo: 'pagos_proveedor', prefijo: 'OP', empresaId, fecha: fecha || new Date(), tx });

      const nuevo = await tx.pagos_proveedor.create({
        data: {
          empresaId, compraId: compraIdNum, proveedorId: compra.proveedorId || null,
          numero, fecha: fecha ? new Date(fecha) : new Date(), monto: montoNum, metodoPago,
          bancoId: bancoId ? parseIntSafe(bancoId) : null,
          chequeId: chequeId ? parseIntSafe(chequeId) : null,
          referencia: referencia || null, observaciones: observaciones || null,
          usuarioId: req.usuario?.id || null,
        },
      });

      await crearAsientoPagoProveedor({ pagoId: nuevo.id, usuarioId: req.usuario?.id, fecha: nuevo.fecha, db: tx });
      return nuevo;
    });

    res.status(201).json({ success: true, data: pago });
  } catch (error) {
    console.error('POST /cxp/pagos:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'No se pudo registrar el pago' });
  }
});

// PATCH /api/cxp/pagos/:id/anular
router.patch('/pagos/:id/anular', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const pago = await db.pagos_proveedor.findFirst({ where: { id, empresaId } });
    if (!pago) return res.status(404).json({ success: false, mensaje: 'Pago no encontrado' });
    if (pago.anulado) return res.status(400).json({ success: false, mensaje: 'El pago ya está anulado' });

    await db.$transaction(async (tx) => {
      await crearAsientoReversoPagoProveedor({ pagoId: id, usuarioId: req.usuario?.id, db: tx });
      await tx.pagos_proveedor.update({
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
    console.error('PATCH /cxp/pagos/:id/anular:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo anular el pago' });
  }
});

module.exports = router;
