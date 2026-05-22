const express = require('express');
const multer = require('multer');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const { registrarAuditoria } = require('../utils/auditoria');
const { aplicarMovimientoInventario } = require('../utils/inventario');
const { registrarMovimientoCaja } = require('../utils/caja');
const { crearAsientoFacturaCompraRegistrada } = require('../utils/contabilidad');
const {
  parsearFacturaCompraDesdeXml,
  obtenerXmlDesdeAutorizacion,
} = require('../utils/importacionProductos');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Cache de columnas opcionales en facturas_compra (pueden no existir si migración pendiente)
let _colsCompra = null;
async function getColsCompra() {
  if (_colsCompra) return _colsCompra;
  const probar = async (col) => {
    try {
      await prisma.$queryRawUnsafe(`SELECT "${col}" FROM "facturas_compra" LIMIT 0`);
      return true;
    } catch {
      console.warn(`[compras] columna ${col} no existe — omitida`);
      return false;
    }
  };
  const [tipoGasto, anulada, motivoAnulacion] = await Promise.all([
    probar('tipoGasto'), probar('anulada'), probar('motivoAnulacion'),
  ]);
  _colsCompra = { tipoGasto, anulada, motivoAnulacion };
  return _colsCompra;
}

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('comprasHabilitadas'));
router.use(autorizarPermiso('compras.gestionar'));

function limpiarTexto(valor) {
  return String(valor || '').trim();
}

function limpiarCodigo(valor) {
  return limpiarTexto(valor).toUpperCase();
}

function toNumber(valor, fallback = 0) {
  if (valor === null || valor === undefined || valor === '') return fallback;
  const normalizado = String(valor).replace(/,/g, '.').replace(/[^\d.-]/g, '');
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : fallback;
}

function toBoolean(valor, fallback = false) {
  if (typeof valor === 'boolean') return valor;
  if (valor === null || valor === undefined || valor === '') return fallback;
  return ['1', 'true', 'si', 'sí', 'on'].includes(String(valor).trim().toLowerCase());
}

function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function generarCodigoDesdeDescripcion(descripcion = '', index = 0) {
  const base = limpiarTexto(descripcion)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24);
  return base || `COMP-${String(index + 1).padStart(3, '0')}`;
}

function normalizarNumeroFactura(numeroFactura = '') {
  const limpio = limpiarTexto(numeroFactura);
  if (!limpio) return '';
  const soloDigitos = limpio.replace(/\D/g, '');
  if (soloDigitos.length === 15) {
    return `${soloDigitos.slice(0, 3)}-${soloDigitos.slice(3, 6)}-${soloDigitos.slice(6)}`;
  }
  return limpio;
}

async function upsertProveedorCompra(tx, {
  empresaId,
  proveedorId,
  tipoIdentificacionProveedor,
  identificacionProveedor,
  razonSocialProveedor,
  nombreComercialProveedor,
  direccionProveedor,
}) {
  const tipoIdentificacion = limpiarTexto(tipoIdentificacionProveedor);
  const identificacion = limpiarTexto(identificacionProveedor);
  const razonSocial = limpiarTexto(razonSocialProveedor);
  const nombreComercial = limpiarTexto(nombreComercialProveedor) || null;
  const direccion = limpiarTexto(direccionProveedor) || null;

  if (!tipoIdentificacion || !identificacion || !razonSocial) return null;

  const proveedorIdNum = proveedorId ? parseInt(proveedorId, 10) : null;
  let proveedor = null;

  if (proveedorIdNum) {
    proveedor = await tx.proveedores.findFirst({
      where: { id: proveedorIdNum, empresaId },
    });

    if (!proveedor) {
      throw new Error('Proveedor seleccionado no pertenece a la empresa activa');
    }
  }

  if (!proveedor) {
    proveedor = await tx.proveedores.findFirst({
      where: { empresaId, identificacion },
    });
  }

  if (proveedor) {
    return tx.proveedores.update({
      where: { id: proveedor.id },
      data: {
        tipoIdentificacion,
        identificacion,
        razonSocial,
        nombreComercial: nombreComercial || proveedor.nombreComercial,
        direccion: direccion || proveedor.direccion,
        activo: true,
      },
    });
  }

  return tx.proveedores.create({
    data: {
      empresaId,
      tipoIdentificacion,
      identificacion,
      razonSocial,
      nombreComercial,
      direccion,
      activo: true,
    },
  });
}

function normalizarDetalle(detalle, index = 0) {
  const descripcion = limpiarTexto(detalle?.descripcion || detalle?.nombre || '');
  const cantidad = Number(toNumber(detalle?.cantidad, 0).toFixed(3));
  const precioUnitario = Number(toNumber(detalle?.precioUnitario, 0).toFixed(4));
  const descuento = Number(toNumber(detalle?.descuento, 0).toFixed(2));
  const porcentajeIva = Math.max(0, Math.round(toNumber(detalle?.porcentajeIva, 0)));

  if (!descripcion) {
    throw new Error(`La descripcion es requerida en la linea ${index + 1}`);
  }
  if (cantidad <= 0) {
    throw new Error(`La cantidad debe ser mayor a 0 en la linea ${index + 1}`);
  }
  if (precioUnitario < 0) {
    throw new Error(`El precio unitario no puede ser negativo en la linea ${index + 1}`);
  }

  const subtotal = Number(Math.max((cantidad * precioUnitario) - descuento, 0).toFixed(2));
  const totalIva = Number((subtotal * (porcentajeIva / 100)).toFixed(2));
  const total = Number((subtotal + totalIva).toFixed(2));

  return {
    productoId: detalle?.productoId ? parseInt(detalle.productoId, 10) : null,
    codigoPrincipal: limpiarCodigo(detalle?.codigoPrincipal || generarCodigoDesdeDescripcion(descripcion, index)),
    codigoAuxiliar: limpiarTexto(detalle?.codigoAuxiliar || '') || null,
    descripcion,
    cantidad,
    precioUnitario,
    descuento,
    porcentajeIva,
    subtotal,
    totalIva,
    total,
    inventariable: toBoolean(detalle?.inventariable, true),
    precioVentaReferencial: Number(toNumber(detalle?.precioVentaReferencial, precioUnitario).toFixed(4)),
  };
}

async function buscarProductoCoincidente(tx, empresaId, detalle) {
  if (detalle.productoId) {
    const porId = await tx.productos_servicios.findFirst({
      where: { id: detalle.productoId, empresaId },
    });
    if (porId) return porId;
  }

  if (detalle.codigoPrincipal) {
    const porCodigo = await tx.productos_servicios.findFirst({
      where: { empresaId, codigoPrincipal: detalle.codigoPrincipal },
    });
    if (porCodigo) return porCodigo;
  }

  if (detalle.codigoAuxiliar) {
    return tx.productos_servicios.findFirst({
      where: { empresaId, codigoAuxiliar: detalle.codigoAuxiliar },
    });
  }

  return null;
}

async function resolverProductoCompra({
  tx,
  empresaId,
  detalle,
  crearProductosFaltantes = false,
  actualizarProductosExistentes = true,
}) {
  let producto = await buscarProductoCoincidente(tx, empresaId, detalle);

  if (!producto && !crearProductosFaltantes) return null;

  if (!producto) {
    producto = await tx.productos_servicios.create({
      data: {
        empresaId,
        codigoPrincipal: detalle.codigoPrincipal,
        codigoAuxiliar: detalle.codigoAuxiliar || null,
        nombre: detalle.descripcion,
        precioUnitario: detalle.precioVentaReferencial,
        costoUnitario: detalle.precioUnitario,
        tarifaIva: detalle.porcentajeIva,
        unidadMedida: 'UND',
        inventariable: Boolean(detalle.inventariable),
        stockActual: 0,
        stockMinimo: 0,
        activo: true,
        infoAdicional: 'Creado automaticamente desde factura de compra',
      },
    });
    return { producto, creado: true, actualizado: false };
  }

  if (!actualizarProductosExistentes) {
    return { producto, creado: false, actualizado: false };
  }

  const actualizado = await tx.productos_servicios.update({
    where: { id: producto.id },
    data: {
      codigoAuxiliar: detalle.codigoAuxiliar || producto.codigoAuxiliar,
      nombre: producto.nombre || detalle.descripcion,
      costoUnitario: detalle.precioUnitario,
      tarifaIva: detalle.porcentajeIva,
      inventariable: producto.inventariable || Boolean(detalle.inventariable),
      ...(Number(producto.precioUnitario || 0) <= 0 ? { precioUnitario: detalle.precioVentaReferencial } : {}),
    },
  });

  return { producto: actualizado, creado: false, actualizado: true };
}

// GET /api/compras/exportar/csv — descarga CSV con los mismos filtros que el listado
router.get('/exportar/csv', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, busqueda } = req.query;
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.fechaEmision.lte = hasta;
      }
    }

    const termino = limpiarTexto(busqueda);
    if (termino) {
      where.OR = [
        { razonSocialProveedor: { contains: termino, mode: 'insensitive' } },
        { identificacionProveedor: { contains: termino, mode: 'insensitive' } },
        { numeroFactura: { contains: termino, mode: 'insensitive' } },
      ];
    }

    const csvCols = await getColsCompra();
    const items = await prisma.facturas_compra.findMany({
      where,
      orderBy: { fechaEmision: 'desc' },
      take: 5000,
      select: {
        id: true,
        fechaEmision: true,
        numeroFactura: true,
        numeroAutorizacion: true,
        claveAcceso: true,
        razonSocialProveedor: true,
        identificacionProveedor: true,
        tipoIdentificacionProveedor: true,
        subtotal0: true,
        subtotal5: true,
        subtotal15: true,
        totalDescuento: true,
        totalIva: true,
        importeTotal: true,
        retencionIVA: true,
        retencionRenta: true,
        origenRegistro: true,
        registraInventario: true,
        egresoCajaRegistrado: true,
        movimientosInventario: true,
        ...(csvCols.anulada ? { anulada: true } : {}),
        ...(csvCols.motivoAnulacion ? { motivoAnulacion: true } : {}),
        observaciones: true,
        createdAt: true,
      },
    });

    const esc = (v) => {
      const s = String(v == null ? '' : v).replace(/"/g, '""');
      return `"${s}"`;
    };
    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum = (v) => Number(v || 0).toFixed(2);

    const headers = [
      'ID', 'Fecha Emision', 'Nro Factura', 'Nro Autorizacion', 'Clave Acceso',
      'Proveedor', 'RUC/CI Proveedor', 'Tipo ID',
      'Subtotal 0%', 'Subtotal 5%', 'Subtotal 15%', 'Descuento', 'IVA', 'Total',
      'Retencion IVA', 'Retencion Renta',
      'Origen', 'Inventario', 'Egreso Caja', 'Movimientos Inv',
      'Anulada', 'Motivo Anulacion', 'Observaciones', 'Fecha Registro',
    ];

    const rows = items.map((r) => [
      r.id, fmtDate(r.fechaEmision), r.numeroFactura, r.numeroAutorizacion || '', r.claveAcceso || '',
      r.razonSocialProveedor, r.identificacionProveedor, r.tipoIdentificacionProveedor,
      fmtNum(r.subtotal0), fmtNum(r.subtotal5), fmtNum(r.subtotal15),
      fmtNum(r.totalDescuento), fmtNum(r.totalIva), fmtNum(r.importeTotal),
      fmtNum(r.retencionIVA), fmtNum(r.retencionRenta),
      r.origenRegistro, r.registraInventario ? 'Si' : 'No', r.egresoCajaRegistrado ? 'Si' : 'No', r.movimientosInventario,
      r.anulada ? 'Si' : 'No', r.motivoAnulacion || '', r.observaciones || '', fmtDate(r.createdAt),
    ].map(esc).join(','));

    const csv = [headers.map(esc).join(','), ...rows].join('\r\n');
    const fecha = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="compras-${fecha}.csv"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (error) {
    console.error('GET /compras/exportar/csv:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo exportar el CSV de compras' });
  }
});

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 15, fechaDesde, fechaHasta, proveedor, busqueda, tipoGasto } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setHours(23, 59, 59, 999);
        where.fechaEmision.lte = hasta;
      }
    }

    const termino = limpiarTexto(proveedor || busqueda);
    if (termino) {
      where.OR = [
        { razonSocialProveedor: { contains: termino, mode: 'insensitive' } },
        { identificacionProveedor: { contains: termino, mode: 'insensitive' } },
        { numeroFactura: { contains: termino, mode: 'insensitive' } },
      ];
    }

    // ─── Cache de columnas disponibles para evitar errores por migración pendiente ──
    const cols = await getColsCompra();
    const usarTipoGasto = cols.tipoGasto;

    // tipoGasto filter (columna puede estar pendiente de migración en producción)
    const whereTipoGasto = { ...where };
    if (usarTipoGasto && tipoGasto) {
      if (tipoGasto === 'SIN_CLASIFICAR') {
        whereTipoGasto.tipoGasto = null;
      } else {
        whereTipoGasto.tipoGasto = tipoGasto;
      }
    }

    const selectConTipoGasto = {
      id: true, proveedorId: true, numeroFactura: true, numeroAutorizacion: true,
      fechaEmision: true, razonSocialProveedor: true, identificacionProveedor: true,
      importeTotal: true, registraInventario: true, egresoCajaRegistrado: true,
      movimientosInventario: true, origenRegistro: true,
      ...(cols.tipoGasto ? { tipoGasto: true } : {}),
      ...(cols.anulada ? { anulada: true } : {}),
      ...(cols.motivoAnulacion ? { motivoAnulacion: true } : {}),
      createdAt: true,
    };

    const [total, items] = await Promise.all([
      prisma.facturas_compra.count({ where: whereTipoGasto }),
      prisma.facturas_compra.findMany({
        where: whereTipoGasto,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
        select: selectConTipoGasto,
      }),
    ]);

    res.json({
      success: true,
      data: items,
      total,
      pages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (error) {
    // Log completo para diagnóstico en producción
    console.error('GET /compras error:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack?.split('\n').slice(0, 5).join(' | '),
    });
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el listado de compras', _debug: error?.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const compra = await prisma.facturas_compra.findFirst({
      where: {
        id: parseInt(req.params.id, 10),
        empresaId: req.empresa.id,
      },
      include: {
        emisor: {
          select: { id: true, nombre: true, username: true },
        },
        proveedor: {
          select: {
            id: true,
            identificacion: true,
            razonSocial: true,
            activo: true,
          },
        },
        retenciones: {
          where: { anulada: false },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            numeroRetencion: true,
            fechaEmision: true,
            totalRetenido: true,
            estadoSri: true,
            numeroAutorizacion: true,
          },
        },
      },
    });

    if (!compra) {
      return res.status(404).json({ success: false, mensaje: 'Factura de compra no encontrada' });
    }

    res.json({ success: true, data: compra });
  } catch (error) {
    console.error('GET /compras/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar la compra' });
  }
});

router.post('/importar/xml', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, mensaje: 'Debes adjuntar un archivo XML' });
    }

    const xml = req.file.buffer.toString('utf8');
    const data = parsearFacturaCompraDesdeXml(xml);

    res.json({
      success: true,
      data,
      mensaje: 'XML de compra procesado correctamente',
    });
  } catch (error) {
    console.error('POST /compras/importar/xml:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo procesar el XML' });
  }
});

router.post('/importar/autorizacion', async (req, res) => {
  try {
    const claveAcceso = limpiarTexto(req.body?.claveAcceso || req.body?.numeroAutorizacion || '');
    if (!claveAcceso) {
      return res.status(400).json({ success: false, mensaje: 'La clave de acceso o autorización es requerida' });
    }

    const { ambiente, numeroAutorizacion, xml } = await obtenerXmlDesdeAutorizacion(claveAcceso);
    const data = parsearFacturaCompraDesdeXml(xml);
    data.comprobante.numeroAutorizacion = data.comprobante.numeroAutorizacion || numeroAutorizacion || claveAcceso;
    data.comprobante.ambiente = data.comprobante.ambiente || String(ambiente);

    res.json({
      success: true,
      data,
      mensaje: 'Autorización SRI recuperada correctamente',
    });
  } catch (error) {
    console.error('POST /compras/importar/autorizacion:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo recuperar la autorización SRI' });
  }
});

router.post('/', async (req, res) => {
  try {
    const {
      tipoIdentificacionProveedor,
      identificacionProveedor,
      razonSocialProveedor,
      nombreComercialProveedor,
      direccionProveedor,
      proveedorId,
      numeroFactura,
      numeroAutorizacion,
      claveAcceso,
      fechaEmision,
      observaciones,
      tipoGasto,
      detalles,
      pagos,
      origenRegistro,
      xmlOrigen,
      registrarInventario = false,
      crearProductosFaltantes = false,
      actualizarProductosExistentes = true,
      registrarEgresoCaja = false,
    } = req.body || {};

    if (!limpiarTexto(tipoIdentificacionProveedor) || !limpiarTexto(identificacionProveedor) || !limpiarTexto(razonSocialProveedor)) {
      return res.status(400).json({ success: false, mensaje: 'Faltan datos del proveedor' });
    }
    if (!limpiarTexto(numeroFactura)) {
      return res.status(400).json({ success: false, mensaje: 'El número de factura de compra es requerido' });
    }

    const detallesNormalizados = ensureArray(detalles).map((detalle, index) => normalizarDetalle(detalle, index));
    if (detallesNormalizados.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debes incluir al menos una línea de detalle' });
    }

    const totales = detallesNormalizados.reduce((acc, detalle) => {
      const pct = parseInt(detalle.porcentajeIva) || 0;
      if (pct === 5)       acc.subtotal5  += detalle.subtotal;
      else if (pct > 0)    acc.subtotal15 += detalle.subtotal;
      else                 acc.subtotal0  += detalle.subtotal;
      acc.totalDescuento += detalle.descuento;
      acc.totalIva += detalle.totalIva;
      acc.importeTotal += detalle.total;
      return acc;
    }, {
      subtotal0: 0,
      subtotal5: 0,
      subtotal15: 0,
      totalDescuento: 0,
      totalIva: 0,
      importeTotal: 0,
    });

    const pagosFinales = ensureArray(pagos).length > 0
      ? ensureArray(pagos).map((pago) => ({
          formaPago: limpiarTexto(pago?.formaPago || '20') || '20',
          total: Number(toNumber(pago?.total, 0).toFixed(2)),
          plazo: pago?.plazo ? parseInt(pago.plazo, 10) : null,
          unidadTiempo: limpiarTexto(pago?.unidadTiempo || '') || null,
        }))
      : [{ formaPago: '20', total: Number(totales.importeTotal.toFixed(2)), plazo: null, unidadTiempo: null }];

    const fechaDoc = fechaEmision ? new Date(fechaEmision) : new Date();
    const compra = await prisma.$transaction(async (tx) => {
      const proveedor = await upsertProveedorCompra(tx, {
        empresaId: req.empresa.id,
        proveedorId,
        tipoIdentificacionProveedor,
        identificacionProveedor,
        razonSocialProveedor,
        nombreComercialProveedor,
        direccionProveedor,
      });

      const detallesProcesados = [];
      let productosCreados = 0;
      let productosActualizados = 0;

      for (const detalle of detallesNormalizados) {
        const resolucion = await resolverProductoCompra({
          tx,
          empresaId: req.empresa.id,
          detalle,
          crearProductosFaltantes: toBoolean(crearProductosFaltantes, false),
          actualizarProductosExistentes: toBoolean(actualizarProductosExistentes, true),
        });

        if (resolucion?.creado) productosCreados += 1;
        if (resolucion?.actualizado) productosActualizados += 1;

        detallesProcesados.push({
          ...detalle,
          productoId: resolucion?.producto?.id || null,
          inventariable: resolucion?.producto?.inventariable ?? detalle.inventariable,
        });
      }

      const creada = await tx.facturas_compra.create({
        data: {
          empresaId: req.empresa.id,
          emisorId: req.usuario.id,
          proveedorId: proveedor?.id || null,
          tipoIdentificacionProveedor: limpiarTexto(tipoIdentificacionProveedor),
          identificacionProveedor: limpiarTexto(identificacionProveedor),
          razonSocialProveedor: limpiarTexto(razonSocialProveedor),
          nombreComercialProveedor: limpiarTexto(nombreComercialProveedor) || null,
          direccionProveedor: limpiarTexto(direccionProveedor) || null,
          numeroFactura: normalizarNumeroFactura(numeroFactura),
          numeroAutorizacion: limpiarTexto(numeroAutorizacion) || null,
          claveAcceso: limpiarTexto(claveAcceso) || null,
          fechaEmision: fechaDoc,
          subtotal0: Number(totales.subtotal0.toFixed(2)),
          subtotal5: Number((totales.subtotal5 || 0).toFixed(2)),
          subtotal15: Number(totales.subtotal15.toFixed(2)),
          totalDescuento: Number(totales.totalDescuento.toFixed(2)),
          totalIva: Number(totales.totalIva.toFixed(2)),
          importeTotal: Number(totales.importeTotal.toFixed(2)),
          detalles: detallesProcesados,
          pagos: pagosFinales,
          origenRegistro: limpiarTexto(origenRegistro || 'MANUAL').toUpperCase(),
          registraInventario: toBoolean(registrarInventario, false),
          creaProductos: toBoolean(crearProductosFaltantes, false),
          xmlOrigen: limpiarTexto(xmlOrigen) || null,
          observaciones: limpiarTexto(observaciones) || null,
          tipoGasto: limpiarTexto(tipoGasto) || null,
        },
      });

      let movimientosInventario = 0;
      if (toBoolean(registrarInventario, false)) {
        for (const detalle of detallesProcesados) {
          if (!detalle.productoId || !detalle.inventariable) continue;

          const movimiento = await aplicarMovimientoInventario({
            tx,
            empresaId: req.empresa.id,
            productoId: detalle.productoId,
            usuarioId: req.usuario.id,
            tipo: 'ENTRADA',
            deltaCantidad: detalle.cantidad,
            referencia: normalizarNumeroFactura(numeroFactura),
            observacion: `Entrada por factura de compra ${normalizarNumeroFactura(numeroFactura)}`,
            metadata: { compraId: creada.id, tipo: 'FACTURA_COMPRA' },
            costoUnitario: detalle.precioUnitario,
          });

          if (movimiento?.movimiento) movimientosInventario += 1;
        }
      }

      let egresoCajaRegistrado = false;
      if (toBoolean(registrarEgresoCaja, false)) {
        const totalCaja = pagosFinales.reduce((acc, pago) => acc + Number(pago.total || 0), 0) || Number(totales.importeTotal || 0);
        const movimientoCaja = await registrarMovimientoCaja({
          tx,
          empresaId: req.empresa.id,
          usuarioId: req.usuario.id,
          fecha: fechaDoc,
          tipo: 'EGRESO',
          monto: totalCaja,
          descripcion: `Pago de factura de compra ${normalizarNumeroFactura(numeroFactura)}`,
          referencia: normalizarNumeroFactura(numeroFactura),
          categoria: 'COMPRA_FACTURA',
          origenId: creada.id,
          metadata: { compraId: creada.id, proveedor: limpiarTexto(razonSocialProveedor) },
        });
        egresoCajaRegistrado = Boolean(movimientoCaja?.id);
      }

      const actualizada = await tx.facturas_compra.update({
        where: { id: creada.id },
        data: {
          movimientosInventario,
          egresoCajaRegistrado,
        },
      });

      return {
        compra: actualizada,
        resumen: {
          productosCreados,
          productosActualizados,
          movimientosInventario,
          egresoCajaRegistrado,
        },
      };
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'CREATE',
      tabla: 'facturas_compra',
      registroId: compra.compra.id,
      datosNuevos: {
        numeroFactura: compra.compra.numeroFactura,
        importeTotal: compra.compra.importeTotal,
        proveedor: compra.compra.razonSocialProveedor,
      },
      req,
    });

    try {
      await crearAsientoFacturaCompraRegistrada({
        compraId: compra.compra.id,
        usuarioId: req.usuario.id,
        fecha: fechaDoc,
      });
    } catch (contErr) {
      console.error('Asiento contable de compra:', contErr.message);
    }

    res.status(201).json({
      success: true,
      data: compra.compra,
      resumen: compra.resumen,
      mensaje: 'Factura de compra registrada correctamente',
    });
  } catch (error) {
    console.error('POST /compras:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe una compra con ese proveedor y número de factura' });
    }
    if (/linea|cantidad|descripcion|precio unitario|Producto no encontrado|Stock/.test(error.message || '')) {
      return res.status(400).json({ success: false, mensaje: error.message });
    }
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo registrar la factura de compra' });
  }
});

// PUT /api/compras/:id — editar campos seguros (observaciones, proveedor, fecha si no tiene inventario)
router.put('/:id', async (req, res) => {
  try {
    const compraId = parseInt(req.params.id, 10);
    const empresaId = req.empresa.id;

    const compra = await prisma.facturas_compra.findFirst({
      where: { id: compraId, empresaId },
    });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (compra.anulada) return res.status(400).json({ success: false, mensaje: 'No se puede editar una compra anulada' });

    const { observaciones, proveedorId, fechaEmision, tipoGasto } = req.body || {};

    const data = {};
    if (observaciones !== undefined) data.observaciones = limpiarTexto(observaciones) || null;
    if (proveedorId !== undefined) data.proveedorId = proveedorId ? parseInt(proveedorId, 10) : null;
    if (tipoGasto !== undefined) data.tipoGasto = limpiarTexto(tipoGasto) || null;

    // Fecha solo si no tiene movimientos de inventario aplicados
    if (fechaEmision !== undefined && compra.movimientosInventario === 0) {
      const fechaDoc = new Date(fechaEmision);
      if (!Number.isNaN(fechaDoc.getTime())) data.fechaEmision = fechaDoc;
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay campos válidos para actualizar' });
    }

    const actualizada = await prisma.facturas_compra.update({
      where: { id: compraId },
      data,
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'UPDATE',
      tabla: 'facturas_compra',
      registroId: compraId,
      datosNuevos: data,
      req,
    });

    res.json({ success: true, data: actualizada, mensaje: 'Compra actualizada correctamente' });
  } catch (error) {
    console.error('PUT /compras/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo actualizar la compra' });
  }
});

// PATCH /api/compras/:id/anular — anular con reversión de inventario y caja
router.patch('/:id/anular', async (req, res) => {
  try {
    const compraId = parseInt(req.params.id, 10);
    const empresaId = req.empresa.id;
    const motivo = limpiarTexto(req.body?.motivoAnulacion || req.body?.motivo || '') || 'Anulación manual';

    const compra = await prisma.facturas_compra.findFirst({
      where: { id: compraId, empresaId },
    });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (compra.anulada) return res.status(400).json({ success: false, mensaje: 'La compra ya está anulada' });

    const resumen = { inventarioRevertido: 0, cajaRevertida: false };

    await prisma.$transaction(async (tx) => {
      // 1. Marcar como anulada
      await tx.facturas_compra.update({
        where: { id: compraId },
        data: { anulada: true, motivoAnulacion: motivo },
      });

      // 2. Revertir movimientos de inventario si aplica
      if (compra.movimientosInventario > 0) {
        const detalles = Array.isArray(compra.detalles)
          ? compra.detalles
          : (typeof compra.detalles === 'string' ? JSON.parse(compra.detalles) : []);

        for (const detalle of detalles) {
          if (!detalle.productoId || !detalle.inventariable) continue;
          const cantidad = Number(detalle.cantidad || 0);
          if (cantidad <= 0) continue;

          const mov = await aplicarMovimientoInventario({
            tx,
            empresaId,
            productoId: detalle.productoId,
            usuarioId: req.usuario.id,
            tipo: 'ANULACION_COMPRA',
            deltaCantidad: -cantidad,
            referencia: compra.numeroFactura,
            observacion: `Reverso por anulación de compra ${compra.numeroFactura}`,
            metadata: { compraId, motivo },
            costoUnitario: detalle.precioUnitario,
          });
          if (mov) resumen.inventarioRevertido += 1;
        }
      }

      // 3. Revertir egreso de caja si aplica
      if (compra.egresoCajaRegistrado) {
        const totalCaja = Number(compra.importeTotal || 0);
        if (totalCaja > 0) {
          const movCaja = await registrarMovimientoCaja({
            tx,
            empresaId,
            usuarioId: req.usuario.id,
            tipo: 'INGRESO',
            monto: totalCaja,
            descripcion: `Reversión por anulación de compra ${compra.numeroFactura}`,
            referencia: compra.numeroFactura,
            categoria: 'ANULACION_COMPRA',
            origenId: compraId,
            metadata: { compraId, motivo },
          });
          resumen.cajaRevertida = Boolean(movCaja?.id);
        }
      }
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'ANULAR',
      tabla: 'facturas_compra',
      registroId: compraId,
      datosNuevos: { anulada: true, motivoAnulacion: motivo, ...resumen },
      req,
    });

    res.json({
      success: true,
      mensaje: 'Compra anulada correctamente',
      resumen,
    });
  } catch (error) {
    console.error('PATCH /compras/:id/anular:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo anular la compra' });
  }
});

module.exports = router;
