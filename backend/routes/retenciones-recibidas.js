// ====================================
// RUTAS: RETENCIONES RECIBIDAS (del Buzón SRI)
// backend/routes/retenciones-recibidas.js
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

router.use(proteger);
router.use(autorizarPermiso('compras.gestionar'));

// ─── GET / — listar con filtros ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.usuario.empresaId;
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
    const doc = await db.retenciones_recibidas.findFirst({
      where: { id: Number(req.params.id), empresaId: req.usuario.empresaId },
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

module.exports = router;
