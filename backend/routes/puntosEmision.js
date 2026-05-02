const express  = require('express');
const router   = express.Router();
const prisma   = require('../config/prisma');
const { proteger } = require('../middleware/auth');

router.use(proteger);

// GET /api/puntos-emision
router.get('/', async (req, res) => {
  try {
    const puntos = await prisma.puntos_emision.findMany({
      where:   { empresaId: req.empresa.id },
      orderBy: [{ establecimiento: 'asc' }, { puntoEmision: 'asc' }],
    });
    res.json({ ok: true, puntos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/puntos-emision/activo
// Retorna (o crea) el punto de emisión que coincide con configuracion_sri activa
router.get('/activo', async (req, res) => {
  try {
    const config = await prisma.configuracion_sri.findFirst({
      where: { empresaId: req.empresa.id },
    });
    if (!config) return res.status(404).json({ ok: false, error: 'Sin configuración SRI' });

    let punto = await prisma.puntos_emision.findFirst({
      where: {
        empresaId:       req.empresa.id,
        establecimiento: config.establecimiento,
        puntoEmision:    config.puntoEmision,
      },
    });

    if (!punto) {
      punto = await prisma.puntos_emision.create({
        data: {
          empresaId:       req.empresa.id,
          establecimiento: config.establecimiento,
          puntoEmision:    config.puntoEmision,
        },
      });
    }

    res.json({ ok: true, punto });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// PUT /api/puntos-emision/:id
router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      descripcion,
      secInicialFactura,
      secInicialNotaCredito,
      secInicialNotaDebito,
      secInicialRetencion,
      secInicialLiquidacion,
      secInicialGuiaRemision,
      secInicialNotaVenta,
    } = req.body;

    const punto = await prisma.puntos_emision.findFirst({
      where: { id, empresaId: req.empresa.id },
    });
    if (!punto) return res.status(404).json({ ok: false, error: 'Punto de emisión no encontrado' });

    const toInt = (v, fallback) => {
      const n = parseInt(v, 10);
      return isNaN(n) ? fallback : Math.max(0, n);
    };

    const actualizado = await prisma.puntos_emision.update({
      where: { id },
      data: {
        descripcion:            descripcion?.trim() || punto.descripcion,
        secInicialFactura:      toInt(secInicialFactura,      punto.secInicialFactura),
        secInicialNotaCredito:  toInt(secInicialNotaCredito,  punto.secInicialNotaCredito),
        secInicialNotaDebito:   toInt(secInicialNotaDebito,   punto.secInicialNotaDebito),
        secInicialRetencion:    toInt(secInicialRetencion,    punto.secInicialRetencion),
        secInicialLiquidacion:  toInt(secInicialLiquidacion,  punto.secInicialLiquidacion),
        secInicialGuiaRemision: toInt(secInicialGuiaRemision, punto.secInicialGuiaRemision),
        secInicialNotaVenta:    toInt(secInicialNotaVenta,    punto.secInicialNotaVenta),
      },
    });

    res.json({ ok: true, punto: actualizado });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
