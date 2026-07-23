// ====================================
// routes/comprasPendientes.js — AELA
// "Obsequios pendientes": ítems de detalle de compra a $0.00 (regalos/combos
// de proveedor) que no matchearon con ningún producto y no se crearon como
// producto huérfano — quedan aquí para resolución manual.
// Montado como sub-ruta dentro de routes/compras.js (/api/compras/pendientes),
// hereda su middleware de auth/permiso/módulo.
// ====================================
const express = require('express');
const prisma = require('../config/prisma');
const { aplicarMovimientoInventario } = require('../utils/inventario');

const router = express.Router();

// GET /api/compras/pendientes — lista de ítems (filtros: estado, compraId, busqueda)
router.get('/', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { estado = 'PENDIENTE', compraId, busqueda } = req.query;

    const where = { empresaId };
    if (estado && estado !== 'TODOS') where.estado = String(estado).toUpperCase();
    if (compraId) where.compraId = parseInt(compraId, 10);
    if (busqueda) {
      where.OR = [
        { descripcion: { contains: busqueda, mode: 'insensitive' } },
        { codigoPrincipal: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const items = await prisma.items_compra_pendientes.findMany({
      where,
      include: {
        compra: { select: { numeroFactura: true, razonSocialProveedor: true, fechaEmision: true } },
        productoAsignado: { select: { id: true, codigoPrincipal: true, nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /compras/pendientes:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron obtener los ítems pendientes' });
  }
});

// POST /api/compras/pendientes/:id/asignar — suma la cantidad a un producto ya existente
router.post('/:id/asignar', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const id = parseInt(req.params.id, 10);
    const { productoId } = req.body || {};

    if (!productoId) {
      return res.status(400).json({ success: false, mensaje: 'Debes indicar el producto a asignar' });
    }

    const item = await prisma.items_compra_pendientes.findFirst({ where: { id, empresaId } });
    if (!item) return res.status(404).json({ success: false, mensaje: 'Ítem pendiente no encontrado' });
    if (item.estado !== 'PENDIENTE') {
      return res.status(400).json({ success: false, mensaje: 'Este ítem ya fue resuelto' });
    }

    const producto = await prisma.productos_servicios.findFirst({
      where: { id: parseInt(productoId, 10), empresaId },
    });
    if (!producto) return res.status(404).json({ success: false, mensaje: 'Producto no encontrado' });

    const resultado = await prisma.$transaction(async (tx) => {
      // Regalo/combo a $0: NO pasar costoUnitario, para no sobreescribir el
      // costo real del producto asignado (aplicarMovimientoInventario
      // sobreescribe el costo, no lo promedia).
      const movimiento = await aplicarMovimientoInventario({
        tx,
        empresaId,
        productoId: producto.id,
        usuarioId,
        tipo: 'ENTRADA',
        deltaCantidad: item.cantidad,
        referencia: item.codigoPrincipal,
        observacion: `Entrada por regalo/combo asignado manualmente (ítem pendiente #${item.id})`,
        metadata: { itemPendienteId: item.id, compraId: item.compraId },
      });

      const actualizado = await tx.items_compra_pendientes.update({
        where: { id: item.id },
        data: {
          estado: 'RESUELTO',
          productoAsignadoId: producto.id,
          movimientoInventarioId: movimiento?.movimiento?.id || null,
          usuarioResuelveId: usuarioId,
          resueltoEn: new Date(),
        },
      });

      return { actualizado, movimientoAplicado: Boolean(movimiento) };
    });

    res.json({
      success: true,
      data: resultado.actualizado,
      mensaje: resultado.movimientoAplicado
        ? 'Ítem asignado y stock actualizado correctamente'
        : 'Ítem marcado como resuelto, pero no se aplicó movimiento de inventario (inventario deshabilitado o producto no inventariable)',
    });
  } catch (error) {
    console.error('POST /compras/pendientes/:id/asignar:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo asignar el ítem' });
  }
});

// POST /api/compras/pendientes/:id/ignorar — sin efecto en inventario
router.post('/:id/ignorar', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const id = parseInt(req.params.id, 10);

    const item = await prisma.items_compra_pendientes.findFirst({ where: { id, empresaId } });
    if (!item) return res.status(404).json({ success: false, mensaje: 'Ítem pendiente no encontrado' });
    if (item.estado !== 'PENDIENTE') {
      return res.status(400).json({ success: false, mensaje: 'Este ítem ya fue resuelto' });
    }

    const actualizado = await prisma.items_compra_pendientes.update({
      where: { id: item.id },
      data: { estado: 'IGNORADO', usuarioResuelveId: usuarioId, resueltoEn: new Date() },
    });

    res.json({ success: true, data: actualizado, mensaje: 'Ítem ignorado' });
  } catch (error) {
    console.error('POST /compras/pendientes/:id/ignorar:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo ignorar el ítem' });
  }
});

// POST /api/compras/pendientes/:id/crear-producto — crea el producto (opt-in explícito) y su stock inicial
router.post('/:id/crear-producto', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const usuarioId = req.usuario?.id || null;
    const id = parseInt(req.params.id, 10);
    const { precioUnitario, tarifaIva = 0, inventariable = true } = req.body || {};

    const item = await prisma.items_compra_pendientes.findFirst({ where: { id, empresaId } });
    if (!item) return res.status(404).json({ success: false, mensaje: 'Ítem pendiente no encontrado' });
    if (item.estado !== 'PENDIENTE') {
      return res.status(400).json({ success: false, mensaje: 'Este ítem ya fue resuelto' });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const existente = await tx.productos_servicios.findFirst({
        where: { empresaId, codigoPrincipal: item.codigoPrincipal },
      });
      if (existente) {
        throw new Error(`Ya existe un producto con el código ${item.codigoPrincipal} — usa "Asignar a producto existente" en su lugar`);
      }

      const nuevoProducto = await tx.productos_servicios.create({
        data: {
          empresaId,
          codigoPrincipal: item.codigoPrincipal,
          codigoAuxiliar: item.codigoAuxiliar || null,
          nombre: item.descripcion,
          precioUnitario: Number(precioUnitario) || 0,
          costoUnitario: 0,
          tarifaIva: Number(tarifaIva) || 0,
          unidadMedida: 'UND',
          inventariable: Boolean(inventariable),
          stockActual: 0,
          stockMinimo: 0,
          activo: true,
          infoAdicional: 'Creado manualmente desde Obsequios pendientes',
        },
      });

      let movimiento = null;
      if (nuevoProducto.inventariable) {
        movimiento = await aplicarMovimientoInventario({
          tx,
          empresaId,
          productoId: nuevoProducto.id,
          usuarioId,
          tipo: 'ENTRADA',
          deltaCantidad: item.cantidad,
          referencia: item.codigoPrincipal,
          observacion: `Entrada inicial — producto creado desde ítem pendiente #${item.id}`,
          metadata: { itemPendienteId: item.id, compraId: item.compraId },
        });
      }

      return tx.items_compra_pendientes.update({
        where: { id: item.id },
        data: {
          estado: 'RESUELTO',
          productoAsignadoId: nuevoProducto.id,
          movimientoInventarioId: movimiento?.movimiento?.id || null,
          usuarioResuelveId: usuarioId,
          resueltoEn: new Date(),
        },
      });
    });

    res.json({ success: true, data: resultado, mensaje: 'Producto creado y stock inicial registrado' });
  } catch (error) {
    console.error('POST /compras/pendientes/:id/crear-producto:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo crear el producto' });
  }
});

module.exports = router;
