// ====================================
// RUTAS: MÓDULO AGENTE VENDEDOR
// backend/routes/vendedor.js
// Ver docs/roadmap-agente-vendedor.md — Fase 1 (cartera de clientes).
// ====================================

const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { normalizarRol } = require('../utils/roles');
const { scopeVendedor, saldoPendientePorCliente, estadoCuentaCliente } = require('../utils/vendedor');
const { siguienteSecuencial, formatNumero, calcularTotales } = require('../utils/proformas');

router.use(proteger);
// Módulo gateado por plan Medium/Pro (o "combo" vía modulosContratados) —
// ver utils/configuracionSistema.js. Un tenant Lite sin combo recibe 403 en
// TODA la ruta /api/vendedor, sea la app móvil o los usos embebidos en
// Clientes/Proformas (web).
router.use(requiereModulo('vendedorHabilitado'));
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

// ─── Fase 2 — Pedidos del vendedor (proformas con vendedorId) ─────────────────
// Ver docs/roadmap-agente-vendedor.md. Un "pedido" es una proforma normal:
// no afecta inventario, la oficina la convierte a factura con el flujo
// existente (marcar-convertida). Este wrapper solo fuerza los campos que
// garantizan el scoping (vendedorId, creadoPor, cliente de la cartera) y
// arranca en ENVIADA (no BORRADOR) porque ya es un pedido "en firme" tomado
// en la calle, no un borrador a medio llenar.

// POST /api/vendedor/pedidos — crear un pedido para un cliente de mi cartera.
router.post('/pedidos', autorizarPermiso('vendedor.pedidos'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const { clienteId, detalles = [], observaciones } = req.body || {};

    const cid = Number.parseInt(clienteId, 10);
    if (!Number.isFinite(cid)) {
      return res.status(400).json({ success: false, mensaje: 'Selecciona un cliente' });
    }
    if (!Array.isArray(detalles) || detalles.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debe incluir al menos un producto' });
    }

    // Sin walk-in: el cliente debe existir y estar en la cartera del
    // vendedor (scopeVendedor devuelve {} para admin/supervisor, que puede
    // tomar pedido para cualquier cliente de la empresa).
    const cliente = await db.clientes.findFirst({
      where: { id: cid, empresaId: eId, activo: true, ...scopeVendedor(req.usuario) },
      select: {
        id: true, tipoIdentificacion: true, identificacion: true,
        razonSocial: true, direccion: true, telefono: true, email: true,
      },
    });
    if (!cliente) {
      return res.status(404).json({ success: false, mensaje: 'Cliente no encontrado o no está en tu cartera' });
    }

    const totales = calcularTotales(detalles);
    const sec     = await siguienteSecuencial(db, eId);
    const numero  = formatNumero(sec);
    const rol     = normalizarRol(req.usuario.rol);
    const vendedorId = rol === 'vendedor' ? req.usuario.id : null;

    const [row] = await db.$queryRawUnsafe(`
      INSERT INTO proformas (
        "empresaId", "numero", "secuencial",
        "tipoIdentificacion", "identificacion", "razonSocial",
        "direccion", "email", "telefono", "clienteId",
        "subtotal0", "subtotal5", "subtotal15",
        "totalDescuento", "totalIva", "importeTotal",
        "detalles", "observaciones",
        "estado", "creadoPor", "vendedorId", "fechaEmision"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,NOW()
      ) RETURNING *
    `,
      eId, numero, sec,
      cliente.tipoIdentificacion, cliente.identificacion, cliente.razonSocial,
      cliente.direccion || null, cliente.email || null, cliente.telefono || null, cliente.id,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      'ENVIADA', req.usuario.id, vendedorId,
    );

    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('POST /vendedor/pedidos:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo crear el pedido' });
  }
});

// GET /api/vendedor/pedidos — mis pedidos (los de vendedorId = yo). admin/
// supervisor ven todos los de la empresa.
router.get('/pedidos', autorizarPermiso('vendedor.pedidos'), async (req, res) => {
  try {
    const db = req.prisma;
    const eId = empresaId(req);
    const soloMios = normalizarRol(req.usuario.rol) === 'vendedor';

    let where = `WHERE p."empresaId" = $1`;
    const params = [eId];
    if (soloMios) { where += ` AND p."vendedorId" = $2`; params.push(req.usuario.id); }

    const rows = await db.$queryRawUnsafe(`
      SELECT p.id, p.numero, p."razonSocial", p."identificacion", p."clienteId",
             p."importeTotal", p.estado, p."fechaEmision", p."createdAt", p."facturaId"
      FROM proformas p ${where}
      ORDER BY p."createdAt" DESC
      LIMIT 100
    `, ...params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /vendedor/pedidos:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar los pedidos' });
  }
});

module.exports = router;
