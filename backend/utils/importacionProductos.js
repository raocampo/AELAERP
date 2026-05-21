const XLSX = require('xlsx');
const { XMLParser } = require('fast-xml-parser');
const sri = require('./sri');
const { aplicarMovimientoInventario } = require('./inventario');

const XML_OPTIONS = {
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
  cdataPropName: '__cdata',
};

const HEADERS = {
  codigoPrincipal: ['codigoprincipal', 'codigo', 'sku', 'item', 'codigoitem', 'codigoproducto'],
  codigoAuxiliar: ['codigoauxiliar', 'codigobarras', 'barras', 'barcode', 'barra', 'auxiliar'],
  nombre: ['nombre', 'descripcion', 'producto', 'detalle', 'nombreproducto'],
  precioUnitario: ['precioventa', 'preciounitario', 'precio', 'pvp', 'venta'],
  costoUnitario: ['costounitario', 'costocompra', 'costo', 'preciocompra'],
  tarifaIva: ['iva', 'tarifaiva', 'impuesto', 'porcentajeiva'],
  unidadMedida: ['unidadmedida', 'unidad', 'uom'],
  inventariable: ['inventariable', 'manejastock', 'controlastock', 'stock'],
  stockActual: ['stockactual', 'stock', 'existencia', 'cantidad'],
  stockMinimo: ['stockminimo', 'minimo', 'stockmin'],
  activo: ['activo', 'estado'],
  infoAdicional: ['infoadicional', 'observacion', 'observaciones', 'notas'],
};

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

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
  const texto = normalizarTexto(valor);
  if (!texto) return fallback;
  if (['1', 'si', 'true', 'activo', 'yes', 'x'].includes(texto)) return true;
  if (['0', 'no', 'false', 'inactivo'].includes(texto)) return false;
  return fallback;
}

function normalizarTarifaIva(valor) {
  const numero = Math.round(toNumber(valor, 0));
  if (numero <= 0) return 0;
  if (numero > 0 && numero <= 5) return 5;
  return 15;
}

function obtenerValorFila(fila, aliases = []) {
  const entries = Object.entries(fila || {});
  for (const [key, value] of entries) {
    const normalizado = normalizarTexto(key);
    if (aliases.includes(normalizado)) return value;
  }
  return undefined;
}

function generarCodigoDesdeTexto(texto, index = 0) {
  const base = limpiarTexto(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 24);
  return base || `IMP-${String(index + 1).padStart(3, '0')}`;
}

function mapearFilaProducto(fila, index = 0) {
  const codigoPrincipal = limpiarCodigo(
    obtenerValorFila(fila, HEADERS.codigoPrincipal)
    || obtenerValorFila(fila, HEADERS.codigoAuxiliar)
    || generarCodigoDesdeTexto(obtenerValorFila(fila, HEADERS.nombre), index)
  );
  const nombre = limpiarTexto(obtenerValorFila(fila, HEADERS.nombre));

  if (!codigoPrincipal || !nombre) return null;

  return {
    codigoPrincipal,
    codigoAuxiliar: limpiarTexto(obtenerValorFila(fila, HEADERS.codigoAuxiliar)) || null,
    nombre,
    precioUnitario: toNumber(obtenerValorFila(fila, HEADERS.precioUnitario), 0),
    costoUnitario: toNumber(obtenerValorFila(fila, HEADERS.costoUnitario), 0),
    tarifaIva: normalizarTarifaIva(obtenerValorFila(fila, HEADERS.tarifaIva)),
    unidadMedida: limpiarTexto(obtenerValorFila(fila, HEADERS.unidadMedida)) || 'UND',
    inventariable: toBoolean(obtenerValorFila(fila, HEADERS.inventariable), false),
    stockActual: toNumber(obtenerValorFila(fila, HEADERS.stockActual), 0),
    stockMinimo: toNumber(obtenerValorFila(fila, HEADERS.stockMinimo), 0),
    activo: toBoolean(obtenerValorFila(fila, HEADERS.activo), true),
    infoAdicional: limpiarTexto(obtenerValorFila(fila, HEADERS.infoAdicional)) || null,
  };
}

function crearPlantillaProductosXlsx() {
  const filas = [
    {
      codigoPrincipal: 'P001',
      codigoAuxiliar: '7501234567890',
      nombre: 'Paracetamol 500 mg',
      precioVenta: 2.5,
      costoUnitario: 1.8,
      iva: 0,
      unidad: 'UND',
      inventariable: 'SI',
      stockActual: 25,
      stockMinimo: 5,
      activo: 'SI',
      infoAdicional: 'Ejemplo importado desde plantilla AELA',
    },
    {
      codigoPrincipal: 'SERV001',
      codigoAuxiliar: '',
      nombre: 'Consulta general',
      precioVenta: 20,
      costoUnitario: 0,
      iva: 15,
      unidad: 'UND',
      inventariable: 'NO',
      stockActual: 0,
      stockMinimo: 0,
      activo: 'SI',
      infoAdicional: 'Servicio',
    },
  ];

  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = [
    { wch: 18 }, { wch: 18 }, { wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 10 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 32 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function leerFilasDesdeExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.SheetNames[0];
  if (!hoja) return [];
  return XLSX.utils.sheet_to_json(wb.Sheets[hoja], {
    defval: '',
    raw: false,
  });
}

function ensureArray(valor) {
  if (!valor) return [];
  return Array.isArray(valor) ? valor : [valor];
}

function extraerXmlPrincipal(xmlString) {
  const xml = String(xmlString || '').trim();
  const cdataMatch = xml.match(/<comprobante><!\[CDATA\[([\s\S]*?)\]\]><\/comprobante>/i);
  if (cdataMatch?.[1]) return cdataMatch[1];

  const parser = new XMLParser(XML_OPTIONS);
  try {
    const parsed = parser.parse(xml);
    const comprobante = parsed?.autorizacion?.comprobante?.__cdata
      || parsed?.autorizacion?.comprobante
      || parsed?.respuestaAutorizacionComprobante?.autorizaciones?.autorizacion?.comprobante?.__cdata
      || parsed?.respuestaAutorizacionComprobante?.autorizaciones?.autorizacion?.comprobante;
    return typeof comprobante === 'string' && comprobante.trim() ? comprobante : xml;
  } catch {
    return xml;
  }
}

function extraerTarifaIvaDetalle(impuesto) {
  if (!impuesto) return 0;
  const tarifa = toNumber(impuesto.tarifa, NaN);
  if (Number.isFinite(tarifa)) return normalizarTarifaIva(tarifa);

  const codigo = String(impuesto.codigoPorcentaje || impuesto.porcentajeCodigo || '').trim();
  if (codigo === '0') return 0;
  if (codigo === '5') return 5;
  if (['2', '3', '4'].includes(codigo)) return 15;
  return 0;
}

function obtenerImpuestoDetalle(detalle) {
  const impuestos = detalle?.impuestos?.impuesto;
  if (Array.isArray(impuestos)) return impuestos[0] || null;
  return impuestos || null;
}

function parsearProductosDesdeXmlFactura(xmlString, margenUtilidad = 0) {
  const parser = new XMLParser(XML_OPTIONS);
  const xmlPrincipal = extraerXmlPrincipal(xmlString);
  const parsed = parser.parse(xmlPrincipal);
  const factura = parsed?.factura || parsed?.notaCredito || parsed?.liquidacionCompra || parsed;
  const detalles = ensureArray(factura?.detalles?.detalle);
  const margen = Number(margenUtilidad) || 0;

  return detalles.map((detalle, index) => {
    const impuesto = obtenerImpuestoDetalle(detalle);
    // costoUnitario = precio del proveedor (lo que pagamos al proveedor)
    const costoUnitario = toNumber(detalle.precioUnitario, 0);
    // precioUnitario (precio de venta al cliente) = costo * (1 + margen/100), 0 si no hay margen
    const precioUnitario = margen > 0
      ? Number((costoUnitario * (1 + margen / 100)).toFixed(4))
      : 0;
    return {
      codigoPrincipal: limpiarCodigo(detalle.codigoPrincipal || generarCodigoDesdeTexto(detalle.descripcion, index)),
      codigoAuxiliar: limpiarTexto(detalle.codigoAuxiliar || '') || null,
      nombre: limpiarTexto(detalle.descripcion || `ITEM ${index + 1}`),
      precioUnitario,                           // precio de venta calculado con margen
      costoUnitario,                            // precio de compra (del XML proveedor)
      tarifaIva: extraerTarifaIvaDetalle(impuesto),
      unidadMedida: limpiarTexto(detalle.unidadMedida || 'UND') || 'UND',
      inventariable: true,
      stockActual: toNumber(detalle.cantidad, 0),
      stockMinimo: 0,
      activo: true,
      infoAdicional: 'Importado desde XML de compra',
    };
  }).filter((item) => item.codigoPrincipal && item.nombre);
}

function detectarTipoIdentificacion(identificacion) {
  const limpio = limpiarTexto(identificacion).replace(/\D/g, '');
  if (limpio.length === 13) return '04';
  if (limpio.length === 10) return '05';
  return '06';
}

function parsearFechaDocumento(valor) {
  const texto = limpiarTexto(valor);
  if (!texto) return null;

  const match = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }

  const date = new Date(texto);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatearNumeroComprobante(estab, ptoEmi, secuencial) {
  if (!estab || !ptoEmi || !secuencial) return '';
  return `${String(estab).padStart(3, '0')}-${String(ptoEmi).padStart(3, '0')}-${String(secuencial).padStart(9, '0')}`;
}

function extraerAutorizacion(xmlString) {
  const parser = new XMLParser(XML_OPTIONS);
  try {
    const parsed = parser.parse(String(xmlString || '').trim());
    const autorizacion = parsed?.autorizacion
      || ensureArray(parsed?.respuestaAutorizacionComprobante?.autorizaciones?.autorizacion)[0]
      || null;

    return {
      numeroAutorizacion: limpiarTexto(autorizacion?.numeroAutorizacion || ''),
      fechaAutorizacion: limpiarTexto(autorizacion?.fechaAutorizacion || ''),
      ambiente: limpiarTexto(autorizacion?.ambiente || ''),
      estado: limpiarTexto(autorizacion?.estado || ''),
    };
  } catch {
    return {
      numeroAutorizacion: '',
      fechaAutorizacion: '',
      ambiente: '',
      estado: '',
    };
  }
}

function parsearFacturaCompraDesdeXml(xmlString) {
  const parser = new XMLParser(XML_OPTIONS);
  const autorizacion = extraerAutorizacion(xmlString);
  const xmlPrincipal = extraerXmlPrincipal(xmlString);
  const parsed = parser.parse(xmlPrincipal);
  const factura = parsed?.factura || parsed?.liquidacionCompra || parsed;
  const infoTrib = factura?.infoTributaria || factura?.infoTrib || {};
  const infoFactura = factura?.infoFactura || factura?.infoLiquidacionCompra || {};
  const detallesXml = ensureArray(factura?.detalles?.detalle);

  const detalles = detallesXml.map((detalle, index) => {
    const impuesto = obtenerImpuestoDetalle(detalle);
    const cantidad = toNumber(detalle.cantidad, 0);
    const precioUnitario = toNumber(detalle.precioUnitario, 0);
    const descuento = toNumber(detalle.descuento, 0);
    const precioTotalSinImpuesto = toNumber(detalle.precioTotalSinImpuesto, (cantidad * precioUnitario) - descuento);
    const porcentajeIva = extraerTarifaIvaDetalle(impuesto);
    const totalLinea = precioTotalSinImpuesto + (porcentajeIva > 0 ? toNumber(impuesto?.valor, precioTotalSinImpuesto * (porcentajeIva / 100)) : 0);

    return {
      codigoPrincipal: limpiarCodigo(detalle.codigoPrincipal || generarCodigoDesdeTexto(detalle.descripcion, index)),
      codigoAuxiliar: limpiarTexto(detalle.codigoAuxiliar || '') || null,
      descripcion: limpiarTexto(detalle.descripcion || `ITEM ${index + 1}`),
      cantidad,
      precioUnitario,
      porcentajeIva,
      descuento,
      subtotal: Number(precioTotalSinImpuesto.toFixed(2)),
      total: Number(totalLinea.toFixed(2)),
      inventariable: true,
    };
  }).filter((item) => item.descripcion && item.cantidad > 0);

  const totales = detalles.reduce((acc, item) => {
    const subtotal = toNumber(item.subtotal, 0);
    const descuento = toNumber(item.descuento, 0);
    const iva = item.porcentajeIva > 0 ? subtotal * (item.porcentajeIva / 100) : 0;

    if (item.porcentajeIva > 0) acc.subtotal15 += subtotal;
    else acc.subtotal0 += subtotal;

    acc.totalDescuento += descuento;
    acc.totalIva += iva;
    acc.importeTotal += subtotal + iva;
    return acc;
  }, {
    subtotal0: 0,
    subtotal15: 0,
    totalDescuento: 0,
    totalIva: 0,
    importeTotal: 0,
  });

  const pagos = ensureArray(infoFactura?.pagos?.pago).map((pago) => ({
    formaPago: limpiarTexto(pago.formaPago || pago.codigo || '20') || '20',
    total: Number(toNumber(pago.total, 0).toFixed(2)),
    plazo: pago.plazo ? toNumber(pago.plazo, 0) : null,
    unidadTiempo: limpiarTexto(pago.unidadTiempo || '') || null,
  })).filter((pago) => pago.total > 0);

  return {
    proveedor: {
      tipoIdentificacionProveedor: detectarTipoIdentificacion(infoTrib.ruc || infoFactura.identificacionProveedor || ''),
      identificacionProveedor: limpiarTexto(infoTrib.ruc || infoFactura.identificacionProveedor || ''),
      razonSocialProveedor: limpiarTexto(infoTrib.razonSocial || infoFactura.razonSocialProveedor || ''),
      nombreComercialProveedor: limpiarTexto(infoTrib.nombreComercial || '') || null,
      direccionProveedor: limpiarTexto(infoFactura.dirEstablecimiento || infoTrib.dirMatriz || '') || null,
    },
    comprobante: {
      numeroFactura: formatearNumeroComprobante(infoTrib.estab, infoTrib.ptoEmi, infoTrib.secuencial),
      numeroAutorizacion: autorizacion.numeroAutorizacion || null,
      claveAcceso: limpiarTexto(infoTrib.claveAcceso || '') || null,
      fechaEmision: parsearFechaDocumento(infoFactura.fechaEmision),
      ambiente: autorizacion.ambiente || null,
      estado: autorizacion.estado || null,
    },
    detalles,
    pagos: pagos.length > 0 ? pagos : [{ formaPago: '20', total: Number(totales.importeTotal.toFixed(2)) }],
    totales: {
      subtotal0: Number(totales.subtotal0.toFixed(2)),
      subtotal15: Number(totales.subtotal15.toFixed(2)),
      totalDescuento: Number(totales.totalDescuento.toFixed(2)),
      totalIva: Number(totales.totalIva.toFixed(2)),
      importeTotal: Number(totales.importeTotal.toFixed(2)),
    },
    xmlOrigen: xmlPrincipal,
  };
}

async function obtenerXmlDesdeAutorizacion(claveAcceso) {
  const clave = limpiarTexto(claveAcceso);
  if (!clave) throw new Error('La autorización o clave de acceso es requerida');

  const ambientes = [2, 1];
  for (const ambiente of ambientes) {
    try {
      const respuesta = await sri.autorizarComprobanteSRI(clave, ambiente);
      if (respuesta?.xmlAutorizado) {
        return {
          ambiente,
          numeroAutorizacion: respuesta.numeroAutorizacion || clave,
          xml: respuesta.xmlAutorizado,
        };
      }
    } catch (error) {
      // Continuar con el otro ambiente.
    }
  }

  throw new Error('No se pudo recuperar un XML autorizado desde el SRI con esa clave de acceso');
}

async function importarProductos({
  tx,
  empresaId,
  usuarioId = null,
  productos = [],
  registrarEntradaInventario = false,
  origen = 'manual',
}) {
  const resumen = {
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    movimientos: 0,
    items: [],
  };

  for (const item of productos) {
    if (!item?.codigoPrincipal || !item?.nombre) {
      resumen.omitidos += 1;
      continue;
    }

    const existente = await tx.productos_servicios.findFirst({
      where: { empresaId, codigoPrincipal: item.codigoPrincipal },
    });

    const dataBase = {
      empresaId,
      codigoPrincipal: item.codigoPrincipal,
      codigoAuxiliar: item.codigoAuxiliar || null,
      nombre: item.nombre,
      precioUnitario: Number(item.precioUnitario || 0),
      costoUnitario: Number(item.costoUnitario || 0),
      tarifaIva: Number(item.tarifaIva || 0),
      unidadMedida: item.unidadMedida || 'UND',
      inventariable: Boolean(item.inventariable),
      stockMinimo: Number(item.stockMinimo || 0),
      activo: item.activo !== false,
      infoAdicional: item.infoAdicional || null,
    };

    let producto;
    const stockObjetivo = Number(item.stockActual || 0);

    if (existente) {
      producto = await tx.productos_servicios.update({
        where: { id: existente.id },
        data: {
          ...dataBase,
          ...(!registrarEntradaInventario ? { stockActual: stockObjetivo } : {}),
        },
      });
      resumen.actualizados += 1;
    } else {
      producto = await tx.productos_servicios.create({
        data: {
          ...dataBase,
          stockActual: registrarEntradaInventario ? 0 : stockObjetivo,
        },
      });
      resumen.creados += 1;
    }

    if (registrarEntradaInventario && dataBase.inventariable && stockObjetivo !== 0) {
      const stockAnterior = existente ? Number(existente.stockActual || 0) : 0;
      const delta = Number((stockObjetivo - stockAnterior).toFixed(3));

      if (delta !== 0) {
        const tipo = delta > 0 ? 'ENTRADA' : 'AJUSTE_NEGATIVO';
        const movimientoResultado = await aplicarMovimientoInventario({
          tx,
          empresaId,
          productoId: producto.id,
          usuarioId,
          tipo,
          deltaCantidad: delta,
          referencia: `IMPORT-${origen.toUpperCase()}`,
          observacion: `Importación de producto desde ${origen}`,
          metadata: { origen },
          costoUnitario: dataBase.costoUnitario,
        });

        if (movimientoResultado?.movimiento) {
          resumen.movimientos += 1;
        } else {
          producto = await tx.productos_servicios.update({
            where: { id: producto.id },
            data: { stockActual: stockObjetivo },
          });
        }
      }
    }

    resumen.items.push({
      id: producto.id,
      codigoPrincipal: producto.codigoPrincipal,
      nombre: producto.nombre,
      inventariable: producto.inventariable,
      stockActual: producto.stockActual,
      costoUnitario: producto.costoUnitario,
      precioUnitario: producto.precioUnitario,
    });
  }

  return resumen;
}

module.exports = {
  crearPlantillaProductosXlsx,
  leerFilasDesdeExcel,
  mapearFilaProducto,
  parsearProductosDesdeXmlFactura,
  parsearFacturaCompraDesdeXml,
  obtenerXmlDesdeAutorizacion,
  importarProductos,
};
