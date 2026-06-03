// ============================================================
//  AELA — Tabla de Utilidades / Márgenes de ganancia
//  backend/routes/utilidades.js
//
//  GET  /api/utilidades           → listar márgenes de la empresa
//  POST /api/utilidades           → crear nuevo margen
//  PUT  /api/utilidades/:id       → actualizar margen
//  DELETE /api/utilidades/:id     → eliminar margen
//  GET  /api/utilidades/calcular  → calcular PVP dado costo + id de margen
// ============================================================

const express = require('express');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

const router = express.Router();
router.use(proteger);

// GET /api/utilidades
router.get('/', async (req, res) => {
  try {
    const items = await prisma.tabla_utilidades.findMany({
      where:   { empresaId: req.empresa.id },
      orderBy: { porcentaje: 'asc' },
    });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// POST /api/utilidades
router.post('/', autorizarPermiso('sistema.configurar'), async (req, res) => {
  const { nombre, porcentaje, descripcion } = req.body || {};
  if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
  if (porcentaje === undefined || isNaN(Number(porcentaje))) {
    return res.status(400).json({ success: false, mensaje: 'El porcentaje es requerido' });
  }
  try {
    const item = await prisma.tabla_utilidades.create({
      data: {
        empresaId:   req.empresa.id,
        nombre:      nombre.trim(),
        porcentaje:  Number(porcentaje),
        descripcion: descripcion?.trim() || null,
      },
    });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// PUT /api/utilidades/:id
router.put('/:id', autorizarPermiso('sistema.configurar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, porcentaje, descripcion, activo } = req.body || {};
  try {
    const item = await prisma.tabla_utilidades.updateMany({
      where: { id, empresaId: req.empresa.id },
      data: {
        ...(nombre !== undefined     ? { nombre:      nombre.trim() }           : {}),
        ...(porcentaje !== undefined ? { porcentaje:  Number(porcentaje) }      : {}),
        ...(descripcion !== undefined? { descripcion: descripcion?.trim()||null }: {}),
        ...(activo !== undefined     ? { activo:      Boolean(activo) }         : {}),
        updatedAt: new Date(),
      },
    });
    if (item.count === 0) return res.status(404).json({ success: false, mensaje: 'No encontrado' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// DELETE /api/utilidades/:id
router.delete('/:id', autorizarPermiso('sistema.configurar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await prisma.tabla_utilidades.deleteMany({ where: { id, empresaId: req.empresa.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// GET /api/utilidades/calcular?costo=100&utilidadId=1
// Calcula el PVP dado un costo y un margen de la tabla
router.get('/calcular', (req, res) => {
  const costo    = parseFloat(req.query.costo || 0);
  const pct      = parseFloat(req.query.porcentaje || 0);
  if (isNaN(costo) || costo <= 0) return res.status(400).json({ success: false, mensaje: 'Costo inválido' });
  const pvp = Number((costo * (1 + pct / 100)).toFixed(4));
  res.json({ success: true, costo, porcentaje: pct, pvp });
});

module.exports = router;
