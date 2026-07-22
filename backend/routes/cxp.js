/**
 * AELA — Cuentas por Pagar (CxP)
 * Subledger de pagos contra facturas de compra. El saldo pendiente se calcula
 * al vuelo (importeTotal - suma de pagos no anulados), sin columna
 * redundante. Requiere plan Medium o Pro.
 */
const express = require('express');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const {
  crearAsientoPagoProveedor,
  crearAsientoReversoPagoProveedor,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');
const { parsearNotaCreditoRecibidaXml } = require('../utils/sri');

const router = express.Router();

router.use(proteger);
router.use(soloMediumOPro);
router.use(requiereModulo('contabilidadHabilitada'));

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

// Notas de crédito RECIBIDAS de proveedores (docs_recibidos_otros tipo 04) que
// afectan una compra específica. No hay FK directa — se cruza por proveedor +
// número de documento original, extraído del XML de la propia NC
// (numDocModificado, formato EEE-PPP-SSSSSSSSS, igual al de numeroFactura).
// Las NC cuyo documento original no está registrado en el sistema (factura
// nunca importada) quedan sin efecto aquí — no hay con qué compra vincularlas.
async function obtenerNotasCreditoPorCompra(db, empresaId, compras) {
  if (compras.length === 0) return new Map();
  const ncs = await db.docs_recibidos_otros.findMany({
    where: { empresaId, tipoDocumento: '04' },
    select: { rucEmisor: true, importeTotal: true, xmlAutorizado: true },
  });
  if (ncs.length === 0) return new Map();

  const porDocumento = new Map(); // "ruc|numeroDoc" -> monto acumulado
  ncs.forEach((nc) => {
    const { numDocModificado } = parsearNotaCreditoRecibidaXml(nc.xmlAutorizado);
    if (!numDocModificado) return;
    const key = `${nc.rucEmisor}|${numDocModificado}`;
    porDocumento.set(key, round2((porDocumento.get(key) || 0) + parseFloat(nc.importeTotal || 0)));
  });

  const resultado = new Map();
  compras.forEach((c) => {
    const key = `${c.identificacionProveedor}|${c.numeroFactura}`;
    const monto = porDocumento.get(key);
    if (monto) resultado.set(c.id, monto);
  });
  return resultado;
}

// Saldo pendiente real: total de la compra menos lo pagado menos las NC
// recibidas vinculadas. Antes solo restaba pagos — una compra con una NC ya
// recibida del proveedor seguía apareciendo como si se debiera el monto completo.
function calcularSaldoConNC(importeTotal, pagado, notaCredito) {
  return round2(importeTotal - (pagado || 0) - (notaCredito || 0));
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

    const [pagado, notaCredito] = await Promise.all([
      obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id)),
      obtenerNotasCreditoPorCompra(db, empresaId, compras),
    ]);
    const vigentes = compras
      .map((c) => ({
        ...c,
        pagado: pagado.get(c.id) || 0,
        notaCredito: notaCredito.get(c.id) || 0,
        saldoPendiente: calcularSaldoConNC(c.importeTotal, pagado.get(c.id), notaCredito.get(c.id)),
      }))
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

    const [pagado, notaCredito] = await Promise.all([
      obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id)),
      obtenerNotasCreditoPorCompra(db, empresaId, compras),
    ]);
    const canceladas = compras
      .map((c) => ({
        ...c,
        pagado: pagado.get(c.id) || 0,
        notaCredito: notaCredito.get(c.id) || 0,
        saldoPendiente: calcularSaldoConNC(c.importeTotal, pagado.get(c.id), notaCredito.get(c.id)),
      }))
      // Cancelada = saldo en 0, ya sea por pago real, por NC, o combinación de ambos.
      .filter((c) => (c.pagado > 0 || c.notaCredito > 0) && c.saldoPendiente <= 0.009);

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

      const [agregados, notaCredito] = await Promise.all([
        tx.pagos_proveedor.aggregate({
          where: { empresaId, compraId: compraIdNum, anulado: false },
          _sum: { monto: true },
        }),
        obtenerNotasCreditoPorCompra(tx, empresaId, [compra]),
      ]);
      const saldoPendiente = calcularSaldoConNC(compra.importeTotal, agregados._sum.monto, notaCredito.get(compra.id));
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

// GET /api/cxp/reporte/antiguedad — antigüedad de saldos por rangos
router.get('/reporte/antiguedad', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const hoy = new Date();

    const compras = await db.facturas_compra.findMany({
      where: { empresaId, anulada: false },
      select: { id: true, numeroFactura: true, fechaEmision: true, importeTotal: true, razonSocialProveedor: true, identificacionProveedor: true, proveedorId: true },
    });

    const [pagado, notaCredito] = await Promise.all([
      obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id)),
      obtenerNotasCreditoPorCompra(db, empresaId, compras),
    ]);
    const vigentes = compras
      .map((c) => ({
        ...c,
        pagado: pagado.get(c.id) || 0,
        notaCredito: notaCredito.get(c.id) || 0,
        saldoPendiente: calcularSaldoConNC(c.importeTotal, pagado.get(c.id), notaCredito.get(c.id)),
      }))
      .filter((c) => c.saldoPendiente > 0.009);

    const totales = { d0_30: 0, d31_60: 0, d61_90: 0, d91_mas: 0 };
    const detalle = { d0_30: [], d31_60: [], d61_90: [], d91_mas: [] };
    vigentes.forEach((c) => {
      const dias = Math.floor((hoy - new Date(c.fechaEmision)) / (1000 * 60 * 60 * 24));
      const rango = dias <= 30 ? 'd0_30' : dias <= 60 ? 'd31_60' : dias <= 90 ? 'd61_90' : 'd91_mas';
      totales[rango] = round2(totales[rango] + c.saldoPendiente);
      detalle[rango].push({ ...c, diasVencidos: dias });
    });

    res.json({ success: true, data: { totales, detalle, totalGeneral: round2(vigentes.reduce((s, c) => s + c.saldoPendiente, 0)) } });
  } catch (error) {
    console.error('GET /cxp/reporte/antiguedad:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte' });
  }
});

// GET /api/cxp/reporte/estado-cuenta — proveedores con saldo o detalle de uno
router.get('/reporte/estado-cuenta', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const proveedorId = parseIntSafe(req.query.proveedorId);

    if (!proveedorId) {
      const compras = await db.facturas_compra.findMany({
        where: { empresaId, anulada: false },
        select: { id: true, numeroFactura: true, proveedorId: true, importeTotal: true, razonSocialProveedor: true, identificacionProveedor: true },
      });
      const [pagado, notaCredito] = await Promise.all([
        obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id)),
        obtenerNotasCreditoPorCompra(db, empresaId, compras),
      ]);
      const proveedoresMap = new Map();
      compras.forEach((c) => {
        const saldo = calcularSaldoConNC(c.importeTotal, pagado.get(c.id), notaCredito.get(c.id));
        if (saldo > 0.009) {
          const key = c.identificacionProveedor || `noid-${c.id}`;
          if (!proveedoresMap.has(key)) proveedoresMap.set(key, { razonSocial: c.razonSocialProveedor, identificacion: c.identificacionProveedor, proveedorId: c.proveedorId, saldoTotal: 0 });
          proveedoresMap.get(key).saldoTotal = round2(proveedoresMap.get(key).saldoTotal + saldo);
        }
      });
      return res.json({ success: true, data: Array.from(proveedoresMap.values()).sort((a, b) => b.saldoTotal - a.saldoTotal) });
    }

    const [compras, pagos] = await Promise.all([
      db.facturas_compra.findMany({
        where: { empresaId, proveedorId, anulada: false },
        select: { id: true, numeroFactura: true, fechaEmision: true, importeTotal: true, identificacionProveedor: true },
        orderBy: { fechaEmision: 'asc' },
      }),
      db.pagos_proveedor.findMany({
        where: { empresaId, proveedorId, anulado: false },
        select: { id: true, numero: true, fecha: true, monto: true, metodoPago: true, compraId: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);
    const [pagado, notaCredito] = await Promise.all([
      obtenerPagadoPorCompra(db, empresaId, compras.map((c) => c.id)),
      obtenerNotasCreditoPorCompra(db, empresaId, compras),
    ]);

    res.json({
      success: true,
      data: {
        compras: compras.map((c) => ({
          ...c,
          pagado: pagado.get(c.id) || 0,
          notaCredito: notaCredito.get(c.id) || 0,
          saldoPendiente: calcularSaldoConNC(c.importeTotal, pagado.get(c.id), notaCredito.get(c.id)),
        })),
        pagos,
      },
    });
  } catch (error) {
    console.error('GET /cxp/reporte/estado-cuenta:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte' });
  }
});

// ─── TARJETAS DE CRÉDITO ──────────────────────────────────────────

const TIPOS_MOV_TARJETA = ['CARGO', 'PAGO', 'NOTA_CREDITO'];

// GET /api/cxp/tarjetas
router.get('/tarjetas', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const rows = await db.$queryRaw`
      SELECT t.*,
        COALESCE(SUM(CASE WHEN m.tipo = 'CARGO' AND m.estado != 'ANULADO' THEN m.monto ELSE 0 END), 0) AS "totalCargos",
        COALESCE(SUM(CASE WHEN m.tipo IN ('PAGO','NOTA_CREDITO') AND m.estado != 'ANULADO' THEN m.monto ELSE 0 END), 0) AS "totalPagos"
      FROM "tarjetas_credito" t
      LEFT JOIN "movimientos_tarjeta" m ON m."tarjetaId" = t.id
      WHERE t."empresaId" = ${empresaId}
      GROUP BY t.id
      ORDER BY t.activa DESC, t.nombre
    `;
    const data = rows.map((r) => ({
      id: Number(r.id), nombre: r.nombre, numero: r.numero, banco: r.banco,
      limiteCredito: parseFloat(r.limiteCredito || 0),
      corte: Number(r.corte), vencimientoPago: Number(r.vencimientoPago),
      activa: Boolean(r.activa),
      totalCargos: parseFloat(r.totalCargos || 0),
      totalPagos: parseFloat(r.totalPagos || 0),
      saldo: parseFloat(r.totalCargos || 0) - parseFloat(r.totalPagos || 0),
    }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /cxp/tarjetas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener las tarjetas' });
  }
});

// POST /api/cxp/tarjetas
router.post('/tarjetas', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const { nombre, numero, banco, limiteCredito, corte, vencimientoPago } = req.body || {};
    if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre de la tarjeta es requerido' });
    if (!banco?.trim())  return res.status(400).json({ success: false, mensaje: 'El banco es requerido' });
    const result = await db.$queryRaw`
      INSERT INTO "tarjetas_credito" ("empresaId", "nombre", "numero", "banco", "limiteCredito", "corte", "vencimientoPago", "createdAt", "updatedAt")
      VALUES (${empresaId}, ${nombre.trim()}, ${(numero || '****').trim()}, ${banco.trim()},
              ${parseFloat(limiteCredito || 0)}, ${parseInt(corte || 20, 10)}, ${parseInt(vencimientoPago || 10, 10)}, NOW(), NOW())
      RETURNING id
    `;
    res.status(201).json({ success: true, data: { id: Number(result[0].id) } });
  } catch (error) {
    console.error('POST /cxp/tarjetas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear la tarjeta' });
  }
});

// GET /api/cxp/tarjetas/:id/movimientos
router.get('/tarjetas/:id/movimientos', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const tarjetaId = parseIntSafe(req.params.id);
    if (!tarjetaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });
    const { desde, hasta } = req.query;
    const rows = await db.$queryRaw`
      SELECT m.* FROM "movimientos_tarjeta" m
      WHERE m."tarjetaId" = ${tarjetaId} AND m."empresaId" = ${empresaId}
        AND (${desde ?? null} IS NULL OR m.fecha >= ${desde ? new Date(desde) : new Date(0)})
        AND (${hasta ?? null} IS NULL OR m.fecha <= ${hasta ? new Date(new Date(hasta).setHours(23,59,59)) : new Date()})
      ORDER BY m.fecha DESC, m.id DESC
    `;
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: Number(r.id), fecha: r.fecha, concepto: r.concepto,
        monto: parseFloat(r.monto || 0), tipo: r.tipo, referencia: r.referencia || null,
        estado: r.estado, observaciones: r.observaciones || null,
      })),
    });
  } catch (error) {
    console.error('GET /cxp/tarjetas/:id/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener movimientos' });
  }
});

// POST /api/cxp/tarjetas/:id/movimientos
router.post('/tarjetas/:id/movimientos', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const tarjetaId = parseIntSafe(req.params.id);
    if (!tarjetaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { fecha, concepto, monto, tipo, referencia, observaciones } = req.body || {};
    if (!concepto?.trim()) return res.status(400).json({ success: false, mensaje: 'El concepto es requerido' });
    const montoNum = parseFloat(monto || 0);
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });
    const tipoLimpio = tipo || 'CARGO';
    if (!TIPOS_MOV_TARJETA.includes(tipoLimpio)) {
      return res.status(400).json({ success: false, mensaje: `Tipo inválido. Válidos: ${TIPOS_MOV_TARJETA.join(', ')}` });
    }

    // Verify tarjeta belongs to empresa
    const tar = await db.$queryRaw`SELECT id FROM "tarjetas_credito" WHERE id = ${tarjetaId} AND "empresaId" = ${empresaId}`;
    if (!tar.length) return res.status(404).json({ success: false, mensaje: 'Tarjeta no encontrada' });

    const result = await db.$queryRaw`
      INSERT INTO "movimientos_tarjeta"
        ("empresaId", "tarjetaId", "fecha", "concepto", "monto", "tipo", "referencia", "observaciones", "usuarioId", "createdAt", "updatedAt")
      VALUES (${empresaId}, ${tarjetaId}, ${fecha ? new Date(fecha) : new Date()},
              ${concepto.trim()}, ${montoNum}, ${tipoLimpio}, ${referencia || null},
              ${observaciones || null}, ${req.usuario?.id || null}, NOW(), NOW())
      RETURNING id
    `;
    res.status(201).json({ success: true, data: { id: Number(result[0].id) } });
  } catch (error) {
    console.error('POST /cxp/tarjetas/:id/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo registrar el movimiento' });
  }
});

// GET /api/cxp/libro-tarjetas
router.get('/libro-tarjetas', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const { prisma: db } = req;
    const empresaId = obtenerEmpresaId(req);
    const { tarjetaId, desde, hasta, tipo } = req.query;
    const tarId = parseIntSafe(tarjetaId);
    const rows = await db.$queryRaw`
      SELECT m.*, t.nombre AS tarjeta_nombre, t.banco AS tarjeta_banco
      FROM "movimientos_tarjeta" m
      JOIN "tarjetas_credito" t ON t.id = m."tarjetaId"
      WHERE m."empresaId" = ${empresaId}
        AND (${tarId ?? null} IS NULL OR m."tarjetaId" = ${tarId ?? 0})
        AND (${tipo ?? null} IS NULL OR m.tipo = ${tipo ?? ''})
        AND (${desde ?? null} IS NULL OR m.fecha >= ${desde ? new Date(desde) : new Date(0)})
        AND (${hasta ?? null} IS NULL OR m.fecha <= ${hasta ? new Date(new Date(hasta).setHours(23,59,59)) : new Date()})
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT 500
    `;
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: Number(r.id), fecha: r.fecha, concepto: r.concepto,
        monto: parseFloat(r.monto || 0), tipo: r.tipo, estado: r.estado,
        referencia: r.referencia || null,
        tarjetaId: Number(r.tarjetaId), tarjetaNombre: r.tarjeta_nombre, tarjetaBanco: r.tarjeta_banco,
      })),
    });
  } catch (error) {
    console.error('GET /cxp/libro-tarjetas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el libro de tarjetas' });
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
