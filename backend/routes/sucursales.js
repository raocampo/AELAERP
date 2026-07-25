// ====================================
// routes/sucursales.js — AELA
// Sucursales = locales físicos de la empresa (concepto SRI "establecimiento").
// Cada sucursal agrupa uno o más Puntos de Venta/Cajas (ver puntosEmision.js).
// ====================================
const express = require('express');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

const router = express.Router();

router.use(proteger);
router.use(autorizarPermiso('sucursales.gestionar'));

function limpiarTexto(v) {
  return String(v || '').trim();
}

function limpiarEstablecimiento(v) {
  const solo3 = String(v || '').replace(/\D/g, '').slice(0, 3);
  return solo3.padStart(3, '0');
}

// GET /api/sucursales
router.get('/', async (req, res) => {
  try {
    const sucursales = await prisma.sucursales.findMany({
      where: { empresaId: req.empresa.id },
      include: { puntosEmision: { where: { activo: true }, orderBy: { puntoEmision: 'asc' } } },
      orderBy: [{ esMatriz: 'desc' }, { establecimiento: 'asc' }],
    });
    res.json({ success: true, data: sucursales });
  } catch (error) {
    console.error('GET /sucursales:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener las sucursales' });
  }
});

// POST /api/sucursales
router.post('/', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const nombre = limpiarTexto(req.body?.nombre);
    const establecimiento = limpiarEstablecimiento(req.body?.establecimiento);
    const direccion = limpiarTexto(req.body?.direccion) || null;
    const telefono = limpiarTexto(req.body?.telefono) || null;

    if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre de la sucursal es requerido' });
    if (!/^\d{3}$/.test(establecimiento)) {
      return res.status(400).json({ success: false, mensaje: 'El establecimiento debe ser un código de 3 dígitos (ej. 001)' });
    }

    const existente = await prisma.sucursales.findFirst({ where: { empresaId, establecimiento } });
    if (existente) {
      return res.status(409).json({ success: false, mensaje: `Ya existe una sucursal con el establecimiento ${establecimiento}` });
    }

    const creada = await prisma.sucursales.create({
      data: { empresaId, nombre, establecimiento, direccion, telefono, esMatriz: false, activo: true },
    });

    res.status(201).json({ success: true, data: creada, mensaje: 'Sucursal creada correctamente' });
  } catch (error) {
    console.error('POST /sucursales:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear la sucursal' });
  }
});

// PUT /api/sucursales/:id
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const sucursal = await prisma.sucursales.findFirst({ where: { id, empresaId } });
    if (!sucursal) return res.status(404).json({ success: false, mensaje: 'Sucursal no encontrada' });

    const data = {};
    if (req.body?.nombre !== undefined) {
      const nombre = limpiarTexto(req.body.nombre);
      if (!nombre) return res.status(400).json({ success: false, mensaje: 'El nombre no puede quedar vacío' });
      data.nombre = nombre;
    }
    if (req.body?.direccion !== undefined) data.direccion = limpiarTexto(req.body.direccion) || null;
    if (req.body?.telefono !== undefined) data.telefono = limpiarTexto(req.body.telefono) || null;
    if (req.body?.activo !== undefined) {
      if (sucursal.esMatriz && !req.body.activo) {
        return res.status(400).json({ success: false, mensaje: 'La sucursal Matriz no se puede desactivar' });
      }
      data.activo = Boolean(req.body.activo);
    }
    // El establecimiento NO se permite editar aquí: cambia la numeración SRI
    // de todos los puntos de venta ya emitidos bajo esa sucursal — si el
    // cliente se equivocó al crearla, debe eliminarla (sin documentos aún)
    // y crear una nueva con el código correcto.

    const actualizada = await prisma.sucursales.update({ where: { id }, data });
    res.json({ success: true, data: actualizada, mensaje: 'Sucursal actualizada correctamente' });
  } catch (error) {
    console.error('PUT /sucursales/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la sucursal' });
  }
});

// DELETE /api/sucursales/:id — soft-delete (activo=false)
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id = parseInt(req.params.id, 10);

    const sucursal = await prisma.sucursales.findFirst({
      where: { id, empresaId },
      include: { puntosEmision: { where: { activo: true } } },
    });
    if (!sucursal) return res.status(404).json({ success: false, mensaje: 'Sucursal no encontrada' });
    if (sucursal.esMatriz) {
      return res.status(400).json({ success: false, mensaje: 'La sucursal Matriz no se puede eliminar' });
    }
    if (sucursal.puntosEmision.length > 0) {
      return res.status(400).json({
        success: false,
        mensaje: 'Esta sucursal tiene puntos de venta activos — desactívalos primero',
      });
    }

    await prisma.sucursales.update({ where: { id }, data: { activo: false } });
    res.json({ success: true, mensaje: 'Sucursal desactivada correctamente' });
  } catch (error) {
    console.error('DELETE /sucursales/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo eliminar la sucursal' });
  }
});

module.exports = router;
