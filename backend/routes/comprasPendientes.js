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
    const { estado = 'PENDIENTE', compraId, busqueda, motivo } = req.query;

    const where = { empresaId };
    if (estado && estado !== 'TODOS') where.estado = String(estado).toUpperCase();
    if (motivo && motivo !== 'TODOS') where.motivo = String(motivo).toUpperCase();
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
        productoSugerido: { select: { id: true, codigoPrincipal: true, nombre: true, stockActual: true } },
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
      const compra = await tx.facturas_compra.findFirst({ where: { id: item.compraId, empresaId } });

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
        // Antes: item.codigoPrincipal — inconsistente con la referencia
        // (numeroFactura) que usan los otros 2 flujos que aplican
        // movimientos de compra (creación manual y "Integrar al
        // inventario"), lo que le impedía a esos flujos reconocer este
        // movimiento como ya aplicado y arriesgaba duplicarlo.
        referencia: compra?.numeroFactura || item.codigoPrincipal,
        observacion: item.motivo === 'POSIBLE_DUPLICADO'
          ? `Entrada por posible duplicado confirmado (ítem pendiente #${item.id})`
          : `Entrada por regalo/combo asignado manualmente (ítem pendiente #${item.id})`,
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

      // Reflejar la resolución en la línea de detalle de la compra origen —
      // antes esto nunca se hacía, así que la compra quedaba mostrando la
      // línea como "sin integrar" para siempre, y una corrida posterior de
      // "Integrar al inventario" la volvía a evaluar desde cero (podía
      // re-encolarla como pendiente otra vez).
      if (compra) {
        const detalles = Array.isArray(compra.detalles)
          ? compra.detalles
          : (typeof compra.detalles === 'string' ? JSON.parse(compra.detalles || '[]') : []);
        let sincronizado = false;
        const detallesActualizados = detalles.map((d) => {
          if (!sincronizado && !d.productoId && d.codigoPrincipal === item.codigoPrincipal) {
            sincronizado = true;
            return { ...d, productoId: producto.id, inventariable: producto.inventariable, movimientoAplicado: Boolean(movimiento) };
          }
          return d;
        });
        if (sincronizado) {
          await tx.facturas_compra.update({
            where: { id: compra.id },
            data: {
              detalles: detallesActualizados,
              ...(movimiento ? { movimientosInventario: (compra.movimientosInventario || 0) + 1 } : {}),
            },
          });
        }
      }

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

      const compra = await tx.facturas_compra.findFirst({ where: { id: item.compraId, empresaId } });

      let movimiento = null;
      if (nuevoProducto.inventariable) {
        movimiento = await aplicarMovimientoInventario({
          tx,
          empresaId,
          productoId: nuevoProducto.id,
          usuarioId,
          tipo: 'ENTRADA',
          deltaCantidad: item.cantidad,
          referencia: compra?.numeroFactura || item.codigoPrincipal,
          observacion: `Entrada inicial — producto creado desde ítem pendiente #${item.id}`,
          metadata: { itemPendienteId: item.id, compraId: item.compraId },
        });
      }

      const actualizado = await tx.items_compra_pendientes.update({
        where: { id: item.id },
        data: {
          estado: 'RESUELTO',
          productoAsignadoId: nuevoProducto.id,
          movimientoInventarioId: movimiento?.movimiento?.id || null,
          usuarioResuelveId: usuarioId,
          resueltoEn: new Date(),
        },
      });

      // Mismo fix que en /asignar: sincronizar el detalle de la compra
      // origen para que no quede "sin integrar" permanentemente.
      if (compra) {
        const detalles = Array.isArray(compra.detalles)
          ? compra.detalles
          : (typeof compra.detalles === 'string' ? JSON.parse(compra.detalles || '[]') : []);
        let sincronizado = false;
        const detallesActualizados = detalles.map((d) => {
          if (!sincronizado && !d.productoId && d.codigoPrincipal === item.codigoPrincipal) {
            sincronizado = true;
            return { ...d, productoId: nuevoProducto.id, inventariable: nuevoProducto.inventariable, movimientoAplicado: Boolean(movimiento) };
          }
          return d;
        });
        if (sincronizado) {
          await tx.facturas_compra.update({
            where: { id: compra.id },
            data: {
              detalles: detallesActualizados,
              ...(movimiento ? { movimientosInventario: (compra.movimientosInventario || 0) + 1 } : {}),
            },
          });
        }
      }

      return actualizado;
    });

    res.json({ success: true, data: resultado, mensaje: 'Producto creado y stock inicial registrado' });
  } catch (error) {
    console.error('POST /compras/pendientes/:id/crear-producto:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo crear el producto' });
  }
});

module.exports = router;
