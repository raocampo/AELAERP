// ====================================
// routes/cajas.js — AELA
// Cajas = terminales/registradoras físicas dentro de un Punto de Emisión SRI.
// Varias cajas pueden compartir un mismo punto de emisión (misma secuencia
// SRI) — el punto de emisión es un código autoasignado por la empresa, sin
// costo ni límite del SRI, a diferencia del establecimiento.
// ====================================
const express = require('express');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

const router = express.Router();

router.use(proteger);

function limpiarNombre(v) {
  return String(v || '').trim();
}

// GET /api/cajas?puntoEmisionId= — lista (todas, incluidas inactivas)
router.get('/', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const where = { empresaId: req.empresa.id };
    if (req.query.puntoEmisionId) where.puntoEmisionId = parseInt(req.query.puntoEmisionId, 10);

    const cajas = await prisma.cajas.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });
    res.json({ success: true, data: cajas });
  } catch (error) {
    console.error('GET /cajas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener las cajas' });
  }
});

// GET /api/cajas/activas — cajas activas de la empresa (o de un punto de
// emisión concreto), con su punto de emisión/sucursal embebidos, para poblar
// el selector del frontend (POS/Facturación). Si un punto de emisión no
// tiene ninguna caja todavía (no debería pasar tras el backfill de la
// migración, pero cubre puntos de emisión creados después), crea su "Caja
// General" por defecto — mismo patrón que /puntos-emision/activos.
router.get('/activas', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const puntoEmisionId = req.query.puntoEmisionId ? parseInt(req.query.puntoEmisionId, 10) : null;

    const wherePuntos = { empresaId, activo: true, ...(puntoEmisionId ? { id: puntoEmisionId } : {}) };
    const puntos = await prisma.puntos_emision.findMany({
      where: wherePuntos,
      include: { sucursal: true, cajas: { where: { activo: true }, orderBy: { nombre: 'asc' } } },
      orderBy: [{ establecimiento: 'asc' }, { puntoEmision: 'asc' }],
    });

    const resultado = [];
    for (const punto of puntos) {
      let { cajas } = punto;
      if (cajas.length === 0) {
        const creada = await prisma.cajas.create({
          data: { empresaId, puntoEmisionId: punto.id, nombre: 'Caja General' },
        });
        cajas = [creada];
      }
      const { cajas: _omit, ...puntoSinCajas } = punto;
      for (const caja of cajas) {
        resultado.push({ ...caja, puntoEmision: puntoSinCajas });
      }
    }

    res.json({ success: true, data: resultado });
  } catch (error) {
    console.error('GET /cajas/activas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener las cajas' });
  }
});

// POST /api/cajas — crear caja bajo un punto de emisión existente
router.post('/', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const puntoEmisionId = parseInt(req.body?.puntoEmisionId, 10);
    const nombre = limpiarNombre(req.body?.nombre);

    if (!puntoEmisionId) return res.status(400).json({ success: false, mensaje: 'Debes indicar el punto de emisión' });
    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre de la caja es requerido' });

    const punto = await prisma.puntos_emision.findFirst({ where: { id: puntoEmisionId, empresaId } });
    if (!punto) return res.status(404).json({ success: false, mensaje: 'Punto de emisión no encontrado' });

    if (req.empresa.maxCajas !== null && req.empresa.maxCajas !== undefined) {
      const totalCajas = await prisma.cajas.count({ where: { empresaId, activo: true } });
      if (totalCajas >= req.empresa.maxCajas) {
        return res.status(403).json({
          success: false,
          mensaje: `Tu plan permite un máximo de ${req.empresa.maxCajas} caja(s) activa(s). Contacta a soporte para ampliar el límite.`,
          limite: req.empresa.maxCajas,
        });
      }
    }

    const existente = await prisma.cajas.findFirst({ where: { puntoEmisionId, nombre } });
    if (existente) {
      return res.status(409).json({ success: false, mensaje: `Ya existe una caja "${nombre}" en ese punto de emisión` });
    }

    const creada = await prisma.cajas.create({ data: { empresaId, puntoEmisionId, nombre } });
    res.status(201).json({ success: true, data: creada, mensaje: 'Caja creada correctamente' });
  } catch (error) {
    console.error('POST /cajas:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear la caja' });
  }
});

// PUT /api/cajas/:id — renombrar / activar-desactivar
router.put('/:id', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const caja = await prisma.cajas.findFirst({ where: { id, empresaId } });
    if (!caja) return res.status(404).json({ success: false, mensaje: 'Caja no encontrada' });

    const data = {};
    if (req.body?.nombre !== undefined) {
      const nombre = limpiarNombre(req.body.nombre);
      if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre no puede quedar vacío' });
      data.nombre = nombre;
    }
    if (req.body?.activo !== undefined) data.activo = Boolean(req.body.activo);

    const actualizada = await prisma.cajas.update({ where: { id }, data });
    res.json({ success: true, data: actualizada, mensaje: 'Caja actualizada correctamente' });
  } catch (error) {
    console.error('PUT /cajas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la caja' });
  }
});

// DELETE /api/cajas/:id — soft-delete, bloquea si es la única caja activa
// de su punto de emisión (el punto de emisión debe seguir teniendo al menos
// una caja para poder facturar).
router.delete('/:id', autorizarPermiso('sucursales.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const caja = await prisma.cajas.findFirst({ where: { id, empresaId } });
    if (!caja) return res.status(404).json({ success: false, mensaje: 'Caja no encontrada' });

    const otrasActivas = await prisma.cajas.count({
      where: { puntoEmisionId: caja.puntoEmisionId, activo: true, id: { not: id } },
    });
    if (otrasActivas === 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'No puedes desactivar la última caja activa de este punto de emisión',
      });
    }

    await prisma.cajas.update({ where: { id }, data: { activo: false } });
    res.json({ success: true, mensaje: 'Caja desactivada correctamente' });
  } catch (error) {
    console.error('DELETE /cajas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo desactivar la caja' });
  }
});

module.exports = router;
