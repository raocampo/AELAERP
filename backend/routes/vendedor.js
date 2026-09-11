// ====================================
// RUTAS: MÓDULO AGENTE VENDEDOR
// backend/routes/vendedor.js
// Ver docs/roadmap-agente-vendedor.md — Fase 1 (cartera de clientes).
// ====================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { normalizarRol } = require('../utils/roles');
const { scopeVendedor, saldoPendientePorCliente, estadoCuentaCliente } = require('../utils/vendedor');

router.use(proteger);
// req.prisma solo lo setea resolverTenant para tenants SaaS por subdominio;
// en monoinstancia queda undefined (mismo patrón que cxc.js/proformas.js).
router.use((req, _res, next) => { req.prisma = req.prisma || prisma; next(); });

function empresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

// GET /api/vendedor/clientes?q=  — mi cartera + saldo por cobrar de cada uno.
// Si el rol es exactamente 'vendedor' se acota a sus clientes; admin/
// supervisor (que también tienen vendedor.ver) ven todos.
router.get('/clientes', autorizarPermiso('vendedor.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const q = String(req.query.q || '').trim();

    const clientes = await db.clientes.findMany({
      where: {
        empresaId: eId,
        activo: true,
        ...scopeVendedor(req.usuario),
        ...(q
          ? {
              OR: [
                { razonSocial: { contains: q, mode: 'insensitive' } },
                { nombreComercial: { contains: q, mode: 'insensitive' } },
                { identificacion: { contains: q } },
              ],
            }
          : {}),
      },
      select: {
        id: true, identificacion: true, tipoIdentificacion: true,
        razonSocial: true, nombreComercial: true, direccion: true,
        telefono: true, email: true,
      },
      orderBy: { razonSocial: 'asc' },
      take: 300,
    });

    const saldos = await saldoPendientePorCliente(db, eId, clientes.map((c) => c.id));
    res.json({
      success: true,
      data: clientes.map((c) => ({ ...c, saldoPendiente: saldos.get(c.id) || 0 })),
    });
  } catch (err) {
    console.error('GET /vendedor/clientes:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar la cartera de clientes' });
  }
});

// GET /api/vendedor/clientes/:id — detalle del cliente + estado de cuenta
// (facturas autorizadas con saldo pendiente > 0).
router.get('/clientes/:id', autorizarPermiso('vendedor.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cliente = await db.clientes.findFirst({
      where: { id, empresaId: eId, ...scopeVendedor(req.usuario) },
      select: {
        id: true, identificacion: true, tipoIdentificacion: true,
        razonSocial: true, nombreComercial: true, direccion: true,
        telefono: true, email: true, vendedorId: true,
      },
    });
    if (!cliente) {
      return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado o no está en tu cartera' });
    }

    const estadoCuenta = await estadoCuentaCliente(db, eId, id);
    res.json({ success: true, data: { cliente, ...estadoCuenta } });
  } catch (err) {
    console.error('GET /vendedor/clientes/:id:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el detalle del cliente' });
  }
});

// ─── Administración (supervisor): asignar clientes a un vendedor ──────────────

// GET /api/vendedor/agentes — usuarios con rol vendedor de la empresa, para el
// selector de asignación en la web.
router.get('/agentes', autorizarPermiso('vendedor.asignar'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const usuarios = await db.usuarios.findMany({
      where: { empresaId: eId, activo: true },
      select: { id: true, nombre: true, username: true, rol: true },
      orderBy: { nombre: 'asc' },
    });
    const agentes = usuarios.filter((u) => normalizarRol(u.rol) === 'vendedor')
      .map(({ id, nombre, username }) => ({ id, nombre, username }));
    res.json({ success: true, data: agentes });
  } catch (err) {
    console.error('GET /vendedor/agentes:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar la lista de vendedores' });
  }
});

// POST /api/vendedor/asignar — asigna (o desasigna con vendedorId=null) un
// conjunto de clientes a un vendedor. Body: { clienteIds: number[], vendedorId }
router.post('/asignar', autorizarPermiso('vendedor.asignar'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const { clienteIds, vendedorId } = req.body || {};

    const ids = Array.isArray(clienteIds)
      ? clienteIds.map((n) => Number.parseInt(n, 10)).filter(Number.isFinite)
      : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Selecciona al menos un cliente' });
    }

    let nuevoVendedorId = null;
    if (vendedorId !== null && vendedorId !== undefined && vendedorId !== '') {
      nuevoVendedorId = Number.parseInt(vendedorId, 10);
      const vend = await db.usuarios.findFirst({
        where: { id: nuevoVendedorId, empresaId: eId, activo: true },
        select: { rol: true },
      });
      if (!vend || normalizarRol(vend.rol) !== 'vendedor') {
        return res.status(400).json({ success: false, mensaje: 'El usuario seleccionado no es un vendedor activo' });
      }
    }

    const r = await db.clientes.updateMany({
      where: { id: { in: ids }, empresaId: eId },
      data: { vendedorId: nuevoVendedorId },
    });
    res.json({ success: true, data: { actualizados: r.count, vendedorId: nuevoVendedorId } });
  } catch (err) {
    console.error('POST /vendedor/asignar:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo asignar los clientes' });
  }
});

module.exports = router;
