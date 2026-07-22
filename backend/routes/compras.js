const express = require('express');
const multer = require('multer');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const { registrarAuditoria } = require('../utils/auditoria');
const { aplicarMovimientoInventario } = require('../utils/inventario');
const { registrarMovimientoCaja } = require('../utils/caja');
const { crearAsientoFacturaCompraRegistrada, crearAsientoReversoCompraAnulada } = require('../utils/contabilidad');
const {
  parsearFacturaCompraDesdeXml,
  obtenerXmlDesdeAutorizacion,
} = require('../utils/importacionProductos');
const {
  leerExcel,
  validarFilaCompra,
  construirDetallesCompra,
  generarPlantillaCompras,
} = require('../utils/importarComprasHistoricas');
const { extraerIdentificacionReceptorXml } = require('../utils/buzon');

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
  const [tipoGasto, anulada, motivoAnulacion, receptorEsRuc, tipoComprobante] = await Promise.all([
    probar('tipoGasto'), probar('anulada'), probar('motivoAnulacion'), probar('receptorEsRuc'), probar('tipoComprobante'),
  ]);
  _colsCompra = { tipoGasto, anulada, motivoAnulacion, receptorEsRuc, tipoComprobante };
  return _colsCompra;
}

router.use(proteger);
router.use(requiereModulo('comprasHabilitadas'));
router.use(autorizarPermiso('compras.gestionar'));
// soloFull (Medium/Pro) NO va a nivel de router — Lite ya puede registrar
// compras manualmente. Se aplica solo a las rutas de importación masiva abajo.

function limpiarTexto(valor) {
  return String(valor || '').trim();
}

function limpiarCodigo(valor) {
  return limpiarTexto(valor).toUpperCase();
}

const TIPOS_COMPROBANTE_COMPRA = new Set(['FACTURA', 'NOTA_VENTA']);
function normalizarTipoComprobante(valor) {
  const v = limpiarCodigo(valor);
  return TIPOS_COMPROBANTE_COMPRA.has(v) ? v : 'FACTURA';
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
  // No objeto de IVA (código 6) y Exenta de IVA (código 7) — dos categorías
  // legales distintas del SRI (tabla 17), ambas distintas de tarifa 0%.
  // Confirmado contra el XSD oficial del ATS: baseNoGraIva y baseImpExe son
  // 2 campos separados y obligatorios en detalleCompras — se combinaban en
  // un solo campo hasta esta sesión por una lectura incorrecta de la ficha
  // técnica en PDF. Una línea marcada con cualquiera de las dos nunca lleva IVA.
  const esNoObjetoIva = toBoolean(detalle?.esNoObjetoIva, false);
  const esExentoIva   = toBoolean(detalle?.esExentoIva, false);
  const porcentajeIva = (esNoObjetoIva || esExentoIva) ? 0 : Math.max(0, Math.round(toNumber(detalle?.porcentajeIva, 0)));

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
    esNoObjetoIva,
    esExentoIva,
    subtotal,
    totalIva,
    total,
    inventariable: toBoolean(detalle?.inventariable, true),
    precioVentaReferencial: Number(toNumber(detalle?.precioVentaReferencial, precioUnitario).toFixed(4)),
    utilidadPct: detalle?.utilidadPct != null ? Number(toNumber(detalle.utilidadPct, 0).toFixed(2)) : null,
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
      // Si se especificó utilidad explícitamente en la importación, actualizar PVP siempre.
      // Si no, solo actualizar cuando el PVP actual es 0.
      ...(detalle.utilidadPct != null || Number(producto.precioUnitario || 0) <= 0
        ? { precioUnitario: detalle.precioVentaReferencial }
        : {}),
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
        subtotal12: true,
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

// GET /api/compras/exportar/xlsx — Excel con los mismos filtros que el listado
// GET /api/compras/exportar/pdf — PDF con los mismos filtros que el listado (PDFKit)
router.get('/exportar/pdf', async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { fechaDesde, fechaHasta, busqueda, proveedor, tipoGasto, origenRegistro } = req.query;
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const hasta = new Date(fechaHasta); hasta.setHours(23, 59, 59, 999);
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
    if (origenRegistro) where.origenRegistro = origenRegistro;
    const cols = await getColsCompra();
    if (cols.tipoGasto && tipoGasto) {
      where.tipoGasto = tipoGasto === 'SIN_CLASIFICAR' ? null : tipoGasto;
    }

    const [items, cfg] = await Promise.all([
      prisma.facturas_compra.findMany({
        where, orderBy: { fechaEmision: 'desc' }, take: 5000,
        select: {
          fechaEmision: true, numeroFactura: true, razonSocialProveedor: true,
          identificacionProveedor: true, subtotal0: true, subtotal12: true, subtotal15: true,
          totalIva: true, importeTotal: true,
          ...(cols.anulada ? { anulada: true } : {}),
        },
      }),
      prisma.configuracion_sri.findFirst({
        where: { empresaId: req.empresa.id },
        select: { razonSocial: true, ruc: true, dirMatriz: true },
      }),
    ]);

    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="compras-${fecha}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margins: { top: 32, bottom: 32, left: 32, right: 32 }, autoFirstPage: true });
    doc.pipe(res);

    const ML = 32, W = 531;
    const NEGRO = '#1e293b', GRIS = '#64748b', VERDE = '#0f766e';
    const ROWH = 14;

    // COLS: x, w, label, align
    const COLS = [
      { x: ML,      w: 50,  label: 'Fecha',      align: 'left' },
      { x: ML+50,   w: 80,  label: 'N° Factura', align: 'left' },
      { x: ML+130,  w: 135, label: 'Proveedor',  align: 'left' },
      { x: ML+265,  w: 65,  label: 'RUC/CI',     align: 'left' },
      { x: ML+330,  w: 42,  label: 'Base 0%',    align: 'right' },
      { x: ML+372,  w: 43,  label: 'Base 15%',   align: 'right' },
      { x: ML+415,  w: 38,  label: 'IVA',        align: 'right' },
      { x: ML+453,  w: 52,  label: 'Total',      align: 'right' },
      { x: ML+505,  w: 26,  label: 'Est.',       align: 'center' },
    ];

    let y = 32;
    const drawHeader = () => {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(NEGRO)
         .text(cfg?.razonSocial || '', ML, y, { width: W });
      y = doc.y + 2;
      doc.fontSize(8).font('Helvetica').fillColor(GRIS)
         .text(`RUC: ${cfg?.ruc || '—'}  |  Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`, ML, y, { width: W });
      y = doc.y + 8;
      doc.fontSize(13).font('Helvetica-Bold').fillColor(VERDE).text('LIBRO DE COMPRAS', ML, y, { width: W });
      y = doc.y + 4;
      let sub = `${items.length} registro(s)`;
      if (fechaDesde || fechaHasta) sub += `  |  Del ${fechaDesde || '—'} al ${fechaHasta || '—'}`;
      if (termino) sub += `  |  Búsqueda: "${termino}"`;
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS).text(sub, ML, y, { width: W });
      y = doc.y + 10;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke(VERDE);
      y += 6;
    };

    const drawColHeaders = () => {
      doc.rect(ML, y - 1, W, ROWH + 2).fill('#ecfeff');
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(VERDE);
      COLS.forEach(c => doc.text(c.label, c.x, y, { width: c.w, align: c.align, lineBreak: false }));
      y += ROWH;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.4).stroke('#94a3b8');
      y += 3;
    };

    drawHeader();
    drawColHeaders();

    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum  = (v) => `$${Number(v || 0).toFixed(2)}`;

    let totBase0 = 0, totBase15 = 0, totIva = 0, totTotal = 0;
    let rowIdx = 0;

    for (const r of items) {
      if (y > doc.page.height - 64) {
        doc.addPage();
        y = 32;
        drawColHeaders();
      }
      if (rowIdx % 2 === 1) {
        doc.rect(ML, y - 1, W, ROWH + 1).fill('#f8fafc');
      }
      doc.fontSize(7.5).font('Helvetica').fillColor(r.anulada ? '#94a3b8' : NEGRO);
      const cells = [
        fmtDate(r.fechaEmision), r.numeroFactura || '',
        (r.razonSocialProveedor || '').slice(0, 28), r.identificacionProveedor || '',
        fmtNum(r.subtotal0), fmtNum(r.subtotal15), fmtNum(r.totalIva), fmtNum(r.importeTotal),
        r.anulada ? 'Anul' : 'OK',
      ];
      COLS.forEach((c, i) => doc.text(cells[i], c.x, y, { width: c.w, align: c.align, lineBreak: false }));
      y += ROWH;

      totBase0  += Number(r.subtotal0  || 0);
      totBase15 += Number(r.subtotal15 || 0);
      totIva    += Number(r.totalIva   || 0);
      totTotal  += Number(r.importeTotal || 0);
      rowIdx++;
    }

    // Totals
    if (y > doc.page.height - 48) { doc.addPage(); y = 32; }
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.6).stroke('#94a3b8');
    y += 4;
    doc.rect(ML, y - 1, W, ROWH + 2).fill('#ecfeff');
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(VERDE);
    const tots = ['', 'TOTALES', '', '', fmtNum(totBase0), fmtNum(totBase15), fmtNum(totIva), fmtNum(totTotal), ''];
    COLS.forEach((c, i) => doc.text(tots[i], c.x, y, { width: c.w, align: c.align, lineBreak: false }));

    doc.end();
  } catch (error) {
    console.error('GET /compras/exportar/pdf:', error);
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'No se pudo generar el PDF de compras' });
  }
});

router.get('/exportar/xlsx', async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { fechaDesde, fechaHasta, busqueda, proveedor, tipoGasto, origenRegistro } = req.query;
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

    if (origenRegistro) where.origenRegistro = origenRegistro;

    const cols = await getColsCompra();
    if (cols.tipoGasto && tipoGasto) {
      where.tipoGasto = tipoGasto === 'SIN_CLASIFICAR' ? null : tipoGasto;
    }

    const items = await prisma.facturas_compra.findMany({
      where,
      orderBy: { fechaEmision: 'desc' },
      take: 5000,
      select: {
        id: true, fechaEmision: true, numeroFactura: true, numeroAutorizacion: true,
        razonSocialProveedor: true, identificacionProveedor: true,
        subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
        totalDescuento: true, totalIva: true, importeTotal: true,
        retencionIVA: true, retencionRenta: true,
        origenRegistro: true,
        ...(cols.tipoGasto ? { tipoGasto: true } : {}),
        ...(cols.anulada ? { anulada: true } : {}),
        observaciones: true,
        createdAt: true,
      },
    });

    const fmtDate = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';
    const fmtNum  = (v) => Number(v || 0).toFixed(2);

    const headers = [
      'ID', 'Fecha Emisión', 'Nro Factura', 'Nro Autorización',
      'Proveedor', 'RUC/CI Proveedor',
      'Subtotal 0%', 'Subtotal 5%', 'Subtotal 15%', 'Descuento', 'IVA', 'Total',
      'Retención IVA', 'Retención Renta',
      'Origen', 'Tipo Gasto', 'Anulada', 'Observaciones', 'Fecha Registro',
    ];

    const rows = items.map((r) => [
      r.id, fmtDate(r.fechaEmision), r.numeroFactura, r.numeroAutorizacion || '',
      r.razonSocialProveedor, r.identificacionProveedor,
      fmtNum(r.subtotal0), fmtNum(r.subtotal5), fmtNum(r.subtotal15),
      fmtNum(r.totalDescuento), fmtNum(r.totalIva), fmtNum(r.importeTotal),
      fmtNum(r.retencionIVA), fmtNum(r.retencionRenta),
      r.origenRegistro || 'MANUAL', r.tipoGasto || '',
      r.anulada ? 'Si' : 'No', r.observaciones || '', fmtDate(r.createdAt),
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [
      { wch: 6 }, { wch: 12 }, { wch: 22 }, { wch: 30 },
      { wch: 36 }, { wch: 14 },
      { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
      { wch: 13 }, { wch: 14 },
      { wch: 14 }, { wch: 20 }, { wch: 8 }, { wch: 30 }, { wch: 12 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Compras');

    const buf   = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="compras-${fecha}.xlsx"`);
    res.send(buf);
  } catch (error) {
    console.error('GET /compras/exportar/xlsx:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo exportar el Excel de compras' });
  }
});

router.get('/', async (req, res) => {
  try {
    const {
      page = 1, limit = 15,
      fechaDesde, fechaHasta,
      proveedor, busqueda,
      tipoGasto, origenRegistro,
    } = req.query;
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

    // Filtro por origen (MANUAL, BUZON_SRI, XML_IMPORTADO, etc.)
    if (origenRegistro) where.origenRegistro = origenRegistro;

    // ─── Cache de columnas disponibles ──────────────────────────
    const cols = await getColsCompra();
    const usarTipoGasto = cols.tipoGasto;

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
      subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true,
      importeTotal: true, registraInventario: true, egresoCajaRegistrado: true,
      movimientosInventario: true, origenRegistro: true, cuentaGastoId: true,
      ...(cols.tipoGasto ? { tipoGasto: true } : {}),
      ...(cols.anulada ? { anulada: true } : {}),
      ...(cols.motivoAnulacion ? { motivoAnulacion: true } : {}),
      ...(cols.receptorEsRuc ? { receptorEsRuc: true } : {}),
      ...(cols.tipoComprobante ? { tipoComprobante: true } : {}),
      createdAt: true,
    };

    // ─── Consultas en paralelo: paginado + conteo + stats globales ──
    const [total, items, agr] = await Promise.all([
      prisma.facturas_compra.count({ where: whereTipoGasto }),
      prisma.facturas_compra.findMany({
        where: whereTipoGasto,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit, 10),
        select: selectConTipoGasto,
      }),
      // Totales globales del filtro (no solo la página actual)
      prisma.facturas_compra.aggregate({
        where: whereTipoGasto,
        _sum: { subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true, importeTotal: true },
      }),
    ]);

    // Resumen por clasificación de gasto (todos los registros del filtro)
    let resumenGrupos = [];
    if (usarTipoGasto) {
      try {
        const grupos = await prisma.facturas_compra.groupBy({
          by: ['tipoGasto'],
          where: whereTipoGasto,
          _count: { id: true },
          _sum: { subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true, importeTotal: true },
        });
        resumenGrupos = grupos.map((g) => ({
          tipo:   g.tipoGasto || 'SIN_CLASIFICAR',
          count:  g._count.id,
          base0:  Number(g._sum.subtotal0  || 0),
          base15: Number(g._sum.subtotal15 || 0) + Number(g._sum.subtotal5 || 0),
          iva:    Number(g._sum.totalIva   || 0),
          total:  Number(g._sum.importeTotal || 0),
        })).sort((a, b) => b.total - a.total);
      } catch { /* tipoGasto aún no migrado */ }
    }

    const totalesGenerales = {
      base0:  Number(agr._sum.subtotal0   || 0),
      base15: Number(agr._sum.subtotal15  || 0) + Number(agr._sum.subtotal5 || 0),
      iva:    Number(agr._sum.totalIva    || 0),
      total:  Number(agr._sum.importeTotal || 0),
    };

    // Marca por fila si ya existe el asiento contable COMPRA correspondiente
    const referencias = items.map((it) => `COMP-${it.id}`);
    const asientosExistentes = referencias.length
      ? await prisma.asientos_contables.findMany({
          where: { empresaId: req.empresa.id, tipo: 'COMPRA', referencia: { in: referencias } },
          select: { referencia: true, cerrado: true },
        })
      : [];
    const asientoMap = new Map(asientosExistentes.map((a) => [a.referencia, a]));
    const itemsConAsiento = items.map((it) => ({
      ...it,
      tieneAsientoContable: asientoMap.has(`COMP-${it.id}`),
      asientoCerrado: asientoMap.get(`COMP-${it.id}`)?.cerrado || false,
    }));

    res.json({
      success: true,
      data: itemsConAsiento,
      total,
      pages: Math.ceil(total / parseInt(limit, 10)),
      totalesGenerales,
      resumenGrupos,
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

// GET /api/compras/notas-credito — notas de crédito recibidas de proveedores (tipoDocumento '04')
// Provienen del buzón SRI / docs_recibidos_otros
// IMPORTANTE: debe registrarse antes de GET /:id — de lo contrario Express matchea
// "notas-credito" como si fuera un :id y nunca llega a este handler.
router.get('/notas-credito', autorizarPermiso('compras.gestionar'), async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const { busqueda, fechaDesde, fechaHasta, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { empresaId, tipoDocumento: '04' };
    if (busqueda) {
      where.OR = [
        { razonSocialEmisor: { contains: busqueda, mode: 'insensitive' } },
        { rucEmisor: { contains: busqueda } },
        { claveAcceso: { contains: busqueda } },
      ];
    }
    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const fd = new Date(fechaHasta);
        fd.setHours(23, 59, 59, 999);
        where.fechaEmision.lte = fd;
      }
    }

    const [total, notas] = await Promise.all([
      prisma.docs_recibidos_otros.count({ where }),
      prisma.docs_recibidos_otros.findMany({
        where,
        orderBy: { fechaEmision: 'desc' },
        skip,
        take: parseInt(limit),
      }),
    ]);

    res.json({ success: true, data: notas, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (error) {
    console.error('GET /compras/notas-credito:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener notas de crédito' });
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

    // Enriquecer con nombre de cuenta de gasto si está configurada
    let cuentaGasto = null;
    if (compra.cuentaGastoId) {
      cuentaGasto = await prisma.plan_cuentas.findFirst({
        where: { id: compra.cuentaGastoId },
        select: { id: true, codigo: true, nombre: true, tipo: true },
      });
    }

    // Verificar si ya existe un asiento contable para esta compra
    const asientoExistente = await prisma.asientos_contables.findFirst({
      where: { empresaId: compra.empresaId, tipo: 'COMPRA', referencia: `COMP-${compra.id}` },
      select: { id: true, numero: true, cerrado: true },
    });

    res.json({
      success: true,
      data: {
        ...compra,
        cuentaGasto,
        tieneAsientoContable: Boolean(asientoExistente),
        asientoId: asientoExistente?.id || null,
        asientoCerrado: asientoExistente?.cerrado || false,
      },
    });
  } catch (error) {
    console.error('GET /compras/:id:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar la compra' });
  }
});

// ─── POST /:id/reparar-proveedor — rellena datos de proveedor vacíos desde el XML guardado ───
// Para compras importadas (Buzón SRI / XML) cuyos campos de proveedor quedaron
// vacíos (identificacion, razón social, dirección, tipo identificación) por
// algún problema puntual de parseo. Re-lee el XML original (xmlOrigen) y solo
// completa los campos que están vacíos — nunca sobrescribe datos ya presentes
// (por si fueron editados manualmente).
router.post('/:id/reparar-proveedor', async (req, res) => {
  try {
    const compra = await prisma.facturas_compra.findFirst({
      where: { id: parseInt(req.params.id, 10), empresaId: req.empresa.id },
      select: {
        id: true, xmlOrigen: true,
        identificacionProveedor: true, razonSocialProveedor: true,
        direccionProveedor: true, tipoIdentificacionProveedor: true, nombreComercialProveedor: true,
      },
    });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (!compra.xmlOrigen) {
      return res.status(400).json({ success: false, mensaje: 'Esta compra no tiene el XML original guardado — no se puede reparar automáticamente.' });
    }

    const datos = parsearFacturaCompraDesdeXml(compra.xmlOrigen);
    const p = datos.proveedor;

    const cambios = {};
    if (!compra.identificacionProveedor && p.identificacionProveedor) cambios.identificacionProveedor = p.identificacionProveedor;
    if (!compra.razonSocialProveedor && p.razonSocialProveedor) cambios.razonSocialProveedor = p.razonSocialProveedor;
    if (!compra.direccionProveedor && p.direccionProveedor) cambios.direccionProveedor = p.direccionProveedor;
    if (!compra.tipoIdentificacionProveedor && p.tipoIdentificacionProveedor) cambios.tipoIdentificacionProveedor = p.tipoIdentificacionProveedor;
    if (!compra.nombreComercialProveedor && p.nombreComercialProveedor) cambios.nombreComercialProveedor = p.nombreComercialProveedor;

    if (Object.keys(cambios).length === 0) {
      return res.json({ success: true, reparado: false, mensaje: 'El XML original tampoco trae estos datos del proveedor — revisa el comprobante manualmente.' });
    }

    const actualizada = await prisma.facturas_compra.update({ where: { id: compra.id }, data: cambios });
    res.json({ success: true, reparado: true, data: actualizada });
  } catch (error) {
    console.error('POST /compras/:id/reparar-proveedor:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo reparar los datos del proveedor' });
  }
});

// ─── POST /backfill-receptor-ruc — marca compras como facturadas a RUC o a cédula ───
// Columna nueva: para compras importadas antes de este cambio, receptorEsRuc
// quedó en NULL. Re-lee el xmlOrigen guardado (si existe) y determina si el
// comprobante llegó dirigido al RUC (13 dígitos, deducible) o a la cédula
// (10 dígitos, no válida para declaraciones) de la empresa. Solo toca
// registros con receptorEsRuc todavía NULL — no reprocesa los ya marcados.
router.post('/backfill-receptor-ruc', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const compras = await prisma.facturas_compra.findMany({
      where: { empresaId, receptorEsRuc: null, xmlOrigen: { not: null } },
      select: { id: true, xmlOrigen: true },
    });

    let marcadas = 0;
    let sinDato = 0;

    for (const c of compras) {
      const idReceptor = extraerIdentificacionReceptorXml(c.xmlOrigen, '01');
      let receptorEsRuc = null;
      if (idReceptor.length === 13) receptorEsRuc = true;
      else if (idReceptor.length === 10) receptorEsRuc = false;

      if (receptorEsRuc === null) { sinDato++; continue; }

      await prisma.facturas_compra.update({ where: { id: c.id }, data: { receptorEsRuc } });
      marcadas++;
    }

    res.json({ success: true, total: compras.length, marcadas, sinDato });
  } catch (error) {
    console.error('POST /compras/backfill-receptor-ruc:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo procesar el backfill' });
  }
});

router.post('/importar/xml', soloFull, upload.single('archivo'), async (req, res) => {
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

router.post('/importar/autorizacion', soloFull, async (req, res) => {
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

// ────────────────────────────────────────────────────────────────────────────
// IMPORTACIÓN MASIVA DE FACTURAS DE COMPRA HISTÓRICAS
// (mismo patrón que /api/facturas/importar — no toca inventario ni crea
// productos, solo registra el gasto/compra para efectos contables, y genera
// el asiento COMPRA automáticamente con la fecha histórica real)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/compras/importar/plantilla — descarga la plantilla Excel
router.get('/importar/plantilla', soloFull, async (_req, res) => {
  try {
    const buffer = generarPlantillaCompras();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-compras-historicas.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// POST /api/compras/importar/preview — valida el archivo sin importar
router.post('/importar/preview', soloFull, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió archivo' });

    const filas = leerExcel(req.file.buffer);
    if (filas.length === 0) return res.status(400).json({ success: false, mensaje: 'El archivo está vacío o no tiene datos en la primera hoja' });
    if (filas.length > 1000) return res.status(400).json({ success: false, mensaje: 'Máximo 1000 filas por importación' });

    const resultado = filas.map((raw, idx) => {
      const { valida, errores, datos } = validarFilaCompra(raw);
      return { fila: idx + 2, valida, errores, datos };
    });

    const validas = resultado.filter((r) => r.valida).length;
    res.json({ success: true, filas: resultado, validas, invalidas: resultado.length - validas, total: filas.length });
  } catch (error) {
    console.error('POST /compras/importar/preview:', error);
    res.status(500).json({ success: false, mensaje: `Error al procesar archivo: ${error.message}` });
  }
});

// POST /api/compras/importar/ejecutar — importa las filas válidas
router.post('/importar/ejecutar', soloFull, upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió archivo' });

    // req.prisma directo — multer rompe el AsyncLocalStorage del proxy global,
    // mismo patrón ya usado en /api/facturas/importar/ejecutar.
    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;

    const filasRaw = leerExcel(req.file.buffer);
    if (filasRaw.length === 0) return res.status(400).json({ success: false, mensaje: 'El archivo está vacío' });
    if (filasRaw.length > 1000) return res.status(400).json({ success: false, mensaje: 'Máximo 1000 filas por importación' });

    const importadas = [];
    const errores = [];

    for (const [idx, raw] of filasRaw.entries()) {
      const filaNum = idx + 2;
      const { valida, errores: errs, datos } = validarFilaCompra(raw);

      if (!valida) {
        errores.push({ fila: filaNum, errores: errs });
        continue;
      }

      try {
        const detallesNormalizados = construirDetallesCompra(datos).map((d, i) => normalizarDetalle(d, i));
        const totales = detallesNormalizados.reduce((acc, detalle) => {
          const pct = parseInt(detalle.porcentajeIva) || 0;
          if (detalle.esNoObjetoIva)          acc.subtotalNoObjeto += detalle.subtotal;
          else if (detalle.esExentoIva)       acc.subtotalExento += detalle.subtotal;
          else if (pct === 5)                acc.subtotal5  += detalle.subtotal;
          else if (pct === 12 || pct === 14) acc.subtotal12 += detalle.subtotal;
          else if (pct > 0)                  acc.subtotal15 += detalle.subtotal;
          else                               acc.subtotal0  += detalle.subtotal;
          acc.totalDescuento += detalle.descuento;
          acc.totalIva += detalle.totalIva;
          acc.importeTotal += detalle.total;
          return acc;
        }, { subtotal0: 0, subtotal5: 0, subtotal12: 0, subtotal15: 0, subtotalNoObjeto: 0, subtotalExento: 0, totalDescuento: 0, totalIva: 0, importeTotal: 0 });

        const creada = await db.$transaction(async (tx) => {
          const proveedor = await upsertProveedorCompra(tx, {
            empresaId,
            tipoIdentificacionProveedor: datos.tipoId,
            identificacionProveedor: datos.identificacion,
            razonSocialProveedor: datos.razonSocial,
          });

          return tx.facturas_compra.create({
            data: {
              empresaId,
              emisorId: req.usuario.id,
              proveedorId: proveedor?.id || null,
              tipoIdentificacionProveedor: datos.tipoId,
              identificacionProveedor: datos.identificacion,
              razonSocialProveedor: datos.razonSocial,
              numeroFactura: datos.numeroFactura,
              numeroAutorizacion: datos.numeroAutorizacion,
              fechaEmision: datos.fecha,
              subtotal0:  Number(totales.subtotal0.toFixed(2)),
              subtotal5:  Number(totales.subtotal5.toFixed(2)),
              subtotal12: Number(totales.subtotal12.toFixed(2)),
              subtotal15: Number(totales.subtotal15.toFixed(2)),
              subtotalNoObjeto: Number(totales.subtotalNoObjeto.toFixed(2)),
              subtotalExento: Number(totales.subtotalExento.toFixed(2)),
              totalDescuento: Number(totales.totalDescuento.toFixed(2)),
              totalIva: Number(totales.totalIva.toFixed(2)),
              importeTotal: Number(totales.importeTotal.toFixed(2)),
              detalles: detallesNormalizados,
              pagos: [{ formaPago: datos.formaPago, total: Number(totales.importeTotal.toFixed(2)), plazo: null, unidadTiempo: null }],
              origenRegistro: 'IMPORTACION',
              registraInventario: false,
              creaProductos: false,
              tipoGasto: datos.tipoGasto,
              observaciones: datos.observaciones,
            },
            select: { id: true, numeroFactura: true, importeTotal: true, fechaEmision: true },
          });
        });

        // No se toca inventario aquí — mismo criterio que facturas históricas de
        // venta: retroactivamente ajustar stock actual por una compra ya
        // consumida hace tiempo podría dejarlo incorrecto. El asiento contable
        // (gasto/compra) sí es seguro y es lo que el contador espera ver.
        let asientoOk = false;
        try {
          const rAsiento = await crearAsientoFacturaCompraRegistrada({ compraId: creada.id, usuarioId: req.usuario.id, fecha: datos.fecha, db });
          asientoOk = !!rAsiento.asiento;
        } catch (contErr) {
          console.error(`[Importar compras] Asiento contable fila ${filaNum} (compra ${creada.id}):`, contErr.message);
        }

        importadas.push({
          fila: filaNum,
          id: creada.id,
          numeroFactura: creada.numeroFactura,
          proveedor: datos.razonSocial,
          total: parseFloat(creada.importeTotal),
          asientoOk,
        });
      } catch (err) {
        if (err.code === 'P2002') {
          errores.push({ fila: filaNum, errores: [`Ya existe una compra de "${datos.razonSocial}" con el número de factura "${datos.numeroFactura}"`] });
        } else {
          console.error(`[Importar compras] fila ${filaNum}:`, err.message);
          errores.push({ fila: filaNum, errores: [err.message] });
        }
      }
    }

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      empresaId,
      accion: 'IMPORTAR_COMPRAS_HISTORICAS',
      tabla: 'facturas_compra',
      datosNuevos: { importadas: importadas.length, errores: errores.length },
    });

    res.json({
      success: true,
      importadas: importadas.length,
      errores: errores.length,
      detalle: { importadas, errores },
    });
  } catch (error) {
    console.error('POST /compras/importar/ejecutar:', error);
    res.status(500).json({ success: false, mensaje: `Error en importación: ${error.message}` });
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
      tipoComprobante,
      detalles,
      pagos,
      origenRegistro,
      xmlOrigen,
      registrarInventario = false,
      crearProductosFaltantes = false,
      actualizarProductosExistentes = true,
      registrarEgresoCaja = false,
      esGastoPersonal = false,
      categoriaGastoPersonal,
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
      if (detalle.esNoObjetoIva)          acc.subtotalNoObjeto += detalle.subtotal;
      else if (detalle.esExentoIva)       acc.subtotalExento += detalle.subtotal;
      else if (pct === 5)                acc.subtotal5  += detalle.subtotal;
      else if (pct === 12 || pct === 14) acc.subtotal12 += detalle.subtotal;
      else if (pct > 0)                  acc.subtotal15 += detalle.subtotal;
      else                               acc.subtotal0  += detalle.subtotal;
      acc.totalDescuento += detalle.descuento;
      acc.totalIva += detalle.totalIva;
      acc.importeTotal += detalle.total;
      return acc;
    }, {
      subtotal0: 0,
      subtotal5: 0,
      subtotal12: 0,
      subtotal15: 0,
      subtotalNoObjeto: 0,
      subtotalExento: 0,
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
          tipoComprobante: normalizarTipoComprobante(tipoComprobante),
          fechaEmision: fechaDoc,
          subtotal0:  Number(totales.subtotal0.toFixed(2)),
          subtotal5:  Number((totales.subtotal5 || 0).toFixed(2)),
          subtotal12: Number((totales.subtotal12 || 0).toFixed(2)),
          subtotal15: Number(totales.subtotal15.toFixed(2)),
          subtotalNoObjeto: Number((totales.subtotalNoObjeto || 0).toFixed(2)),
          subtotalExento: Number((totales.subtotalExento || 0).toFixed(2)),
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
          esGastoPersonal: toBoolean(esGastoPersonal, false),
          categoriaGastoPersonal: limpiarTexto(categoriaGastoPersonal) || null,
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

// POST /api/compras/auto-clasificar — clasifica automáticamente compras sin tipoGasto
// usando reglas por palabras clave en proveedor y descripción de productos
router.post('/auto-clasificar', async (req, res) => {
  const REGLAS = [
    {
      categoria: 'SALUD',
      patron: /farmac|hospital|clínic|clinic|medic|dental|optic|laboratori|salud|medicina|drogueri|distribuidora.*medic|fluconazol|antibio|analges|vitamina|suero|jeringa|mascarill|quirurg|enferm|fisioterapia|odontolog/i,
    },
    {
      categoria: 'ALIMENTACION',
      patron: /supermercado|comisariato|aliment|carnic|pollos|fruta|verdura|leche|pan|carne|pescado|mariscos|mercado|minimarket|tienda|abarrotes|comestible|aceite|arroz|azúcar|azucar|harina|papa|chola|zanahoria|espinaca|haba|pansa|distribuidora.*aliment|granja|lácteo|lacteo|bebida|agua.*embotell/i,
    },
    {
      categoria: 'EDUCACION',
      patron: /escuela|colegio|universidad|librería|libreria|libro|academia|instituto|educación|educacion|capacitación|capacitacion|curso|tutoria|papelería|papeleria|útiles|utiles|cuaderno|mochilas/i,
    },
    {
      categoria: 'VIVIENDA',
      patron: /ferretería|ferreteria|construcción|construccion|inmobiliaria|arriendo|alquiler|electricidad|plomería|plomeria|pintura|cemento|hardware|mueble|hogar|articulos.*hogar|electrodom/i,
    },
    {
      categoria: 'VESTIMENTA',
      patron: /ropa|calzado|zapato|boutique|textil|confección|confeccion|moda|vestuario|tela|prendas|calcetín|calcetines|camisa|pantalón|pantalon/i,
    },
    {
      categoria: 'TURISMO',
      patron: /hotel|hostal|hospedaje|agencia.*viajes|restaurante|turismo|aérea|aerea|aerolínea|aerolinea|transporte.*turistico|crucero|paquete.*viaje/i,
    },
  ];

  function clasificar(texto) {
    const t = (texto || '').toLowerCase();
    for (const regla of REGLAS) {
      if (regla.patron.test(t)) return regla.categoria;
    }
    return null;
  }

  try {
    const empresaId = req.empresa.id;

    // Traer todas las compras sin clasificar de esta empresa
    const sinClasificar = await prisma.facturas_compra.findMany({
      where: { empresaId, tipoGasto: null },
      select: {
        id: true,
        razonSocialProveedor: true,
        nombreComercialProveedor: true,
        detalles: true,
      },
    });

    if (sinClasificar.length === 0) {
      return res.json({ success: true, clasificadas: 0, mensaje: 'No hay compras sin clasificar.' });
    }

    const actualizaciones = [];
    for (const compra of sinClasificar) {
      // Texto combinado: proveedor + descripciones de productos
      const detallesArr = Array.isArray(compra.detalles)
        ? compra.detalles
        : (typeof compra.detalles === 'string' ? (() => { try { return JSON.parse(compra.detalles); } catch { return []; } })() : []);

      const textosProductos = detallesArr.map((d) => d?.descripcion || '').join(' ');
      const textoCompleto = [
        compra.razonSocialProveedor,
        compra.nombreComercialProveedor,
        textosProductos,
      ].join(' ');

      const categoria = clasificar(textoCompleto);
      if (categoria) {
        actualizaciones.push({ id: compra.id, categoria });
      }
    }

    // Actualizar en lotes
    let clasificadas = 0;
    for (const { id, categoria } of actualizaciones) {
      await prisma.facturas_compra.update({
        where: { id },
        data: { tipoGasto: categoria },
      });
      clasificadas++;
    }

    return res.json({
      success: true,
      clasificadas,
      noClasificadas: sinClasificar.length - clasificadas,
      mensaje: `${clasificadas} compra(s) clasificadas automáticamente. ${sinClasificar.length - clasificadas} requieren clasificación manual.`,
    });
  } catch (error) {
    console.error('POST /compras/auto-clasificar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al auto-clasificar compras' });
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

    const { observaciones, proveedorId, fechaEmision, tipoGasto, tipoComprobante,
            subtotal0, subtotal15, totalIva, cuentaGastoId,
            esGastoPersonal, categoriaGastoPersonal } = req.body || {};

    const data = {};
    if (observaciones !== undefined) data.observaciones = limpiarTexto(observaciones) || null;
    if (proveedorId !== undefined) data.proveedorId = proveedorId ? parseInt(proveedorId, 10) : null;
    if (tipoGasto !== undefined) data.tipoGasto = limpiarTexto(tipoGasto) || null;
    if (tipoComprobante !== undefined) data.tipoComprobante = normalizarTipoComprobante(tipoComprobante);
    if (esGastoPersonal !== undefined) data.esGastoPersonal = toBoolean(esGastoPersonal, false);
    if (categoriaGastoPersonal !== undefined) data.categoriaGastoPersonal = limpiarTexto(categoriaGastoPersonal) || null;

    if (cuentaGastoId !== undefined) {
      if (!cuentaGastoId) {
        data.cuentaGastoId = null;
      } else {
        const cuentaIdNum = parseInt(cuentaGastoId, 10);
        const cuenta = await prisma.plan_cuentas.findFirst({
          where: { id: cuentaIdNum, empresaId, activo: true, aceptaMovimiento: true },
        });
        if (!cuenta) return res.status(400).json({ success: false, mensaje: 'Cuenta contable no encontrada o no acepta movimiento' });
        data.cuentaGastoId = cuentaIdNum;
      }
    }

    // Corrección manual del desglose IVA (para registros importados sin desglose)
    if (subtotal0  !== undefined) data.subtotal0  = Math.max(0, parseFloat(subtotal0)  || 0);
    if (subtotal15 !== undefined) data.subtotal15 = Math.max(0, parseFloat(subtotal15) || 0);
    if (totalIva   !== undefined) data.totalIva   = Math.max(0, parseFloat(totalIva)   || 0);

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

      // 4. Reversar el asiento contable si la compra ya estaba contabilizada
      // (antes de este fix, anular no revertía la contabilidad — la compra
      // quedaba anulada en el módulo pero seguía afectando el Libro Diario).
      try {
        const reverso = await crearAsientoReversoCompraAnulada({ compraId, usuarioId: req.usuario.id, db: tx });
        resumen.asientoReversado = Boolean(reverso?.creado);
      } catch (contErr) {
        console.error('Error reversando asiento de compra anulada:', contErr.message);
        resumen.asientoReversado = false;
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

// POST /api/compras/:id/registrar-inventario
// Registra movimientos de inventario para una compra que ya existe pero
// no los tiene registrados (p.ej. importada del Buzón SRI sin la opción activada).
// GET /api/compras/:id/asiento — ver el asiento contable vinculado (solo lectura)
router.get('/:id/asiento', autorizarPermiso('compras.gestionar'), async (req, res) => {
  const compraId  = parseInt(req.params.id, 10);
  const empresaId = req.empresa.id;

  try {
    const compra = await prisma.facturas_compra.findFirst({ where: { id: compraId, empresaId } });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });

    const asiento = await prisma.asientos_contables.findFirst({
      where: { empresaId, tipo: 'COMPRA', referencia: `COMP-${compraId}` },
      include: { detalles: { include: { cuenta: true, centroCosto: true }, orderBy: { id: 'asc' } } },
    });
    if (!asiento) return res.status(404).json({ success: false, mensaje: 'Esta compra no tiene asiento contable generado' });

    res.json({ success: true, data: asiento });
  } catch (error) {
    console.error('GET /compras/:id/asiento:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el asiento contable' });
  }
});

router.post('/:id/generar-asiento', autorizarPermiso('compras.gestionar'), async (req, res) => {
  const compraId  = parseInt(req.params.id, 10);
  const empresaId = req.empresa.id;
  const usuarioId = req.usuario?.id || null;

  try {
    const compra = await prisma.facturas_compra.findFirst({ where: { id: compraId, empresaId } });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });

    const resultado = await crearAsientoFacturaCompraRegistrada({
      compraId,
      usuarioId,
      fecha: compra.fechaEmision || new Date(),
    });

    res.json({
      success: true,
      creado: resultado.creado,
      mensaje: resultado.creado ? 'Asiento contable generado' : 'Esta compra ya tenía un asiento contable registrado',
      data: resultado.asiento,
    });
  } catch (error) {
    console.error('POST /compras/:id/generar-asiento:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo generar el asiento contable' });
  }
});

router.post('/:id/registrar-inventario', autorizarPermiso('compras.gestionar'), async (req, res) => {
  const compraId  = parseInt(req.params.id, 10);
  const empresaId = req.empresa.id;
  const usuarioId = req.usuario?.id || null;
  const { margenPct, crearSiNoExiste = false } = req.body || {};
  const usarPvpAuto = margenPct !== undefined && margenPct !== null && !isNaN(Number(margenPct)) && Number(margenPct) >= 0;

  try {
    const compra = await prisma.facturas_compra.findFirst({
      where: { id: compraId, empresaId },
    });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (compra.anulada) return res.status(400).json({ success: false, mensaje: 'La compra está anulada' });
    if ((compra.movimientosInventario || 0) > 0) {
      return res.status(400).json({ success: false, mensaje: 'Esta compra ya tiene movimientos de inventario registrados' });
    }

    const detalles = Array.isArray(compra.detalles)
      ? compra.detalles
      : (typeof compra.detalles === 'string' ? JSON.parse(compra.detalles || '[]') : []);

    if (!detalles?.length) {
      return res.status(400).json({ success: false, mensaje: 'La compra no tiene líneas de detalle' });
    }

    let movimientosRegistrados = 0;
    let productosCreados = 0;
    const errores = [];

    await prisma.$transaction(async (tx) => {
      for (const det of detalles) {
        if (!det.productoId && !det.codigoPrincipal) continue;

        // Buscar el producto
        let prod = det.productoId
          ? await tx.productos_servicios.findFirst({ where: { id: det.productoId, empresaId } })
          : await tx.productos_servicios.findFirst({ where: { codigoPrincipal: det.codigoPrincipal, empresaId } });

        if (!prod) {
          if (crearSiNoExiste && (det.codigoPrincipal || det.descripcion)) {
            const codigo = det.codigoPrincipal || `PROD-${Date.now()}`;
            prod = await tx.productos_servicios.create({
              data: {
                empresaId,
                codigoPrincipal:  codigo,
                codigoAuxiliar:   det.codigoAuxiliar || null,
                nombre:           det.descripcion || codigo,
                precioUnitario:   Number(det.precioUnitario || 0),
                costoUnitario:    Number(det.precioUnitario || 0),
                tarifaIva:        Number(det.porcentajeIva || 15),
                unidadMedida:     'UND',
                inventariable:    true,
                activo:           true,
              },
            });
            productosCreados++;
          } else {
            errores.push(`Producto "${det.codigoPrincipal || det.descripcion || det.productoId}" no encontrado en catálogo`);
            continue;
          }
        }

        if (!prod.inventariable) {
          continue; // No inventariable — omitir sin error
        }

        const cantidad = Number(det.cantidad || 0);
        if (cantidad <= 0) continue;

        await aplicarMovimientoInventario({
          tx,
          empresaId,
          productoId: prod.id,
          usuarioId,
          tipo: 'ENTRADA',
          deltaCantidad: cantidad,
          referencia: compra.numeroFactura,
          observacion: `Entrada manual — compra ${compra.numeroFactura}`,
          costoUnitario: det.precioUnitario || 0,
          metadata: { compraId, tipo: 'REGISTRO_MANUAL' },
        });

        if (usarPvpAuto && Number(det.precioUnitario || 0) > 0) {
          const nuevoPvp = Number((det.precioUnitario * (1 + Number(margenPct) / 100)).toFixed(4));
          await tx.productos_servicios.update({
            where: { id: prod.id },
            data: { precioUnitario: nuevoPvp, costoUnitario: det.precioUnitario },
          });
        }

        movimientosRegistrados++;
      }

      if (movimientosRegistrados > 0) {
        await tx.facturas_compra.update({
          where: { id: compraId },
          data: { movimientosInventario: movimientosRegistrados, registraInventario: true },
        });
      }
    });

    const partes = [];
    if (movimientosRegistrados > 0) partes.push(`${movimientosRegistrados} movimiento(s) de inventario registrado(s)`);
    if (productosCreados > 0) partes.push(`${productosCreados} producto(s) creado(s) en catálogo`);

    res.json({
      success: true,
      movimientosRegistrados,
      productosCreados,
      errores,
      mensaje: partes.length > 0
        ? partes.join(' y ')
        : 'No se encontraron productos inventariables en esta compra',
    });
  } catch (error) {
    console.error('POST /compras/:id/registrar-inventario:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'Error al registrar inventario' });
  }
});

// POST /api/compras/:id/regenerar-asiento — elimina el asiento COMPRA existente y crea uno nuevo
// Útil para actualizar el asiento cuando se cambia la cuentaGastoId u otro dato relevante.
router.post('/:id/regenerar-asiento', autorizarPermiso('compras.gestionar'), async (req, res) => {
  try {
    const compraId = parseInt(req.params.id, 10);
    const empresaId = req.empresa.id;

    const compra = await prisma.facturas_compra.findFirst({ where: { id: compraId, empresaId } });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (compra.anulada) return res.status(400).json({ success: false, mensaje: 'La compra está anulada — no se puede regenerar' });

    const asientoExistente = await prisma.asientos_contables.findFirst({
      where: { empresaId, tipo: 'COMPRA', referencia: `COMP-${compraId}` },
      select: { id: true, cerrado: true, bloqueado: true },
    });

    if (asientoExistente) {
      if (asientoExistente.cerrado) {
        return res.status(400).json({ success: false, mensaje: 'El asiento está en un período cerrado y no puede modificarse' });
      }
      if (asientoExistente.bloqueado) {
        return res.status(400).json({ success: false, mensaje: 'El asiento está bloqueado. Desblóqueelo desde Contabilidad antes de regenerar' });
      }
      // Eliminar el asiento viejo y sus líneas
      await prisma.$transaction(async (tx) => {
        await tx.asientos_contables_detalle.deleteMany({ where: { asientoId: asientoExistente.id } });
        await tx.asientos_contables.delete({ where: { id: asientoExistente.id } });
      });
    }

    const resultado = await crearAsientoFacturaCompraRegistrada({
      compraId,
      usuarioId: req.usuario?.id,
      fecha: compra.fechaEmision || new Date(),
    });

    res.json({
      success: true,
      mensaje: asientoExistente ? 'Asiento regenerado con la cuenta de gasto actualizada' : 'Asiento generado',
      data: resultado.asiento,
    });
  } catch (error) {
    console.error('POST /compras/:id/regenerar-asiento:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo regenerar el asiento' });
  }
});

// DELETE /api/compras/:id — eliminación física definitiva
// Requiere: sin pagos CxP activos. Si tiene movimientos de inventario no revertidos,
// exige anular primero (para que el stock quede en orden).
router.delete('/:id', async (req, res) => {
  try {
    const compraId = parseInt(req.params.id, 10);
    const empresaId = req.empresa.id;

    const compra = await prisma.facturas_compra.findFirst({ where: { id: compraId, empresaId } });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });

    const pagosActivos = await prisma.pagos_proveedor.count({ where: { compraId, anulado: false } });
    if (pagosActivos > 0) {
      return res.status(400).json({
        success: false,
        mensaje: `No se puede eliminar: tiene ${pagosActivos} pago(s) de proveedor activos. Anule los pagos primero.`,
      });
    }

    if ((compra.movimientosInventario || 0) > 0 && !compra.anulada) {
      return res.status(400).json({
        success: false,
        mensaje: 'La compra tiene movimientos de inventario. Anúlela primero para revertir el stock, luego elimínela.',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.retenciones.deleteMany({ where: { compraId } });
      await tx.facturas_compra.delete({ where: { id: compraId } });
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id,
      accion: 'ELIMINAR',
      tabla: 'facturas_compra',
      registroId: compraId,
      datosNuevos: { eliminada: true, numeroFactura: compra.numeroFactura },
      req,
    });

    res.json({ success: true, mensaje: `Compra ${compra.numeroFactura} eliminada definitivamente` });
  } catch (error) {
    console.error('DELETE /compras/:id:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'No se pudo eliminar la compra' });
  }
});

// PATCH /api/compras/:id/item-utilidad — edita utilidadPct y precioVentaReferencial de un ítem del detalle
router.patch('/:id/item-utilidad', autorizarPermiso('compras.gestionar'), async (req, res) => {
  try {
    const compraId  = parseInt(req.params.id, 10);
    const empresaId = req.empresa.id;
    const { itemIndex, utilidadPct, precioVentaReferencial } = req.body || {};

    if (typeof itemIndex !== 'number' || itemIndex < 0) {
      return res.status(400).json({ success: false, mensaje: 'itemIndex inválido' });
    }

    const compra = await prisma.facturas_compra.findFirst({ where: { id: compraId, empresaId } });
    if (!compra) return res.status(404).json({ success: false, mensaje: 'Compra no encontrada' });
    if (compra.anulada) return res.status(400).json({ success: false, mensaje: 'La compra está anulada' });

    const detalles = Array.isArray(compra.detalles)
      ? [...compra.detalles]
      : JSON.parse(compra.detalles || '[]');

    if (itemIndex >= detalles.length) {
      return res.status(400).json({ success: false, mensaje: `No existe ítem en posición ${itemIndex}` });
    }

    const item = { ...detalles[itemIndex] };
    if (utilidadPct !== undefined) item.utilidadPct = utilidadPct !== null ? Number(parseFloat(utilidadPct).toFixed(4)) : null;
    if (precioVentaReferencial !== undefined) item.precioVentaReferencial = precioVentaReferencial !== null ? Number(parseFloat(precioVentaReferencial).toFixed(4)) : null;
    detalles[itemIndex] = item;

    await prisma.$transaction(async (tx) => {
      await tx.facturas_compra.update({ where: { id: compraId }, data: { detalles } });

      // Actualizar PVP del producto en catálogo si existe
      if (item.precioVentaReferencial != null && Number(item.precioVentaReferencial) > 0) {
        const prodId = item.productoId
          ? parseInt(item.productoId, 10)
          : null;
        const prod = prodId
          ? await tx.productos_servicios.findFirst({ where: { id: prodId, empresaId } })
          : (item.codigoPrincipal
              ? await tx.productos_servicios.findFirst({ where: { codigoPrincipal: item.codigoPrincipal, empresaId } })
              : null);
        if (prod) {
          await tx.productos_servicios.update({
            where: { id: prod.id },
            data: {
              precioUnitario: Number(parseFloat(item.precioVentaReferencial).toFixed(4)),
              ...(item.precioUnitario != null ? { costoUnitario: Number(item.precioUnitario) } : {}),
            },
          });
        }
      }
    });

    res.json({ success: true, mensaje: 'Utilidad/PVP actualizado', detalles });
  } catch (error) {
    console.error('PATCH /compras/:id/item-utilidad:', error);
    res.status(500).json({ success: false, mensaje: error.message || 'Error al actualizar ítem' });
  }
});

module.exports = router;
