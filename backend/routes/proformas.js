// ====================================
// RUTAS: PROFORMAS (Cotizaciones / Presupuestos)
// backend/routes/proformas.js
// ====================================

const express = require('express');
const router  = express.Router();
const { proteger, permitir } = require('../middleware/auth');
const { normalizarRol }      = require('../utils/roles');
const prisma                 = require('../config/prisma');
const { enviarConFallback }  = require('../utils/email');

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
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
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
        "detalles" = $16, "observaciones" = $17,
        "vigenciaDesde" = $18, "vigenciaHasta" = $19,
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

    await enviarConFallback({
      from:    process.env.SMTP_FROM || `${emisorLabel} <info@corpsimtelec.com>`,
      to:      destino,
      subject: `Proforma ${p.numero} — ${emisorLabel}`,
      html,
    });

    res.json({ ok: true, mensaje: `Proforma enviada a ${destino}` });
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

module.exports = router;
