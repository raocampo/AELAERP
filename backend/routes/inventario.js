const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { asegurarConfiguracionSistemaEmpresa } = require('../utils/configuracionSistema');
const { aplicarMovimientoInventario } = require('../utils/inventario');

router.use(proteger);

const permitirVerInventario = autorizarPermiso('inventario.ver');
const permitirGestionarInventario = autorizarPermiso('inventario.gestionar');
// 'eliminar-todo' es una operación masiva y destructiva (puede borrar productos
// del catálogo por completo) — se exige el permiso de eliminar productos
// (admin/supervisor), más estricto que 'inventario.gestionar' (que también
// incluye facturador/secretaria).
const permitirEliminarInventario = autorizarPermiso('productos.eliminar');

async function validarInventarioHabilitado(req, res, next) {
  try {
    const config = await asegurarConfiguracionSistemaEmpresa(req.empresa.id);
    if (!config?.inventarioHabilitado) {
      return res.status(403).json({
        success: false,
        mensaje: 'El módulo de inventario está deshabilitado en la configuración del sistema',
      });
    }
    req.configuracionSistema = config;
    next();
  } catch (error) {
    console.error('validarInventarioHabilitado:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo validar el inventario' });
  }
}

router.get('/resumen', permitirVerInventario, validarInventarioHabilitado, async (req, res) => {
  try {
    const where = { empresaId: req.empresa.id, activo: true };

    const [items, topMovimientos] = await Promise.all([
      prisma.productos_servicios.findMany({
        where,
        select: { inventariable: true, stockActual: true, stockMinimo: true },
      }),
      prisma.movimientos_inventario.findMany({
        where: { empresaId: req.empresa.id },
        include: {
          producto: { select: { id: true, codigoPrincipal: true, nombre: true } },
          usuario: { select: { id: true, nombre: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
    ]);

    const inventariablesItems = items.filter((item) => item.inventariable);
    const stockBajo = inventariablesItems.filter((item) => Number(item.stockActual) <= Number(item.stockMinimo || 0)).length;
    const sinStock = inventariablesItems.filter((item) => Number(item.stockActual) <= 0).length;
    const total = items.length;
    const inventariables = inventariablesItems.length;

    res.json({
      success: true,
      data: {
        resumen: { total, inventariables, stockBajo, sinStock },
        movimientos: topMovimientos,
      },
    });
  } catch (error) {
    console.error('GET /inventario/resumen:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el resumen de inventario' });
  }
});

// GET /api/inventario/movimientos/exportar/csv — descarga CSV de movimientos
router.get('/movimientos/exportar/csv', permitirVerInventario, validarInventarioHabilitado, async (req, res) => {
  try {
    const { productoId, tipo, fechaDesde, fechaHasta } = req.query;
    const where = { empresaId: req.empresa.id };

    if (productoId) where.productoId = parseInt(productoId, 10);
    if (tipo) where.tipo = tipo;
    if (fechaDesde || fechaHasta) {
      where.createdAt = {};
      if (fechaDesde) where.createdAt.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.createdAt.lte = hasta;
      }
    }

    const items = await prisma.movimientos_inventario.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: {
        producto: { select: { codigoPrincipal: true, nombre: true } },
        usuario: { select: { nombre: true } },
      },
    });

    const esc = (v) => {
      const s = String(v == null ? '' : v).replace(/"/g, '""');
      return `"${s}"`;
    };
    const fmtDate = (v) => v ? new Date(v).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : '';
    const fmtNum = (v, d = 3) => Number(v || 0).toFixed(d);

    const headers = [
      'ID', 'Fecha', 'Codigo Producto', 'Producto',
      'Tipo', 'Cantidad', 'Stock Anterior', 'Stock Nuevo',
      'Costo Unitario', 'Referencia', 'Observacion', 'Usuario',
    ];

    const rows = items.map((r) => [
      r.id, fmtDate(r.createdAt),
      r.producto?.codigoPrincipal || '', r.producto?.nombre || '',
      r.tipo, fmtNum(r.cantidad), fmtNum(r.stockAnterior), fmtNum(r.stockNuevo),
      fmtNum(r.costoUnitario, 4), r.referencia || '', r.observacion || '',
      r.usuario?.nombre || '',
    ].map(esc).join(','));

    const csv = [headers.map(esc).join(','), ...rows].join('\r\n');
    const fecha = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inventario-movimientos-${fecha}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (error) {
    console.error('GET /inventario/movimientos/exportar/csv:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo exportar el CSV de inventario' });
  }
});

router.get('/movimientos', permitirVerInventario, validarInventarioHabilitado, async (req, res) => {
  try {
    const { productoId, tipo, busqueda, limit = 100 } = req.query;
    const where = { empresaId: req.empresa.id };
    if (productoId) where.productoId = parseInt(productoId, 10);
    if (tipo) where.tipo = tipo;
    // Búsqueda por nombre/código del producto — el mismo cuadro "Buscar por
    // código o nombre" de arriba de la pantalla filtraba el Catálogo/Lista
    // pero no esta tabla, dando la falsa impresión de que "no filtra" nada.
    if (busqueda) {
      where.producto = {
        OR: [
          { nombre: { contains: busqueda, mode: 'insensitive' } },
          { codigoPrincipal: { contains: busqueda, mode: 'insensitive' } },
        ],
      };
    }

    const items = await prisma.movimientos_inventario.findMany({
      where,
      include: {
        producto: { select: { id: true, codigoPrincipal: true, nombre: true } },
        usuario: { select: { id: true, nombre: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /inventario/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudieron cargar los movimientos de inventario' });
  }
});

// POST /api/inventario/eliminar-todo — reinicia el stock de todos los productos
// inventariables a 0. Con eliminarProductos:true intenta borrar el producto del
// catálogo por completo (para productos mal creados/duplicados); si el producto
// tiene historial vinculado (ítems de compra pendientes) que impide el borrado
// por integridad referencial, cae de vuelta a solo reiniciar su stock.
router.post('/eliminar-todo', permitirEliminarInventario, validarInventarioHabilitado, async (req, res) => {
  try {
    const eliminarProductos = req.body?.eliminarProductos === true;
    const productos = await prisma.productos_servicios.findMany({
      where: { empresaId: req.empresa.id, inventariable: true },
    });

    let eliminados = 0;
    let stockReiniciado = 0;
    let noEliminadosPorReferencias = 0;

    for (const producto of productos) {
      if (eliminarProductos) {
        try {
          await prisma.productos_servicios.delete({ where: { id: producto.id } });
          eliminados += 1;
          continue;
        } catch (err) {
          noEliminadosPorReferencias += 1;
        }
      }

      if (Number(producto.stockActual) !== 0) {
        await prisma.$transaction(async (tx) => {
          const delta = -Number(producto.stockActual);
          await aplicarMovimientoInventario({
            tx,
            empresaId: req.empresa.id,
            productoId: producto.id,
            usuarioId: req.usuario.id,
            tipo: delta > 0 ? 'AJUSTE_POSITIVO' : 'AJUSTE_NEGATIVO',
            deltaCantidad: delta,
            referencia: 'RESET-INVENTARIO',
            observacion: 'Reinicio masivo de inventario',
          });
        });
      }
      stockReiniciado += 1;
    }

    let mensaje;
    if (eliminarProductos) {
      mensaje = `${eliminados} producto(s) eliminado(s) del catálogo.`;
      if (noEliminadosPorReferencias > 0) {
        mensaje += ` ${noEliminadosPorReferencias} no se pudieron eliminar por tener historial vinculado (compras) y se reiniciaron a stock 0.`;
      }
    } else {
      mensaje = `Stock reiniciado a 0 en ${stockReiniciado} producto(s).`;
    }

    res.json({
      success: true,
      data: { total: productos.length, eliminados, stockReiniciado, noEliminadosPorReferencias },
      mensaje,
    });
  } catch (error) {
    console.error('POST /inventario/eliminar-todo:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo eliminar el inventario' });
  }
});

router.post('/movimientos', permitirGestionarInventario, validarInventarioHabilitado, async (req, res) => {
  try {
    const { productoId, tipo, cantidad, referencia, observacion, costoUnitario } = req.body || {};
    const cantidadNum = Number(cantidad || 0);
    if (!productoId || cantidadNum <= 0) {
      return res.status(400).json({ success: false, mensaje: 'productoId y cantidad son requeridos' });
    }

    if (!['ENTRADA', 'SALIDA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo de movimiento inválido' });
    }

    const deltaCantidad = ['ENTRADA', 'AJUSTE_POSITIVO'].includes(tipo) ? cantidadNum : -cantidadNum;
    const data = await aplicarMovimientoInventario({
      empresaId: req.empresa.id,
      productoId,
      usuarioId: req.usuario.id,
      tipo,
      deltaCantidad,
      referencia,
      observacion,
      costoUnitario,
    });

    res.status(201).json({ success: true, data, mensaje: 'Movimiento de inventario registrado' });
  } catch (error) {
    console.error('POST /inventario/movimientos:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo registrar el movimiento de inventario' });
  }
});

module.exports = router;
