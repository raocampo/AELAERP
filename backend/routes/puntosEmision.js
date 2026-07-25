const express  = require('express');
const router   = express.Router();
const prisma   = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

router.use(proteger);

// Encuentra (o crea) la sucursal correspondiente a un establecimiento SRI.
// Si es la primera sucursal de la empresa, se marca como Matriz — cubre la
// migración lazy de tenants creados antes de esta feature (nunca tuvieron
// que crear una sucursal manualmente, así que se crea sola la primera vez
// que se necesita).
async function asegurarSucursalParaEstablecimiento(empresaId, establecimiento) {
  const existente = await prisma.sucursales.findFirst({ where: { empresaId, establecimiento } });
  if (existente) return existente;

  const totalSucursales = await prisma.sucursales.count({ where: { empresaId } });
  return prisma.sucursales.create({
    data: {
      empresaId,
      establecimiento,
      nombre: totalSucursales === 0 ? 'Matriz' : `Sucursal ${establecimiento}`,
      esMatriz: totalSucursales === 0,
      activo: true,
    },
  });
}

// GET /api/puntos-emision
router.get('/', async (req, res) => {
  try {
    const where = { empresaId: req.empresa.id };
    if (req.query.sucursalId) where.sucursalId = parseInt(req.query.sucursalId, 10);

    const puntos = await prisma.puntos_emision.findMany({
      where,
      include: { sucursal: true },
      orderBy: [{ establecimiento: 'asc' }, { puntoEmision: 'asc' }],
    });
    res.json({ ok: true, puntos });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/puntos-emision/activos — lista los puntos de venta activos con su
// sucursal embebida, para poblar el selector del frontend (POS/Facturación).
// Si la empresa no tiene ninguno todavía (tenant creado antes de esta
// feature), crea el default a partir de configuracion_sri — así ningún
// tenant existente se queda sin poder facturar.
router.get('/activos', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    let puntos = await prisma.puntos_emision.findMany({
      where: { empresaId, activo: true },
      include: { sucursal: true },
      orderBy: [{ establecimiento: 'asc' }, { puntoEmision: 'asc' }],
    });

    if (puntos.length === 0) {
      const config = await prisma.configuracion_sri.findFirst({ where: { empresaId } });
      const establecimiento = config?.establecimiento || '001';
      const puntoEmision = config?.puntoEmision || '001';
      const sucursal = await asegurarSucursalParaEstablecimiento(empresaId, establecimiento);
      const nuevo = await prisma.puntos_emision.create({
        data: { empresaId, sucursalId: sucursal.id, establecimiento, puntoEmision, descripcion: 'Caja General' },
      });
      puntos = [{ ...nuevo, sucursal }];
    }

    res.json({ success: true, data: puntos });
  } catch (err) {
    console.error('GET /puntos-emision/activos:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener los puntos de venta' });
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

    let sucursal = punto?.sucursalId
      ? await prisma.sucursales.findUnique({ where: { id: punto.sucursalId } })
      : null;
    if (!sucursal) {
      sucursal = await asegurarSucursalParaEstablecimiento(req.empresa.id, config.establecimiento);
    }

    if (!punto) {
      punto = await prisma.puntos_emision.create({
        data: {
          empresaId:       req.empresa.id,
          sucursalId:      sucursal.id,
          establecimiento: config.establecimiento,
          puntoEmision:    config.puntoEmision,
        },
      });
    } else if (!punto.sucursalId) {
      punto = await prisma.puntos_emision.update({ where: { id: punto.id }, data: { sucursalId: sucursal.id } });
    }

    res.json({ ok: true, punto: { ...punto, sucursal } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/puntos-emision — crear un punto de venta/caja bajo una sucursal existente
router.post('/', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const sucursalId = parseInt(req.body?.sucursalId, 10);
    const puntoEmisionCodigo = String(req.body?.puntoEmision || '').replace(/\D/g, '').slice(0, 3).padStart(3, '0');
    const descripcion = String(req.body?.descripcion || '').trim() || null;

    if (!sucursalId) return res.status(400).json({ success: false, mensaje: 'Debes indicar la sucursal' });
    if (!/^\d{3}$/.test(puntoEmisionCodigo)) {
      return res.status(400).json({ success: false, mensaje: 'El punto de emisión debe ser un código de 3 dígitos (ej. 001)' });
    }

    const sucursal = await prisma.sucursales.findFirst({ where: { id: sucursalId, empresaId } });
    if (!sucursal) return res.status(404).json({ success: false, mensaje: 'Sucursal no encontrada' });

    // establecimiento siempre se deriva de la sucursal — nunca se acepta del body.
    const existente = await prisma.puntos_emision.findFirst({
      where: { empresaId, establecimiento: sucursal.establecimiento, puntoEmision: puntoEmisionCodigo },
    });
    if (existente) {
      return res.status(409).json({
        success: false,
        mensaje: `Ya existe el punto de venta ${sucursal.establecimiento}-${puntoEmisionCodigo}`,
      });
    }

    const creado = await prisma.puntos_emision.create({
      data: {
        empresaId,
        sucursalId,
        establecimiento: sucursal.establecimiento,
        puntoEmision: puntoEmisionCodigo,
        descripcion,
      },
    });

    res.status(201).json({ success: true, data: { ...creado, sucursal }, mensaje: 'Punto de venta creado correctamente' });
  } catch (err) {
    console.error('POST /puntos-emision:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear el punto de venta' });
  }
});

// PUT /api/puntos-emision/:id
router.put('/:id', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      descripcion,
      activo,
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
        activo:                 activo !== undefined ? Boolean(activo) : punto.activo,
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

// DELETE /api/puntos-emision/:id — soft-delete (activo=false)
router.delete('/:id', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const punto = await prisma.puntos_emision.findFirst({ where: { id, empresaId } });
    if (!punto) return res.status(404).json({ success: false, mensaje: 'Punto de venta no encontrado' });

    await prisma.puntos_emision.update({ where: { id }, data: { activo: false } });
    res.json({ success: true, mensaje: 'Punto de venta desactivado correctamente' });
  } catch (err) {
    console.error('DELETE /puntos-emision/:id:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo desactivar el punto de venta' });
  }
});

module.exports = router;
