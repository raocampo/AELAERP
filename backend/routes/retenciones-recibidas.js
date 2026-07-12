// ====================================
// RUTAS: RETENCIONES RECIBIDAS (del Buzón SRI)
// backend/routes/retenciones-recibidas.js
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { parsearRetencionRecibida } = require('../utils/buzon');

router.use(proteger);
router.use(autorizarPermiso('compras.gestionar'));

// ─── GET / — listar con filtros ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const { page = 1, limit = 15, desde, hasta, agente, incluirAnuladas } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = { empresaId };
    if (incluirAnuladas !== 'true') where.anulada = false;
    if (desde && hasta) {
      where.fechaEmision = { gte: new Date(desde), lte: new Date(hasta + 'T23:59:59') };
    } else if (desde) {
      where.fechaEmision = { gte: new Date(desde) };
    } else if (hasta) {
      where.fechaEmision = { lte: new Date(hasta + 'T23:59:59') };
    }
    if (agente) {
      where.OR = [
        { rucAgente: { contains: agente, mode: 'insensitive' } },
        { razonSocialAgente: { contains: agente, mode: 'insensitive' } },
      ];
    }

    const [total, datos] = await Promise.all([
      db.retenciones_recibidas.count({ where }),
      db.retenciones_recibidas.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        skip,
        take: Number(limit),
        select: {
          id: true,
          claveAcceso: true,
          numeroAutorizacion: true,
          rucAgente: true,
          razonSocialAgente: true,
          fechaEmision: true,
          numDocSustento: true,
          totalRetencionIva: true,
          totalRetencionRenta: true,
          detalles: true,
          anulada: true,
          observaciones: true,
          facturaId: true,
        },
      }),
    ]);

    res.json({ data: datos, total, pages: Math.ceil(total / Number(limit)), page: Number(page) });
  } catch (err) {
    console.error('[retenciones-recibidas GET /]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /:id/xml — descargar XML ──────────────────────────────
router.get('/:id/xml', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;
    const doc = await db.retenciones_recibidas.findFirst({
      where: { id: Number(req.params.id), empresaId },
      select: { xmlAutorizado: true, claveAcceso: true },
    });
    if (!doc) return res.status(404).json({ error: 'No encontrado' });
    if (!doc.xmlAutorizado) return res.status(404).json({ error: 'XML no disponible' });
    res.set('Content-Type', 'application/xml');
    res.set('Content-Disposition', `attachment; filename="ret-rec-${doc.claveAcceso}.xml"`);
    res.send(doc.xmlAutorizado);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /recalcular — re-parsea el XML guardado y corrige totales ────
// Repara registros importados antes del fix de parseo (tag <valorRetenido>
// del SRI se leía como <valorRetener>, quedando totales en $0.00).
// Idempotente: si el XML ya se parseaba bien, no cambia nada.
router.post('/recalcular', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa?.id ?? req.usuario?.empresaId ?? 1;

    const registros = await db.retenciones_recibidas.findMany({
      where: { empresaId, xmlAutorizado: { not: null } },
      select: { id: true, xmlAutorizado: true },
    });

    let corregidos = 0;
    let errores = 0;

    for (const r of registros) {
      try {
        const datos = parsearRetencionRecibida(r.xmlAutorizado, r.xmlAutorizado);
        await db.retenciones_recibidas.update({
          where: { id: r.id },
          data: {
            totalRetencionIva: datos.totalRetencionIva,
            totalRetencionRenta: datos.totalRetencionRenta,
            detalles: datos.detalles,
            numDocSustento: datos.numDocSustento,
          },
        });
        corregidos++;
      } catch (err) {
        console.error(`[retenciones-recibidas recalcular] id=${r.id}:`, err.message);
        errores++;
      }
    }

    res.json({ success: true, total: registros.length, corregidos, errores });
  } catch (err) {
    console.error('[retenciones-recibidas POST /recalcular]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
