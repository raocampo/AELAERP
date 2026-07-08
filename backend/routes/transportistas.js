// ====================================
// RUTAS: CATÁLOGO DE TRANSPORTISTAS
// Autocompletado para Guías de Remisión — no reemplaza los campos planos
// embebidos en guias_remision (exigidos por el XSD del SRI), solo evita
// re-teclear los mismos datos en cada guía nueva.
// backend/routes/transportistas.js
// ====================================

const express = require('express');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

const router = express.Router();

router.use(proteger);
router.use(autorizarPermiso('facturacion.ver'));

function obtenerEmpresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

function parseIntSafe(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// GET /api/transportistas?q=busqueda
router.get('/', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { q, activo = 'true' } = req.query;
    const where = { empresaId };
    if (activo !== 'todos') where.activo = String(activo) === 'true';
    if (q) {
      where.OR = [
        { nombre: { contains: String(q), mode: 'insensitive' } },
        { identificacion: { contains: String(q) } },
      ];
    }

    const transportistas = await prisma.transportistas.findMany({
      where,
      orderBy: { nombre: 'asc' },
      take: 50,
    });
    res.json({ success: true, data: transportistas });
  } catch (error) {
    console.error('GET /transportistas:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar transportistas' });
  }
});

// POST /api/transportistas
router.post('/', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { identificacion, nombre, placaVehiculo = null } = req.body || {};
    if (!identificacion || !nombre) {
      return res.status(400).json({ success: false, mensaje: 'identificacion y nombre son requeridos' });
    }

    const transportista = await prisma.transportistas.create({
      data: {
        empresaId,
        identificacion: String(identificacion).trim(),
        nombre: String(nombre).trim(),
        placaVehiculo: placaVehiculo ? String(placaVehiculo).trim().toUpperCase() : null,
      },
    });
    res.status(201).json({ success: true, data: transportista });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Ya existe un transportista con esa identificación en esta empresa' });
    }
    console.error('POST /transportistas:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear transportista' });
  }
});

// PUT /api/transportistas/:id
router.put('/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.transportistas.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Transportista no encontrado' });

    const identificacion = req.body?.identificacion || actual.identificacion;
    const nombre = req.body?.nombre || actual.nombre;
    const placaVehiculo = req.body?.placaVehiculo === undefined ? actual.placaVehiculo : (req.body.placaVehiculo || null);
    const activo = req.body?.activo === undefined ? actual.activo : Boolean(req.body.activo);

    const transportista = await prisma.transportistas.update({
      where: { id },
      data: {
        identificacion: String(identificacion).trim(),
        nombre: String(nombre).trim(),
        placaVehiculo: placaVehiculo ? String(placaVehiculo).trim().toUpperCase() : null,
        activo,
      },
    });
    res.json({ success: true, data: transportista });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Ya existe un transportista con esa identificación en esta empresa' });
    }
    console.error('PUT /transportistas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar transportista' });
  }
});

// DELETE /api/transportistas/:id
router.delete('/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const transportista = await prisma.transportistas.findFirst({ where: { id, empresaId } });
    if (!transportista) return res.status(404).json({ success: false, mensaje: 'Transportista no encontrado' });

    // No hay FK desde guias_remision (campos planos embebidos) — el borrado es
    // siempre seguro para las guías ya emitidas, pero igual se ofrece desactivar.
    await prisma.transportistas.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Transportista eliminado' });
  } catch (error) {
    console.error('DELETE /transportistas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar transportista' });
  }
});

module.exports = router;
