// ====================================
// RUTAS: CATÁLOGO DE PRODUCTOS Y SERVICIOS
// backend/routes/productos.js
// ====================================

const express = require('express');
const multer = require('multer');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { checkLimiteProductos } = require('../middleware/edition');
const {
  crearPlantillaProductosXlsx,
  leerFilasDesdeExcel,
  mapearFilaProducto,
  parsearProductosDesdeXmlFactura,
  obtenerXmlDesdeAutorizacion,
  importarProductos,
} = require('../utils/importacionProductos');

router.use(proteger);

const permitirVerProductos = autorizarPermiso('productos.ver');
const permitirGestionarProductos = autorizarPermiso('productos.gestionar');
const permitirEliminarProductos = autorizarPermiso('productos.eliminar');
const upload = multer({ storage: multer.memoryStorage() });

// ─── GET /api/productos  (lista con búsqueda y paginación) ───────────────────
router.get('/', permitirVerProductos, async (req, res) => {
  try {
    const { busqueda = '', page = 1, limit = 50, activo, inventariable, stockBajo } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const where = {
      empresaId: req.empresa.id,
      ...(activo !== undefined ? { activo: activo === 'true' } : {}),
      ...(inventariable !== undefined ? { inventariable: inventariable === 'true' } : {}),
      ...(busqueda ? {
        OR: [
          { codigoPrincipal: { contains: busqueda, mode: 'insensitive' } },
          { codigoAuxiliar: { contains: busqueda, mode: 'insensitive' } },
          { nombre: { contains: busqueda, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const itemsBase = await prisma.productos_servicios.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });

    const itemsFiltrados = stockBajo === 'true'
      ? itemsBase.filter((item) => item.inventariable && Number(item.stockActual) <= Number(item.stockMinimo || 0))
      : itemsBase;

    const total = itemsFiltrados.length;
    const items = itemsFiltrados.slice(skip, skip + parseInt(limit, 10));

    res.json({ data: items, total, page: parseInt(page, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener productos' });
  }
});

// ─── GET /api/productos/resumen ──────────────────────────────────────────────
router.get('/resumen', permitirVerProductos, async (req, res) => {
  try {
    const items = await prisma.productos_servicios.findMany({
      where: { empresaId: req.empresa.id, activo: true },
      select: { inventariable: true, stockActual: true, stockMinimo: true },
    });

    const inventariables = items.filter((item) => item.inventariable);
    const stockBajo = inventariables.filter((item) => Number(item.stockActual) <= Number(item.stockMinimo || 0)).length;
    const sinStock = inventariables.filter((item) => Number(item.stockActual) <= 0).length;

    res.json({
      data: {
        total: items.length,
        inventariables: inventariables.length,
        stockBajo,
        sinStock,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener resumen de productos' });
  }
});

// ─── GET /api/productos/buscar?q=  (autocomplete — máx 10) ─────────────────
router.get('/buscar', permitirVerProductos, async (req, res) => {
  try {
    const { q = '' } = req.query;
    if (!q || q.length < 1) return res.json({ data: [] });

    const items = await prisma.productos_servicios.findMany({
      where: {
        empresaId: req.empresa.id,
        activo: true,
        OR: [
          { codigoPrincipal: { contains: q, mode: 'insensitive' } },
          { codigoAuxiliar: { contains: q, mode: 'insensitive' } },
          { nombre: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { nombre: 'asc' },
      take: 10,
    });

    res.json({ data: items });
  } catch (err) {
    res.status(500).json({ error: 'Error en búsqueda' });
  }
});

router.get('/importacion/plantilla', permitirGestionarProductos, async (req, res) => {
  try {
    const buffer = crearPlantillaProductosXlsx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="aela-plantilla-productos.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('GET /productos/importacion/plantilla:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar la plantilla de productos' });
  }
});

router.post('/importacion/excel', permitirGestionarProductos, checkLimiteProductos, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, mensaje: 'Debes adjuntar un archivo Excel' });
    }

    const filas = leerFilasDesdeExcel(req.file.buffer);
    const productos = filas
      .map((fila, index) => mapearFilaProducto(fila, index))
      .filter(Boolean);

    if (productos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se encontraron filas válidas en el archivo' });
    }

    const registrarEntradaInventario = String(req.body?.registrarEntradaInventario || 'false') === 'true';

    const resultado = await req.prisma.$transaction(async (tx) => importarProductos({
      tx,
      empresaId: req.empresa.id,
      usuarioId: req.usuario.id,
      productos,
      registrarEntradaInventario,
      origen: 'excel',
    }));

    res.status(201).json({
      success: true,
      data: {
        ...resultado,
        totalFilas: filas.length,
        totalProcesadas: productos.length,
      },
      mensaje: 'Importación desde Excel completada',
    });
  } catch (error) {
    console.error('POST /productos/importacion/excel:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo importar el archivo Excel' });
  }
});

router.post('/importacion/xml', permitirGestionarProductos, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, mensaje: 'Debes adjuntar un archivo XML' });
    }

    const xml = req.file.buffer.toString('utf8');
    const margenUtilidad = Number(req.body?.margenUtilidad ?? 0) || 0;
    const productos = parsearProductosDesdeXmlFactura(xml, margenUtilidad);
    if (productos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se encontraron detalles importables en el XML' });
    }

    const registrarEntradaInventario = String(req.body?.registrarEntradaInventario || 'false') === 'true';
    const resultado = await req.prisma.$transaction(async (tx) => importarProductos({
      tx,
      empresaId: req.empresa.id,
      usuarioId: req.usuario.id,
      productos,
      registrarEntradaInventario,
      origen: 'xml',
    }));

    res.status(201).json({
      success: true,
      data: {
        ...resultado,
        totalProcesadas: productos.length,
      },
      mensaje: 'Importación desde XML completada',
    });
  } catch (error) {
    console.error('POST /productos/importacion/xml:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo importar el XML' });
  }
});

router.post('/importacion/autorizacion', permitirGestionarProductos, async (req, res) => {
  try {
    const claveAcceso = String(req.body?.claveAcceso || req.body?.numeroAutorizacion || '').trim();
    if (!claveAcceso) {
      return res.status(400).json({ success: false, mensaje: 'La autorización o clave de acceso es requerida' });
    }

    const { ambiente, xml } = await obtenerXmlDesdeAutorizacion(claveAcceso);
    const margenUtilidad = Number(req.body?.margenUtilidad ?? 0) || 0;
    const productos = parsearProductosDesdeXmlFactura(xml, margenUtilidad);
    if (productos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No se encontraron productos importables en el comprobante autorizado' });
    }

    const registrarEntradaInventario = String(req.body?.registrarEntradaInventario || 'false') === 'true';
    const resultado = await prisma.$transaction(async (tx) => importarProductos({
      tx,
      empresaId: req.empresa.id,
      usuarioId: req.usuario.id,
      productos,
      registrarEntradaInventario,
      origen: `autorizacion-${ambiente}`,
    }));

    res.status(201).json({
      success: true,
      data: {
        ...resultado,
        ambiente,
        claveAcceso,
        totalProcesadas: productos.length,
      },
      mensaje: 'Importación desde autorización SRI completada',
    });
  } catch (error) {
    console.error('POST /productos/importacion/autorizacion:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo importar desde la autorización SRI' });
  }
});

// ─── GET /api/productos/:id ──────────────────────────────────────────────────
router.get('/:id', permitirVerProductos, async (req, res) => {
  try {
    const item = await prisma.productos_servicios.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!item) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ data: item });
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener producto' });
  }
});

// ─── POST /api/productos  (crear) ─────────────────────────────────────────────
router.post('/', permitirGestionarProductos, checkLimiteProductos, async (req, res) => {
  try {
    const {
      codigoPrincipal,
      codigoAuxiliar,
      nombre,
      precioUnitario,
      costoUnitario,
      infoAdicional,
      tarifaIva,
      unidadMedida,
      inventariable,
      stockActual,
      stockMinimo,
      activo,
    } = req.body || {};

    if (!codigoPrincipal || !nombre || precioUnitario === undefined) {
      return res.status(400).json({ error: 'Código, nombre y precio son obligatorios' });
    }

    const item = await prisma.productos_servicios.create({
      data: {
        empresaId: req.empresa.id,
        codigoPrincipal: codigoPrincipal.trim().toUpperCase(),
        codigoAuxiliar: codigoAuxiliar ? codigoAuxiliar.trim() : null,
        nombre: nombre.trim(),
        precioUnitario: parseFloat(precioUnitario),
        costoUnitario: parseFloat(costoUnitario ?? 0),
        infoAdicional: infoAdicional ? infoAdicional.trim() : null,
        tarifaIva: parseInt(tarifaIva ?? 0, 10),
        unidadMedida: unidadMedida?.trim() || 'UND',
        inventariable: Boolean(inventariable),
        stockActual: parseFloat(stockActual ?? 0),
        stockMinimo: parseFloat(stockMinimo ?? 0),
        activo: activo !== undefined ? Boolean(activo) : true,
      },
    });
    res.status(201).json({ data: item, mensaje: 'Producto creado' });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'El código ya existe' });
    console.error(err);
    res.status(500).json({ error: 'Error al crear producto' });
  }
});

// ─── PUT /api/productos/:id  (editar) ─────────────────────────────────────────
router.put('/:id', permitirGestionarProductos, async (req, res) => {
  try {
    const {
      codigoPrincipal,
      codigoAuxiliar,
      nombre,
      precioUnitario,
      costoUnitario,
      infoAdicional,
      tarifaIva,
      activo,
      unidadMedida,
      inventariable,
      stockActual,
      stockMinimo,
    } = req.body || {};

    const actual = await prisma.productos_servicios.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!actual) return res.status(404).json({ error: 'Producto no encontrado' });

    const item = await prisma.productos_servicios.update({
      where: { id: actual.id },
      data: {
        ...(codigoPrincipal !== undefined ? { codigoPrincipal: codigoPrincipal.trim().toUpperCase() } : {}),
        ...(codigoAuxiliar !== undefined ? { codigoAuxiliar: codigoAuxiliar.trim() || null } : {}),
        ...(nombre !== undefined ? { nombre: nombre.trim() } : {}),
        ...(precioUnitario !== undefined ? { precioUnitario: parseFloat(precioUnitario) } : {}),
        ...(costoUnitario !== undefined ? { costoUnitario: parseFloat(costoUnitario) } : {}),
        ...(infoAdicional !== undefined ? { infoAdicional: infoAdicional.trim() || null } : {}),
        ...(tarifaIva !== undefined ? { tarifaIva: parseInt(tarifaIva, 10) } : {}),
        ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
        ...(unidadMedida !== undefined ? { unidadMedida: unidadMedida.trim() || 'UND' } : {}),
        ...(inventariable !== undefined ? { inventariable: Boolean(inventariable) } : {}),
        ...(stockActual !== undefined ? { stockActual: parseFloat(stockActual) } : {}),
        ...(stockMinimo !== undefined ? { stockMinimo: parseFloat(stockMinimo) } : {}),
      },
    });

    res.json({ data: item, mensaje: 'Producto actualizado' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Producto no encontrado' });
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

// ─── DELETE /api/productos/:id ────────────────────────────────────────────────
router.delete('/:id', permitirEliminarProductos, async (req, res) => {
  try {
    const actual = await prisma.productos_servicios.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
    });
    if (!actual) return res.status(404).json({ error: 'No encontrado' });

    await prisma.productos_servicios.delete({ where: { id: actual.id } });
    res.json({ mensaje: 'Producto eliminado' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'No encontrado' });
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

module.exports = router;
