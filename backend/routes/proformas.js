// ====================================
// RUTAS: PROFORMAS (Cotizaciones / Presupuestos)
// backend/routes/proformas.js
// ====================================

const express = require('express');
const router  = express.Router();
const { proteger, permitir } = require('../middleware/auth');
const { normalizarRol }      = require('../utils/roles');
const { pg: pgPool }         = require('../config/prisma');

// Todas las rutas requieren autenticación
router.use(proteger);

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
        "estado", "creadoPor"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
      ) RETURNING *
    `,
      empresaId, numero, sec,
      tipoIdentificacion, identificacion, razonSocial.trim(),
      direccion || null, email || null, telefono || null, clienteId || null,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      vigenciaDesde || null, vigenciaHasta || null,
      'BORRADOR', req.usuario.id,
    );

    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] POST /', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al crear proforma' });
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
        "detalles" = $16, "observaciones" = $17,
        "vigenciaDesde" = $18, "vigenciaHasta" = $19,
        "updatedAt" = NOW()
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
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] PUT /:id', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar proforma' });
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

module.exports = router;
