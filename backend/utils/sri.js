// ====================================
// UTILIDADES SRI - FACTURACIÓN ELECTRÓNICA ECUADOR
// backend/utils/sri.js
//
// Funciones puras para:
//   - Generar clave de acceso (49 dígitos + módulo 11)
//   - Generar XML de Factura y Nota de Crédito (xmlbuilder2)
//   - Firmar XML con XAdES-BES (node-forge + P12)
//   - Enviar y autorizar comprobantes vía SOAP
//   - Generar RIDE (PDF pdfkit) con QR de la clave de acceso
// ====================================

const { create } = require('xmlbuilder2');
const forge      = require('node-forge');
const QRCode     = require('qrcode');
const https      = require('https');
const PDFDocument = require('pdfkit');
const fs         = require('fs');
const path       = require('path');
const bwipjs     = require('bwip-js');

// ─── Constantes SRI ─────────────────────────────────────────────────────────

const SRI_URLS = {
  1: { // Pruebas
    recepcion:    'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion: 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
  },
  2: { // Producción
    recepcion:    'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
    autorizacion: 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
  },
};

// Tipos de comprobante SRI
const TIPO_COMPROBANTE = {
  FACTURA:             '01',
  LIQUIDACION_COMPRA:  '03',
  NOTA_CREDITO:        '04',
  NOTA_DEBITO:         '05',
  GUIA_REMISION:       '06',
  COMPROBANTE_RETENCION: '07',
};

// Formas de pago SRI (tabla 24 del ficha técnica v2.26)
const FORMAS_PAGO = {
  'Efectivo':                     '01',
  'Cheque':                       '20', // Otros con utilización del sistema financiero
  'Débito bancario':              '16',
  'Tarjeta de crédito':           '19',
  'Tarjeta de débito':            '16',
  'Dinero electrónico':           '17',
  'Tarjeta prepago':              '18',
  'Transferencia':                '20',
  'App Móvil (Ahorita/De Una)':   '17', // dinero electrónico / transferencia móvil
  'Otro':                         '20',
};

// Conjunto de códigos SRI válidos (tabla 24) para lookup directo
const VALID_SRI_FORMA_PAGO = new Set(['01','15','16','17','18','19','20','21']);

/**
 * Resuelve el logo de la configuración SRI para uso en PDFKit.
 * Soporta data URIs base64 (nuevo formato) y rutas de archivo (legado).
 * @returns {{ logoData: Buffer|string|null, tienelogo: boolean }}
 */
function _resolverLogo(logoUrl) {
  if (!logoUrl) return { logoData: null, tienelogo: false };
  // Nuevo formato: data URI base64
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return { logoData: Buffer.from(b64, 'base64'), tienelogo: true };
    } catch { return { logoData: null, tienelogo: false }; }
  }
  // Formato legado: ruta de archivo (/uploads/logos/...)
  const logoPath = path.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  const existe   = fs.existsSync(logoPath);
  return { logoData: existe ? logoPath : null, tienelogo: existe };
}

/**
 * Resuelve el código SRI de forma de pago.
 * Acepta el código directamente ('01','19', etc.) o el nombre en español.
 */
function resolverFormaPago(formaPago) {
  if (VALID_SRI_FORMA_PAGO.has(String(formaPago))) return String(formaPago);
  return FORMAS_PAGO[formaPago] || '01';
}

// IVA codigoPorcentaje SRI (tabla 17 - ficha técnica v2.26)
const IVA_CODIGO = {
  0:          '0',   // 0%
  5:          '5',   // 5%  (Ley Bienestar Social 2024)
  12:         '2',   // 12% (tarifa legacy)
  15:         '4',   // 15% (tarifa vigente desde abr 2024)
  'noObjeto': '6',   // No objeto de IVA
  'exento':   '7',   // Exento de IVA
};

const IVA_TARIFA = {
  0:  0.00,
  5:  0.05,
  12: 0.12,
  15: 0.15,
};

// ─── Parseo de Nota de Crédito RECIBIDA (docs_recibidos_otros.xmlAutorizado) ────
// Extrae bases/IVA por tarifa y la referencia al documento original (codDocModificado
// + numDocModificado "EEE-PPP-SSSSSSSSS") para poder reportar la NC en el ATS
// (detalleCompras, tipoComprobante '04') y restarla del crédito fiscal de IVA.
// Estructura confirmada contra XMLs autorizados reales (esquema notaCredito
// v1.0.0/1.1.0 del SRI) y contra el XSD oficial (docModificado/numDocModificado).
function parsearNotaCreditoRecibidaXml(xmlAutorizado) {
  const vacio = {
    estab: '001', ptoEmi: '001', secuencial: '000000001', claveAcceso: '',
    codDocModificado: '01', numDocModificado: '',
    baseNoObjeto: 0, base0: 0, base5: 0, base12: 0, base15: 0, baseGravada: 0,
    iva: 0,
  };
  if (!xmlAutorizado) return vacio;

  const bloqueTrib = xmlAutorizado.match(/<infoTributaria>[\s\S]*?<\/infoTributaria>/);
  const bloqueInfo = xmlAutorizado.match(/<infoNotaCredito>[\s\S]*?<\/infoNotaCredito>/);
  const uno = (bloque, tag) => {
    if (!bloque) return '';
    const m = bloque[0].match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };

  const estab      = uno(bloqueTrib, 'estab');
  const ptoEmi     = uno(bloqueTrib, 'ptoEmi');
  const secuencial = uno(bloqueTrib, 'secuencial');

  // codigoPorcentaje: 0=0%, 5=5%, 2=12%, 4=15%, 6/7=no objeto/exento (misma
  // tabla que IVA_CODIGO más arriba, en sentido inverso).
  let baseNoObjeto = 0, base0 = 0, base5 = 0, base12 = 0, base15 = 0, iva = 0;
  const bloques = xmlAutorizado.match(/<totalImpuesto>[\s\S]*?<\/totalImpuesto>/g) || [];
  bloques.forEach((b) => {
    if (!/<codigo>2<\/codigo>/.test(b)) return; // solo IVA, ignorar ICE (código 3)
    const pct   = (b.match(/<codigoPorcentaje>(\d+)<\/codigoPorcentaje>/) || [])[1] || '0';
    const base  = parseFloat((b.match(/<baseImponible>([\d.]+)<\/baseImponible>/) || [])[1] || 0);
    const valor = parseFloat((b.match(/<valor>([\d.]+)<\/valor>/) || [])[1] || 0);
    if (pct === '6' || pct === '7') baseNoObjeto += base;
    else if (pct === '0') base0 += base;
    else if (pct === '5') base5 += base;
    else if (pct === '2') base12 += base;
    else base15 += base; // '4' (vigente) o cualquier otro código de tarifa >0%
    iva += valor;
  });

  return {
    estab:      estab.padStart(3, '0') || '001',
    ptoEmi:     ptoEmi.padStart(3, '0') || '001',
    secuencial: secuencial.padStart(9, '0') || '000000001',
    claveAcceso: uno(bloqueTrib, 'claveAcceso'),
    codDocModificado: uno(bloqueInfo, 'codDocModificado') || '01',
    numDocModificado: uno(bloqueInfo, 'numDocModificado'),
    baseNoObjeto: parseFloat(baseNoObjeto.toFixed(2)),
    base0:        parseFloat(base0.toFixed(2)),
    base5:        parseFloat(base5.toFixed(2)),
    base12:       parseFloat(base12.toFixed(2)),
    base15:       parseFloat(base15.toFixed(2)),
    baseGravada:  parseFloat((base5 + base12 + base15).toFixed(2)),
    iva:          parseFloat(iva.toFixed(2)),
  };
}

// ─── 1. CLAVE DE ACCESO ──────────────────────────────────────────────────────

/**
 * Calcula el dígito verificador de la clave de acceso usando módulo 11.
 * @param {string} clave48 - Clave de 48 dígitos (sin dígito verificador)
 * @returns {string} dígito verificador ('0'-'9' o '1' si resultado es 11)
 */
function calcularDigitoVerificador(clave48) {
  const factores = [2, 3, 4, 5, 6, 7];
  let suma = 0;
  let f = 0;
  for (let i = clave48.length - 1; i >= 0; i--) {
    suma += parseInt(clave48[i]) * factores[f % 6];
    f++;
  }
  const residuo = suma % 11;
  if (residuo === 0) return '0';
  if (residuo === 1) return '1';
  return String(11 - residuo);
}

/**
 * Genera la clave de acceso de 49 dígitos según el SRI Ecuador.
 * Estructura: ddMMaaaa (8) + tipoCod (2) + ruc (13) + ambiente (1)
 *           + estab (3) + ptoEmi (3) + secuencial (9) + codNumerico (8)
 *           + tipoEmision (1) + dígito verificador (1) = 49 chars
 */
function generarClaveAcceso({ fecha, tipoCod, ruc, ambiente, estab, ptoEmi, secuencial, codNumerico }) {
  const d = new Date(fecha);
  const dd   = String(d.getDate()).padStart(2, '0');
  const MM   = String(d.getMonth() + 1).padStart(2, '0');
  const aaaa = String(d.getFullYear());

  const cn = codNumerico
    ? String(codNumerico).padStart(8, '0')
    : String(Math.floor(Math.random() * 99999999) + 1).padStart(8, '0');

  const clave48 =
    `${dd}${MM}${aaaa}` +       // 8
    `${tipoCod}` +              // 2
    `${ruc}` +                  // 13
    `${ambiente}` +             // 1
    `${String(estab).padStart(3, '0')}` +    // 3
    `${String(ptoEmi).padStart(3, '0')}` +   // 3
    `${String(secuencial).padStart(9, '0')}` + // 9
    `${cn}` +                   // 8
    `1`;                        // 1 (tipo emisión normal)

  const dv = calcularDigitoVerificador(clave48);
  return clave48 + dv; // 49 chars
}

/**
 * Formatea el número de factura: "001-001-000000001"
 */
function formatearNumeroFactura(estab, ptoEmi, secuencial) {
  return `${String(estab).padStart(3, '0')}-${String(ptoEmi).padStart(3, '0')}-${String(secuencial).padStart(9, '0')}`;
}

// ─── 2. GENERACIÓN XML ───────────────────────────────────────────────────────

/**
 * Genera el XML de una Factura según el esquema SRI versión 1.1.0
 */
function generarXMLFactura(data, config) {
  const {
    claveAcceso,
    secuencial,
    fechaEmision,
    tipoIdentificacionComprador,
    identificacionComprador,
    razonSocialComprador,
    direccionComprador,
    emailComprador,
    telefonoComprador,
    detalles,        // [{codigoPrincipal, descripcion, cantidad, precioUnitario, descuento, ivaPorcentaje}]
    pagos,           // [{formaPago, total, plazo, unidadTiempo}]
    propina,
    observaciones,
  } = data;

  const d = new Date(fechaEmision);
  const fechaStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  // Calcular totales por tipo de IVA
  let subtotal0    = 0;
  let subtotal5    = 0;
  let subtotal12   = 0;
  let subtotal15   = 0;
  let subtotalNOIva = 0;
  let totalDesc    = 0;
  let totalIva     = 0;

  const detallesXML = detalles.map(det => {
    const cant    = parseFloat(det.cantidad) || 0;
    const precio  = parseFloat(det.precioUnitario) || 0;
    const desc    = parseFloat(det.descuento) || 0;
    const ivaPct  = parseInt(det.ivaPorcentaje) || 0; // 0, 5, 12, 15, 6 (NoObjeto), 7 (Exento)

    // Calcular con precisión completa para evitar drift al acumular con precios de 4+ decimales.
    // El XML del SRI pide precioTotalSinImpuesto e ivaValor en 2 decimales por línea,
    // pero la acumulación debe hacerse en alta precisión y redondear solo al final.
    const subtotalLineaFull = (cant * precio) - desc;
    const ivaLineaFull      = subtotalLineaFull * (IVA_TARIFA[ivaPct] ?? 0);

    totalDesc += desc;
    if (ivaPct === 0)                 subtotal0    += subtotalLineaFull;
    if (ivaPct === 5)                 subtotal5    += subtotalLineaFull;
    if (ivaPct === 12)                subtotal12   += subtotalLineaFull;
    if (ivaPct === 15)                subtotal15   += subtotalLineaFull;
    if (ivaPct === 6 || ivaPct === 7) subtotalNOIva += subtotalLineaFull;
    totalIva  += ivaLineaFull;

    // No Objeto (6) y Exento (7) tienen tarifa display 0.00
    const tarifaDisplay = (ivaPct === 6 || ivaPct === 7) ? '0.00' : ivaPct.toFixed(2);

    return {
      codigoPrincipal: det.codigoPrincipal || 'SRV001',
      descripcion:     det.descripcion,
      cantidad:        cant.toFixed(2),
      precioUnitario:  precio.toFixed(6),
      descuento:       desc.toFixed(2),
      precioTotalSinImpuesto: subtotalLineaFull.toFixed(2),
      ivaCodigo:       '2',  // 2 = IVA
      ivaCodPct:       IVA_CODIGO[ivaPct] || '0',
      ivaTarifa:       tarifaDisplay,
      ivaBaseImponible: subtotalLineaFull.toFixed(2),
      ivaValor:        ivaLineaFull.toFixed(2),
    };
  });

  subtotal0    = parseFloat(subtotal0.toFixed(2));
  subtotal5    = parseFloat(subtotal5.toFixed(2));
  subtotal12   = parseFloat(subtotal12.toFixed(2));
  subtotal15   = parseFloat(subtotal15.toFixed(2));
  totalDesc    = parseFloat(totalDesc.toFixed(2));
  totalIva     = parseFloat(totalIva.toFixed(2));
  const totalSinImpuestos = parseFloat((subtotal0 + subtotal5 + subtotal12 + subtotal15 + subtotalNOIva).toFixed(2));
  const importeTotal      = parseFloat((totalSinImpuestos + totalIva + parseFloat(propina || 0)).toFixed(2));

  // Construir XML con xmlbuilder2
  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('factura', { id: 'comprobante', version: '1.1.0' });

  // infoTributaria
  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.FACTURA);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.contribuyenteRimpe) {
    infoTrib.ele('contribuyenteRimpe').txt(config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE');
  }

  // infoFactura
  const infoFact = root.ele('infoFactura');
  infoFact.ele('fechaEmision').txt(fechaStr);
  infoFact.ele('dirEstablecimiento').txt(config.dirEstablecimiento || config.dirMatriz);
  if (config.contribuyenteEspecial) infoFact.ele('contribuyenteEspecial').txt(config.contribuyenteEspecial);
  infoFact.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoFact.ele('tipoIdentificacionComprador').txt(tipoIdentificacionComprador);
  if (tipoIdentificacionComprador === '07') {
    infoFact.ele('guiaRemision').txt('000-000-000000000');
  }
  infoFact.ele('razonSocialComprador').txt(razonSocialComprador);
  infoFact.ele('identificacionComprador').txt(identificacionComprador);
  if (direccionComprador) infoFact.ele('direccionComprador').txt(direccionComprador);
  infoFact.ele('totalSinImpuestos').txt(totalSinImpuestos.toFixed(2));
  infoFact.ele('totalDescuento').txt(totalDesc.toFixed(2));

  // totalConImpuestos
  const totImpuestos = infoFact.ele('totalConImpuestos');
  if (subtotal0 > 0 || (subtotal5 === 0 && subtotal12 === 0 && subtotal15 === 0)) {
    const ti0 = totImpuestos.ele('totalImpuesto');
    ti0.ele('codigo').txt('2');
    ti0.ele('codigoPorcentaje').txt('0');
    ti0.ele('baseImponible').txt(subtotal0.toFixed(2));
    ti0.ele('valor').txt('0.00');
  }
  if (subtotal5 > 0) {
    const ti5 = totImpuestos.ele('totalImpuesto');
    ti5.ele('codigo').txt('2');
    ti5.ele('codigoPorcentaje').txt('5');
    ti5.ele('baseImponible').txt(subtotal5.toFixed(2));
    ti5.ele('valor').txt((subtotal5 * 0.05).toFixed(2));
  }
  if (subtotal12 > 0) {
    const ti12 = totImpuestos.ele('totalImpuesto');
    ti12.ele('codigo').txt('2');
    ti12.ele('codigoPorcentaje').txt('2');
    ti12.ele('baseImponible').txt(subtotal12.toFixed(2));
    ti12.ele('valor').txt((subtotal12 * 0.12).toFixed(2));
  }
  if (subtotal15 > 0) {
    const ti15 = totImpuestos.ele('totalImpuesto');
    ti15.ele('codigo').txt('2');
    ti15.ele('codigoPorcentaje').txt('4');
    ti15.ele('baseImponible').txt(subtotal15.toFixed(2));
    ti15.ele('valor').txt((subtotal15 * 0.15).toFixed(2));
  }

  infoFact.ele('propina').txt(parseFloat(propina || 0).toFixed(2));
  infoFact.ele('importeTotal').txt(importeTotal.toFixed(2));
  infoFact.ele('moneda').txt('DOLAR');

  // pagos
  const pagosEle = infoFact.ele('pagos');
  (pagos && pagos.length > 0 ? pagos : [{ formaPago: 'Efectivo', total: importeTotal }]).forEach(p => {
    const pagoEle = pagosEle.ele('pago');
    pagoEle.ele('formaPago').txt(resolverFormaPago(p.formaPago));
    pagoEle.ele('total').txt(parseFloat(p.total).toFixed(2));
    pagoEle.ele('plazo').txt(String(p.plazo || 0));
    pagoEle.ele('unidadTiempo').txt(p.unidadTiempo || 'dias');
  });

  // detalles
  const detallesEle = root.ele('detalles');
  detallesXML.forEach(det => {
    const detEle = detallesEle.ele('detalle');
    detEle.ele('codigoPrincipal').txt(det.codigoPrincipal);
    detEle.ele('descripcion').txt(det.descripcion);
    detEle.ele('cantidad').txt(det.cantidad);
    detEle.ele('precioUnitario').txt(det.precioUnitario);
    detEle.ele('descuento').txt(det.descuento);
    detEle.ele('precioTotalSinImpuesto').txt(det.precioTotalSinImpuesto);
    const impEle = detEle.ele('impuestos').ele('impuesto');
    impEle.ele('codigo').txt(det.ivaCodigo);
    impEle.ele('codigoPorcentaje').txt(det.ivaCodPct);
    impEle.ele('tarifa').txt(det.ivaTarifa);
    impEle.ele('baseImponible').txt(det.ivaBaseImponible);
    impEle.ele('valor').txt(det.ivaValor);
  });

  // infoAdicional — datos del comprador + vendedor + observaciones
  {
    const camposAd = [];
    if (emailComprador)         camposAd.push({ nombre: 'Correo',      valor: emailComprador });
    if (telefonoComprador)      camposAd.push({ nombre: 'Telefono',    valor: telefonoComprador });
    if (direccionComprador)     camposAd.push({ nombre: 'Direccion',   valor: direccionComprador });
    if (data.vendedor)          camposAd.push({ nombre: 'Vendedor',    valor: data.vendedor });
    if (observaciones)          camposAd.push({ nombre: 'Observacion', valor: observaciones });
    if (camposAd.length > 0) {
      const infoAd = root.ele('infoAdicional');
      camposAd.forEach(c => infoAd.ele('campoAdicional', { nombre: c.nombre }).txt(c.valor));
    }
  }

  return {
    xml: root.end({ prettyPrint: true }),
    totales: { subtotal0, subtotal5, subtotal12, subtotal15, totalDescuento: totalDesc, totalIva, importeTotal, propina: parseFloat(propina || 0) },
  };
}

/**
 * Genera el XML de una Nota de Crédito según el esquema SRI versión 1.1.0
 */
function generarXMLNotaCredito(data, config) {
  const {
    claveAcceso,
    secuencial,
    fechaEmision,
    tipoIdentificacionComprador,
    identificacionComprador,
    razonSocialComprador,
    numeroFacturaAfectada,
    fechaEmisionDocSustento,
    motivoModificacion,
    detalles,
  } = data;

  const d = new Date(fechaEmision);
  const fechaStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const dSust = new Date(fechaEmisionDocSustento);
  const fechaSustStr = `${String(dSust.getDate()).padStart(2,'0')}/${String(dSust.getMonth()+1).padStart(2,'0')}/${dSust.getFullYear()}`;

  let totalSinImpuestos = 0;
  let totalIva = 0;
  const subtotalesPorTasa = new Map(); // ivaPct -> { sub, iva }

  const detallesXML = detalles.map(det => {
    const cant   = parseFloat(det.cantidad) || 0;
    const precio = parseFloat(det.precioUnitario) || 0;
    const ivaPct = parseInt(det.ivaPorcentaje) || 0;
    const sub    = parseFloat((cant * precio).toFixed(2));
    const iva    = parseFloat((sub * (IVA_TARIFA[ivaPct] ?? 0)).toFixed(2));
    totalSinImpuestos += sub;
    totalIva += iva;
    const acum = subtotalesPorTasa.get(ivaPct) || { sub: 0, iva: 0 };
    subtotalesPorTasa.set(ivaPct, { sub: acum.sub + sub, iva: acum.iva + iva });
    return { descripcion: det.descripcion, cantidad: cant, precio, sub, ivaPct, iva };
  });

  totalSinImpuestos = parseFloat(totalSinImpuestos.toFixed(2));
  totalIva          = parseFloat(totalIva.toFixed(2));
  const importeTotal = parseFloat((totalSinImpuestos + totalIva).toFixed(2));

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('notaCredito', { id: 'comprobante', version: '1.1.0' });

  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.NOTA_CREDITO);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.contribuyenteRimpe) {
    infoTrib.ele('contribuyenteRimpe').txt(config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE');
  }

  const infoNC = root.ele('infoNotaCredito');
  infoNC.ele('fechaEmision').txt(fechaStr);
  infoNC.ele('dirEstablecimiento').txt(config.dirEstablecimiento || config.dirMatriz);
  infoNC.ele('tipoIdentificacionComprador').txt(tipoIdentificacionComprador);
  infoNC.ele('razonSocialComprador').txt(razonSocialComprador);
  infoNC.ele('identificacionComprador').txt(identificacionComprador);
  infoNC.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoNC.ele('codDocModificado').txt(TIPO_COMPROBANTE.FACTURA);
  infoNC.ele('numDocModificado').txt(numeroFacturaAfectada);
  infoNC.ele('fechaEmisionDocSustento').txt(fechaSustStr);
  infoNC.ele('totalSinImpuestos').txt(totalSinImpuestos.toFixed(2));

  const totImp = infoNC.ele('valorModificacion');
  totImp.txt(importeTotal.toFixed(2));
  infoNC.ele('moneda').txt('DOLAR');

  const totImpuestos = infoNC.ele('totalConImpuestos');
  subtotalesPorTasa.forEach((val, ivaPct) => {
    const ti = totImpuestos.ele('totalImpuesto');
    ti.ele('codigo').txt('2');
    ti.ele('codigoPorcentaje').txt(IVA_CODIGO[ivaPct] || '0');
    ti.ele('baseImponible').txt(parseFloat(val.sub.toFixed(2)).toFixed(2));
    ti.ele('valor').txt(parseFloat(val.iva.toFixed(2)).toFixed(2));
  });

  infoNC.ele('motivo').txt(motivoModificacion);

  const detallesEle = root.ele('detalles');
  detallesXML.forEach(det => {
    const detEle = detallesEle.ele('detalle');
    detEle.ele('codigoInterno').txt('SRV001');
    detEle.ele('descripcion').txt(det.descripcion);
    detEle.ele('cantidad').txt(det.cantidad.toFixed(2));
    detEle.ele('precioUnitario').txt(det.precio.toFixed(6));
    detEle.ele('descuento').txt('0.00');
    detEle.ele('precioTotalSinImpuesto').txt(det.sub.toFixed(2));
    const impEle = detEle.ele('impuestos').ele('impuesto');
    impEle.ele('codigo').txt('2');
    impEle.ele('codigoPorcentaje').txt(IVA_CODIGO[det.ivaPct] || '0');
    impEle.ele('tarifa').txt(String(det.ivaPct));
    impEle.ele('baseImponible').txt(det.sub.toFixed(2));
    impEle.ele('valor').txt(det.iva.toFixed(2));
  });

  return {
    xml: root.end({ prettyPrint: true }),
    totales: { totalSinImpuestos, totalIva, importeTotal },
  };
}

// ─── 2b. NOTA DE DÉBITO (tipo 05) ────────────────────────────────────────────

/**
 * Genera el XML de Nota de Débito según la ficha técnica SRI v1.0.0.
 *
 * @param {Object} data - Datos de la nota de débito
 * @param {Object} config - Configuración del emisor
 */
function generarXMLNotaDebito(data, config) {
  const {
    claveAcceso,
    secuencial,
    fechaEmision,
    tipoIdentificacionComprador,
    identificacionComprador,
    razonSocialComprador,
    numeroDocSustento,           // número del comprobante al que aplica el débito
    codDocSustento,              // código tipo comprobante sustento (01 = factura)
    fechaEmisionDocSustento,
    motivos = [],                // [{ razon, valor }]
  } = data;

  if (!motivos.length) throw new Error('La nota de débito debe tener al menos un motivo.');

  const d = new Date(fechaEmision);
  const fechaStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
  const dSust = new Date(fechaEmisionDocSustento);
  const fechaSustStr = `${String(dSust.getDate()).padStart(2,'0')}/${String(dSust.getMonth()+1).padStart(2,'0')}/${dSust.getFullYear()}`;

  // Calcular totales
  const totalSinImpuestos = parseFloat(
    motivos.reduce((acc, m) => acc + parseFloat(m.valor || 0), 0).toFixed(2)
  );
  const ivaRate = parseFloat(data.ivaPorcentaje || 15);
  const totalIva = parseFloat((totalSinImpuestos * (IVA_TARIFA[ivaRate] ?? 0)).toFixed(2));
  const valorTotal = parseFloat((totalSinImpuestos + totalIva).toFixed(2));

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('notaDebito', { id: 'comprobante', version: '1.0.0' });

  // infoTributaria
  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.NOTA_DEBITO);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.contribuyenteRimpe) {
    infoTrib.ele('contribuyenteRimpe').txt(config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE');
  }

  // infoNotaDebito
  const infoND = root.ele('infoNotaDebito');
  infoND.ele('fechaEmision').txt(fechaStr);
  infoND.ele('dirEstablecimiento').txt(config.dirEstablecimiento || config.dirMatriz);
  if (config.contribuyenteEspecial) infoND.ele('contribuyenteEspecial').txt(String(config.contribuyenteEspecial));
  infoND.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoND.ele('tipoIdentificacionComprador').txt(tipoIdentificacionComprador);
  infoND.ele('razonSocialComprador').txt(razonSocialComprador);
  infoND.ele('identificacionComprador').txt(identificacionComprador);
  infoND.ele('codDocModificado').txt(codDocSustento || TIPO_COMPROBANTE.FACTURA);
  infoND.ele('numDocModificado').txt(numeroDocSustento);
  infoND.ele('fechaEmisionDocSustento').txt(fechaSustStr);
  infoND.ele('totalSinImpuestos').txt(totalSinImpuestos.toFixed(2));

  // impuestos
  const impuestos = infoND.ele('impuestos');
  const imp = impuestos.ele('impuesto');
  imp.ele('codigo').txt('2');
  imp.ele('codigoPorcentaje').txt(IVA_CODIGO[ivaRate] || '4');
  imp.ele('tarifa').txt(String(ivaRate));
  imp.ele('baseImponible').txt(totalSinImpuestos.toFixed(2));
  imp.ele('valor').txt(totalIva.toFixed(2));

  infoND.ele('valorTotal').txt(valorTotal.toFixed(2));
  infoND.ele('moneda').txt('DOLAR');

  // pagos — obligatorio en nota de débito (SRI XSD)
  const pagosND = infoND.ele('pagos');
  const pagoND  = pagosND.ele('pago');
  pagoND.ele('formaPago').txt(resolverFormaPago(data.formaPago || 'Efectivo'));
  pagoND.ele('total').txt(valorTotal.toFixed(2));
  pagoND.ele('plazo').txt('0');
  pagoND.ele('unidadTiempo').txt('dias');

  // motivos
  const motivosEle = root.ele('motivos');
  motivos.forEach((m) => {
    const mEle = motivosEle.ele('motivo');
    mEle.ele('razon').txt(m.razon);
    mEle.ele('valor').txt(parseFloat(m.valor).toFixed(2));
  });

  return {
    xml: root.end({ prettyPrint: true }),
    totales: { totalSinImpuestos, totalIva, valorTotal },
  };
}

// ─── 3. FIRMA DIGITAL XAdES-BES ──────────────────────────────────────────────

/**
 * Firma un XML con XAdES-BES usando un certificado P12.
 * Usa C14N inclusivo (xml-crypto) para canonicalizar antes de hashear/firmar,
 * igual que hace el verificador del SRI.
 * @param {string} xmlString - XML sin firma
 * @param {Buffer} p12Buffer - Buffer del archivo .p12
 * @param {string} claveP12  - Contraseña del .p12
 * @returns {string} XML firmado
 */
function firmarXML(xmlString, p12Buffer, claveP12) {
  const { C14nCanonicalization } = require('xml-crypto');
  const { DOMParser }            = require('@xmldom/xmldom');
  const nativeCrypto             = require('crypto');

  // ── 1. Parsear P12 y emparejar clave privada con certificado ──────────────
  const p12Der  = p12Buffer.toString('binary');
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12     = forge.pkcs12.pkcs12FromAsn1(p12Asn1, claveP12);

  const privateKeys = [];
  const certs       = [];
  for (const sc of p12.safeContents) {
    for (const sb of sc.safeBags) {
      if ((sb.type === forge.pki.oids.pkcs8ShroudedKeyBag || sb.type === forge.pki.oids.keyBag) && sb.key) {
        privateKeys.push(sb.key);
      } else if (sb.type === forge.pki.oids.certBag && sb.cert) {
        certs.push(sb.cert);
      }
    }
  }
  if (!privateKeys.length) throw new Error('No se encontró clave privada en el P12');
  if (!certs.length)       throw new Error('No se encontró certificado en el P12');

  // Emparejar clave con cert usando el módulo RSA (n).
  // Si hay múltiples coincidencias (BCE emite pares cifrado+firma), preferir el cert
  // con KeyUsage.digitalSignature=true (el cert de firma, no el de cifrado/autenticación).
  let privateKey  = null;
  let certificate = null;
  const matches = [];
  for (const key of privateKeys) {
    for (const cert of certs) {
      if (cert.publicKey && cert.publicKey.n && key.n && cert.publicKey.n.equals(key.n)) {
        matches.push({ key, cert });
      }
    }
  }
  if (matches.length > 0) {
    // Preferir cert con digitalSignature=true en KeyUsage
    const sigMatch = matches.find(m => {
      const ku = m.cert.getExtension('keyUsage');
      return ku && ku.digitalSignature === true;
    });
    const chosen  = sigMatch || matches[0];
    privateKey    = chosen.key;
    certificate   = chosen.cert;
  }
  // Fallback: usar el primer end-entity cert (no CA) y primera clave
  if (!privateKey) {
    privateKey  = privateKeys[0];
    certificate = certs.find(c => !c.getExtension('basicConstraints')?.cA) || certs[0];
  }

  // Validar vigencia antes de firmar
  const now = new Date();
  if (now < certificate.validity.notBefore || now > certificate.validity.notAfter) {
    const expired = now > certificate.validity.notAfter;
    throw new Error(
      `Certificado digital ${expired ? 'VENCIDO' : 'aún no válido'}: ` +
      `válido desde ${certificate.validity.notBefore.toISOString().slice(0, 10)} ` +
      `hasta ${certificate.validity.notAfter.toISOString().slice(0, 10)}`
    );
  }
  const certCN = certificate.subject.getField('CN');
  console.log(`[SRI] Firmando: CN="${certCN?.value || '?'}", serial=${certificate.serialNumber}, válido hasta ${certificate.validity.notAfter.toISOString().slice(0, 10)}`);

  // ── 2. Datos del certificado de firma ─────────────────────────────────────
  const certDer    = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const certB64    = forge.util.encode64(certDer);
  const certDigest = nativeCrypto.createHash('sha1')
    .update(Buffer.from(certDer, 'binary')).digest('base64');

  // Serial en decimal (el P12 del BCE almacena el serial en hex)
  const serialDecimal = BigInt('0x' + certificate.serialNumber.replace(/\s/g, '')).toString(10);

  // Issuer en RFC 2253: orden inverso del cert, todos los atributos incluidos.
  // OIDs sin shortName conocido usan notación "OID.x.x.x".
  // Los valores se escapan según RFC 2253 (comas, barras, comillas, etc.).
  const escRfc2253 = (v) => String(v)
    .replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/\+/g, '\\+')
    .replace(/"/g, '\\"').replace(/</g, '\\<').replace(/>/g, '\\>')
    .replace(/;/g, '\\;').replace(/^([ #])/, '\\$1').replace(/ $/, '\\ ');
  const issuerName = [...certificate.issuer.attributes]
    .reverse()
    .map(a => `${a.shortName || `OID.${a.type}`}=${escRfc2253(a.value)}`)
    .join(',');

  // ── 3. IDs y timestamp ────────────────────────────────────────────────────
  const ts          = Date.now();
  const signatureId = `Signature${ts}`;
  const sigPropsId  = `SignedProperties${ts}`;
  const refKI       = `Certificate${ts}`;
  const refDocId    = `Reference-ID-${ts}`;
  const signingTime = new Date().toISOString();

  const NS_DS   = 'http://www.w3.org/2000/09/xmldsig#';
  const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#';

  const sha1b64 = (data, enc) => nativeCrypto.createHash('sha1').update(data, enc || 'utf8').digest('base64');

  const c14n      = new C14nCanonicalization();
  const domParser = new DOMParser();

  // ── 4. Digest del elemento raíz (#comprobante) ───────────────────────────
  // Aplicamos la transform enveloped-signature (el XML original aún no tiene <ds:Signature>)
  // seguida de C14N — equivalente a canonicalizar antes de insertar la firma.
  const docParsed = domParser.parseFromString(xmlString);
  const canonDoc  = c14n.process(docParsed.documentElement, {});
  const digestDoc = sha1b64(canonDoc, 'utf8');

  // ── 5a. Digest del <ds:KeyInfo> (referencia #Certificate) ────────────────
  // <ds:Signature> solo declara xmlns:ds; xmlns:xades está en <xades:QualifyingProperties>.
  // Por tanto <ds:KeyInfo> no hereda xmlns:xades → canonical form sin xmlns:xades.
  const keyInfoInner = `<ds:X509Data><ds:X509Certificate>${certB64}</ds:X509Certificate></ds:X509Data>`;
  const tempKIDoc    = domParser.parseFromString(
    `<ds:Signature xmlns:ds="${NS_DS}">` +
    `<ds:KeyInfo Id="${refKI}">${keyInfoInner}</ds:KeyInfo></ds:Signature>`
  );
  const kiNode    = tempKIDoc.getElementsByTagNameNS(NS_DS, 'KeyInfo')[0];
  const canonKI   = c14n.process(kiNode, {});
  const digestKI  = sha1b64(canonKI, 'utf8');

  // ── 5b. SignedProperties ─────────────────────────────────────────────────
  // Incluye SignedDataObjectProperties → DataObjectFormat según ficha técnica SRI.
  const signedPropsInner = [
    `<xades:SignedSignatureProperties>`,
      `<xades:SigningTime>${signingTime}</xades:SigningTime>`,
      `<xades:SigningCertificate>`,
        `<xades:Cert>`,
          `<xades:CertDigest>`,
            `<ds:DigestMethod Algorithm="${NS_DS}sha1"/>`,
            `<ds:DigestValue>${certDigest}</ds:DigestValue>`,
          `</xades:CertDigest>`,
          `<xades:IssuerSerial>`,
            `<ds:X509IssuerName>${issuerName}</ds:X509IssuerName>`,
            `<ds:X509SerialNumber>${serialDecimal}</ds:X509SerialNumber>`,
          `</xades:IssuerSerial>`,
        `</xades:Cert>`,
      `</xades:SigningCertificate>`,
    `</xades:SignedSignatureProperties>`,
    `<xades:SignedDataObjectProperties>`,
      `<xades:DataObjectFormat ObjectReference="#${refDocId}">`,
        `<xades:Description>contenido comprobante</xades:Description>`,
        `<xades:MimeType>text/xml</xades:MimeType>`,
      `</xades:DataObjectFormat>`,
    `</xades:SignedDataObjectProperties>`,
  ].join('');

  // Canonicalizar <xades:SignedProperties> en el contexto que tendrá en el doc final:
  // hereda xmlns:ds del ancestro <ds:Signature xmlns:ds="...">.
  const tempPropsDoc = domParser.parseFromString(
    `<ds:Signature xmlns:ds="${NS_DS}" xmlns:xades="${NS_XADES}">` +
    `<ds:Object><xades:QualifyingProperties Target="#tmp">` +
    `<xades:SignedProperties Id="${sigPropsId}">${signedPropsInner}</xades:SignedProperties>` +
    `</xades:QualifyingProperties></ds:Object></ds:Signature>`
  );
  const spNode     = tempPropsDoc.getElementsByTagNameNS(NS_XADES, 'SignedProperties')[0];
  const canonProps = c14n.process(spNode, {
    ancestorNamespaces: [{ prefix: 'ds', namespaceURI: NS_DS }],
  });
  const digestProps = sha1b64(canonProps, 'utf8');

  const signedPropsXml = `<xades:SignedProperties Id="${sigPropsId}">${signedPropsInner}</xades:SignedProperties>`;

  // ── 6. SignedInfo con 3 referencias (orden ficha técnica SRI) ─────────────
  // 1. #SignedProperties, 2. #Certificate (KeyInfo), 3. #comprobante
  const signedInfoInner = [
    `<ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>`,
    `<ds:SignatureMethod Algorithm="${NS_DS}rsa-sha1"/>`,
    `<ds:Reference Id="SignedPropertiesID${ts}" Type="http://uri.etsi.org/01903#SignedProperties" URI="#${sigPropsId}">`,
      `<ds:DigestMethod Algorithm="${NS_DS}sha1"/>`,
      `<ds:DigestValue>${digestProps}</ds:DigestValue>`,
    `</ds:Reference>`,
    `<ds:Reference URI="#${refKI}">`,
      `<ds:DigestMethod Algorithm="${NS_DS}sha1"/>`,
      `<ds:DigestValue>${digestKI}</ds:DigestValue>`,
    `</ds:Reference>`,
    `<ds:Reference Id="${refDocId}" URI="#comprobante">`,
      `<ds:Transforms>`,
        `<ds:Transform Algorithm="${NS_DS}enveloped-signature"/>`,
      `</ds:Transforms>`,
      `<ds:DigestMethod Algorithm="${NS_DS}sha1"/>`,
      `<ds:DigestValue>${digestDoc}</ds:DigestValue>`,
    `</ds:Reference>`,
  ].join('');

  // Canonicalizar <ds:SignedInfo>:
  // Si xmlns:xades está solo en <xades:QualifyingProperties> (no en <ds:Signature>),
  // entonces <ds:SignedInfo> NO hereda xmlns:xades → canonical form sin xmlns:xades.
  const tempSIDoc = domParser.parseFromString(
    `<ds:Signature xmlns:ds="${NS_DS}">` +
    `<ds:SignedInfo>${signedInfoInner}</ds:SignedInfo></ds:Signature>`
  );
  const siNode  = tempSIDoc.getElementsByTagNameNS(NS_DS, 'SignedInfo')[0];
  const canonSI = c14n.process(siNode, {});

  // Firmar el canonical SignedInfo con RSA-SHA1 usando Node.js crypto nativo
  const privKeyPem = forge.pki.privateKeyToPem(privateKey);
  const nativeSign = nativeCrypto.createSign('SHA1');
  nativeSign.update(canonSI, 'utf8');
  const sigB64 = nativeSign.sign(privKeyPem, 'base64');

  const signedInfoXml = `<ds:SignedInfo>${signedInfoInner}</ds:SignedInfo>`;

  // ── 7. Bloque <ds:Signature> completo ─────────────────────────────────────
  // xmlns:xades se declara solo en <xades:QualifyingProperties>, no en <ds:Signature>,
  // para que <ds:SignedInfo> no herede xmlns:xades y el canonical form sea más simple.
  const signatureBlock = [
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${signatureId}">`,
      signedInfoXml,
      `<ds:SignatureValue Id="SignatureValue${ts}">${sigB64}</ds:SignatureValue>`,
      `<ds:KeyInfo Id="${refKI}">`,
        keyInfoInner,
      `</ds:KeyInfo>`,
      `<ds:Object Id="etsi-object">`,
        `<xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#${signatureId}">`,
          signedPropsXml,
        `</xades:QualifyingProperties>`,
      `</ds:Object>`,
    `</ds:Signature>`,
  ].join('');

  // ── 8. Insertar firma antes del cierre del elemento raíz ──────────────────
  const xmlFirmado = xmlString
    .replace(/<\/factura>\s*$/, `${signatureBlock}</factura>`)
    .replace(/<\/notaCredito>\s*$/, `${signatureBlock}</notaCredito>`)
    .replace(/<\/notaDebito>\s*$/, `${signatureBlock}</notaDebito>`)
    .replace(/<\/comprobanteRetencion>\s*$/, `${signatureBlock}</comprobanteRetencion>`)
    .replace(/<\/liquidacionCompra>\s*$/, `${signatureBlock}</liquidacionCompra>`)
    .replace(/<\/guiaRemision>\s*$/, `${signatureBlock}</guiaRemision>`);

  return xmlFirmado;
}

// ─── 4. SOAP CON SRI ─────────────────────────────────────────────────────────

/**
 * Hace una petición SOAP al SRI.
 * @param {string} url      - URL del servicio SOAP
 * @param {string} soapBody - Cuerpo de la acción SOAP
 * @param {string} action   - SOAPAction header
 * @returns {Promise<string>} respuesta XML del SRI
 */
function soapRequest(url, soapBody, action, namespace) {
  const ns = namespace || 'http://ec.gob.sri.ws.recepcion';
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="${ns}">
  <soapenv:Header/>
  <soapenv:Body>
    ${soapBody}
  </soapenv:Body>
</soapenv:Envelope>`;

  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path:     parsedUrl.pathname + (parsedUrl.search || ''),
      method:   'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'SOAPAction':     action || '',
        'Content-Length': Buffer.byteLength(envelope, 'utf8'),
      },
      timeout: 30000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`Servicio SRI no disponible (HTTP ${res.statusCode})`));
          return;
        }
        resolve(data);
      });
    });

    req.on('error', (err) => {
      // Preservar el código original (ECONNRESET, ETIMEDOUT, etc.) para que
      // esErrorConectividad pueda clasificarlo correctamente como reintentable.
      const wrapped = new Error(`Error de red al contactar el SRI: ${err.message}`);
      wrapped.code = err.code;
      reject(wrapped);
    });
    req.on('timeout', () => {
      req.destroy();
      const tout = new Error('El servicio SRI no respondió a tiempo (timeout 30s)');
      tout.code = 'ETIMEDOUT';
      reject(tout);
    });
    req.write(envelope);
    req.end();
  });
}

/**
 * Envía un comprobante firmado al SRI (RecepcionComprobantesOffline)
 * @param {string} xmlFirmado - XML firmado en base64 (SRI lo espera en base64)
 * @param {number} ambiente   - 1=pruebas, 2=produccion
 * @returns {Promise<{estado: string, comprobantes: Array}>}
 */
async function enviarComprobanteSRI(xmlFirmado, ambiente) {
  const url      = SRI_URLS[ambiente].recepcion;
  const xmlB64   = Buffer.from(xmlFirmado, 'utf8').toString('base64');
  const soapBody = `<ec:validarComprobante>
    <xml>${xmlB64}</xml>
  </ec:validarComprobante>`;

  const respXml = await soapRequest(url, soapBody, '');

  // Parsear respuesta básica (buscamos estado y mensajes)
  const estadoMatch = respXml.match(/<estado>([^<]+)<\/estado>/i);
  const estado      = estadoMatch ? estadoMatch[1] : 'DESCONOCIDO';

  // El SRI devuelve errores estructurados: <identificador>, <mensaje> (texto), <tipo>, <informacionAdicional>
  const mensajes = [];
  const ids   = [...respXml.matchAll(/<identificador>([^<]+)<\/identificador>/gi)].map(m => m[1].trim());
  const txts  = [...respXml.matchAll(/<mensaje>([^<]+)<\/mensaje>/gi)].map(m => m[1].trim());
  const tipos = [...respXml.matchAll(/<tipo>([^<]+)<\/tipo>/gi)].map(m => m[1].trim());
  const infos = [...respXml.matchAll(/<informacionAdicional>([^<]*)<\/informacionAdicional>/gi)].map(m => m[1].trim());

  if (ids.length > 0) {
    ids.forEach((id, i) => mensajes.push({
      identificador:        id,
      mensaje:              txts[i]  || '',
      tipo:                 tipos[i] || null,
      informacionAdicional: infos[i] || null,
    }));
  } else {
    txts.forEach((t, i) => mensajes.push({
      identificador:        null,
      mensaje:              t,
      tipo:                 tipos[i] || null,
      informacionAdicional: null,
    }));
  }

  if (mensajes.length) {
    console.log(`[SRI] Recepción ${estado}:`, JSON.stringify(mensajes));
  }

  return { estado, mensajes, rawXml: respXml };
}

/**
 * Consulta la autorización de un comprobante (AutorizacionComprobantesOffline)
 * @param {string} claveAcceso - Clave de acceso de 49 dígitos
 * @param {number} ambiente    - 1=pruebas, 2=produccion
 * @returns {Promise<{autorizado: boolean, numeroAutorizacion: string, xml: string, mensajes: Array}>}
 */
async function autorizarComprobanteSRI(claveAcceso, ambiente) {
  const url      = SRI_URLS[ambiente].autorizacion;
  const soapBody = `<ec:autorizacionComprobante>
    <claveAccesoComprobante>${claveAcceso}</claveAccesoComprobante>
  </ec:autorizacionComprobante>`;

  const respXml = await soapRequest(url, soapBody, '', 'http://ec.gob.sri.ws.autorizacion');

  const estadoMatch    = respXml.match(/<estado>([^<]+)<\/estado>/i);
  const numAutMatch    = respXml.match(/<numeroAutorizacion>([^<]+)<\/numeroAutorizacion>/i);
  const fechaAutMatch  = respXml.match(/<fechaAutorizacion>([^<]+)<\/fechaAutorizacion>/i);

  const estado           = estadoMatch   ? estadoMatch[1]   : 'NO_AUTORIZADO';
  const numeroAutorizacion = numAutMatch ? numAutMatch[1]   : null;
  const fechaAutorizacion  = fechaAutMatch ? new Date(fechaAutMatch[1]) : null;

  const mensajes = [];
  const authIds   = [...respXml.matchAll(/<identificador>([^<]+)<\/identificador>/gi)].map(m => m[1].trim());
  const authTxts  = [...respXml.matchAll(/<mensaje>([^<]+)<\/mensaje>/gi)].map(m => m[1].trim());
  const authTipos = [...respXml.matchAll(/<tipo>([^<]+)<\/tipo>/gi)].map(m => m[1].trim());
  const authInfos = [...respXml.matchAll(/<informacionAdicional>([^<]*)<\/informacionAdicional>/gi)].map(m => m[1].trim());

  if (authIds.length > 0) {
    authIds.forEach((id, i) => mensajes.push({
      identificador:        id,
      mensaje:              authTxts[i]  || '',
      tipo:                 authTipos[i] || null,
      informacionAdicional: authInfos[i] || null,
    }));
  } else {
    authTxts.forEach((t, i) => mensajes.push({
      identificador:        null,
      mensaje:              t,
      tipo:                 authTipos[i] || null,
      informacionAdicional: null,
    }));
  }

  // El XML autorizado viene embebido en la respuesta dentro de CDATA
  // Toleramos: espacios alrededor de CDATA, prefijos de namespace (ns2:comprobante), etc.
  const xmlAutMatchCdata = respXml.match(
    /<(?:[\w]*:)?comprobante[^>]*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/(?:[\w]*:)?comprobante>/i
  );
  let xmlAutorizado = xmlAutMatchCdata ? xmlAutMatchCdata[1].trim() : null;

  // Fallback: el SRI a veces entrega el XML con entidades HTML en vez de CDATA
  if (!xmlAutorizado) {
    const xmlEncMatch = respXml.match(
      /<(?:[\w]*:)?comprobante[^>]*>((?:&lt;|<\?xml)[\s\S]*?)<\/(?:[\w]*:)?comprobante>/i
    );
    if (xmlEncMatch) {
      const decoded = xmlEncMatch[1]
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
      if (decoded.startsWith('<')) xmlAutorizado = decoded;
    }
  }

  return {
    autorizado:       estado === 'AUTORIZADO',
    estado,
    numeroAutorizacion,
    fechaAutorizacion,
    xmlAutorizado,
    mensajes,
    rawXml: respXml,
  };
}

// ─── 5. RIDE (PDF de la factura) ─────────────────────────────────────────────

/**
 * Genera el RIDE A4 (Representación Impresa del Documento Electrónico).
 * Layout idéntico al estándar SRI Ecuador (referencia CorpSimtelec/JBG):
 *   - Cabecera: panel izquierdo (logo + emisor) | panel derecho con QR + clave dentro del recuadro
 *   - Sección comprador (3 filas: razón social / identificación+fecha / dirección)
 *   - Tabla de detalles (10 columnas SRI)
 *   - Footer: información adicional + forma de pago (izq) | caja totales SRI completa (der)
 */
async function generarRIDEFactura(factura, configSri, outputPath) {
  // Generar código de barras Code128 con la clave de acceso (estándar SRI Ecuador)
  const claveAcceso = factura.claveAcceso || '0'.repeat(49);
  let barcodeBuffer = null;
  try {
    barcodeBuffer = await bwipjs.toBuffer({
      bcid:            'code128',
      text:            claveAcceso,
      scale:           2,
      height:          10,        // mm de altura
      includetext:     false,
      backgroundcolor: 'FFFFFF',
    });
  } catch(e) { /* Si falla, se omite el barcode */ }

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 20, left: 28, right: 28 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML    = 28;
    const PW    = doc.page.width;   // 595.28
    const PH    = doc.page.height;  // 841.89
    const W     = PW - ML * 2;     // ~539

    const AZUL   = '#1B3A6B';
    const GRIS   = '#555555';
    const NEGRO  = '#000000';
    const BLANCO = '#FFFFFF';
    const BG_ALT = '#F5F8FC';

    const config   = configSri || {};
    const detalles = typeof factura.detalles === 'string' ? JSON.parse(factura.detalles) : (factura.detalles || []);
    const pagos    = typeof factura.pagos    === 'string' ? JSON.parse(factura.pagos)    : (factura.pagos    || []);

    const { logoData, tienelogo } = _resolverLogo(config.logoUrl);

    // ── HEADER ────────────────────────────────────────────────────────────────
    // Panel izquierdo (~44%): logo grande + datos emisor
    // Panel derecho (~56%): sin recuadro exterior, texto + sección clave con barcode
    let y = 20;

    const LP    = Math.floor(W * 0.44);  // ~237
    const GAP   = 8;
    const RP_X  = ML + LP + GAP;
    const RP_W  = W - LP - GAP;         // ~294

    // ── Panel izquierdo ──
    let yL = y;

    if (tienelogo) {
      try {
        doc.image(logoData, ML, yL, { fit: [LP - 4, 65] });
        yL += 70;
      } catch(e) { /* logo corrupto → omitir */ }
    }

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NEGRO)
       .text((config.razonSocial || '').toUpperCase(), ML, yL, { width: LP - 4, lineBreak: false });
    yL += 13;

    if (config.nombreComercial) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
         .text(config.nombreComercial, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 11;
    }

    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Dir. Matriz: ${config.dirMatriz || ''}`, ML, yL, { width: LP - 4 });
    yL = doc.y + 2;

    if (config.dirEstablecimiento) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Dir. Sucursal: ${config.dirEstablecimiento}`, ML, yL, { width: LP - 4 });
      yL = doc.y + 2;
    }

    if (config.contribuyenteEspecial) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Contrib. Especial Nro: ${config.contribuyenteEspecial}`, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 10;
    }

    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Obligado a llevar contabilidad: ${config.obligadoContabilidad ? 'SI' : 'NO'}`, ML, yL, { width: LP - 4, lineBreak: false });
    yL += 10;

    if (config.contribuyenteRimpe) {
      const rimpeLabel = config.negocioPopular
        ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
        : 'CONTRIBUYENTE RÉGIMEN RIMPE';
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(AZUL)
         .text(rimpeLabel, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 10;
    }

    // ── Panel derecho (sin recuadro exterior) ──
    let yR = y;

    // RUC
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
       .text('R.U.C.:', RP_X, yR, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ruc || ''}`, RP_X + 32, yR, { lineBreak: false });
    yR += 13;

    // FACTURA (título grande centrado)
    doc.fontSize(14).font('Helvetica-Bold').fillColor(NEGRO)
       .text('FACTURA', RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 20;

    // Número de factura
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text(`No. ${factura.numeroFactura || ''}`, RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 14;

    // Separador
    doc.moveTo(RP_X, yR).lineTo(RP_X + RP_W, yR).lineWidth(0.4).stroke('#CCCCCC');
    yR += 5;

    // Número de autorización
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('NÚMERO DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(factura.numeroAutorizacion || 'PENDIENTE DE AUTORIZACIÓN', RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    // Fecha de autorización
    const fAut = factura.fechaAutorizacion
      ? new Date(factura.fechaAutorizacion).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })
      : '---';
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA Y HORA DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(fAut, RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    // Ambiente | Emisión
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('AMBIENTE:', RP_X, yR, { lineBreak: false });
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ambiente === 2 ? 'PRODUCCIÓN' : 'PRUEBAS'}`, RP_X + 38, yR, { lineBreak: false });
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('  EMISIÓN:', RP_X + 130, yR, { lineBreak: false });
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text('  NORMAL', RP_X + 170, yR, { lineBreak: false });
    yR += 12;

    // Sección CLAVE DE ACCESO (recuadro con barcode Code128 a ancho completo)
    const BC_PAD     = 4;
    const BC_LABEL_H = 11;
    const BC_H       = 32;   // altura del barcode en pt
    const BC_NUM_H   = 11;   // número de 49 dígitos
    const BC_BOX_H   = BC_PAD + BC_LABEL_H + BC_PAD + BC_H + BC_NUM_H + BC_PAD;

    doc.rect(RP_X, yR, RP_W, BC_BOX_H).lineWidth(0.7).stroke('#888888');

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('CLAVE DE ACCESO / N° DE AUTORIZACIÓN', RP_X, yR + BC_PAD, { width: RP_W, align: 'center', lineBreak: false });

    const bcY = yR + BC_PAD + BC_LABEL_H + BC_PAD;

    if (barcodeBuffer) {
      doc.image(barcodeBuffer, RP_X + 2, bcY, { width: RP_W - 4, height: BC_H });
    }

    doc.fontSize(5.5).font('Helvetica').fillColor(GRIS)
       .text(claveAcceso, RP_X + 2, bcY + BC_H + 2, { width: RP_W - 4, align: 'center', lineBreak: false });

    yR += BC_BOX_H + 4;

    // y final de la cabecera
    y = Math.max(yL, yR) + 6;

    // ── DATOS DEL COMPRADOR ──────────────────────────────────────────────────
    // 2 filas: (1) Razón Social full-width, (2) Identificación | Fecha
    const COMP_H  = 40;
    doc.rect(ML, y, W, COMP_H).lineWidth(0.5).stroke('#AAAAAA');

    doc.moveTo(ML, y + 20).lineTo(ML + W, y + 20).lineWidth(0.3).stroke('#CCCCCC');

    const COL_ID_W = W * 0.55;
    doc.moveTo(ML + COL_ID_W, y + 20).lineTo(ML + COL_ID_W, y + COMP_H).lineWidth(0.3).stroke('#CCCCCC');

    // Fila 1: Razón Social
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RAZÓN SOCIAL / NOMBRES Y APELLIDOS:', ML + 3, y + 3, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(NEGRO)
       .text(factura.razonSocialComprador || '', ML + 3, y + 12, { width: W - 6, lineBreak: false });

    // Fila 2: Identificación | Fecha
    const fEm = factura.fechaEmision
      ? new Date(factura.fechaEmision).toLocaleDateString('es-EC')
      : '';

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RUC / IDENTIFICACIÓN:', ML + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(factura.identificacionComprador || '', ML + 3, y + 32, { width: COL_ID_W - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA DE EMISIÓN:', ML + COL_ID_W + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(fEm, ML + COL_ID_W + 3, y + 32, { width: W * 0.45 - 6, lineBreak: false });

    y += COMP_H + 4;

    // ── TABLA DE DETALLES (7 columnas SRI estándar) ─────────────────────────
    // Cod.Principal | Cantidad | Descripción | P.Unitario | Descuento | % IVA | Precio Total
    const COLS = [
      { h: 'Cod.\nPrincipal',  w: 48,  al: 'left'  },
      { h: 'Cantidad',          w: 38,  al: 'right' },
      { h: 'Descripción',       w: 0,   al: 'left'  },  // flex
      { h: 'Precio\nUnitario',  w: 52,  al: 'right' },
      { h: 'Descuento',         w: 42,  al: 'right' },
      { h: '% IVA',             w: 28,  al: 'right' },
      { h: 'Precio\nTotal',     w: 54,  al: 'right' },
    ];
    const fixedW = COLS.filter(c => c.w > 0).reduce((s, c) => s + c.w, 0);
    COLS.find(c => c.w === 0).w = W - fixedW;  // Descripción: ~277

    const TH_H = 22;
    doc.rect(ML, y, W, TH_H).fill(AZUL);
    let cx = ML;
    COLS.forEach(col => {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(BLANCO)
         .text(col.h, cx + 2, y + 3, { width: col.w - 4, align: col.al });
      cx += col.w;
    });
    y += TH_H;

    detalles.forEach((det, idx) => {
      const cant   = parseFloat(det.cantidad)       || 0;
      const prec   = parseFloat(det.precioUnitario)  || 0;
      const desc   = parseFloat(det.descuento)      || 0;
      const ivaPct = parseInt(det.ivaPorcentaje)    || 0;
      const tot    = (cant * prec - desc);
      const ROW_H  = 13;

      if (y > PH - 160) { doc.addPage(); y = 30; }

      doc.rect(ML, y, W, ROW_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(ML, y, W, ROW_H).lineWidth(0.2).stroke('#DDDDDD');

      const vals = [
        { v: det.codigoPrincipal || '', al: 'left'  },
        { v: cant.toFixed(2),           al: 'right' },
        { v: det.descripcion    || '', al: 'left'  },
        { v: prec.toFixed(2),           al: 'right' },
        { v: desc.toFixed(2),           al: 'right' },
        { v: `${ivaPct}%`,              al: 'right' },
        { v: tot.toFixed(2),            al: 'right' },
      ];
      cx = ML;
      vals.forEach((v, vi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(v.v, cx + 2, y + 3, { width: COLS[vi].w - 4, align: v.al, lineBreak: false });
        cx += COLS[vi].w;
      });
      y += ROW_H;
    });

    // ── FOOTER ──────────────────────────────────────────────────────────────
    y += 6;

    const FP_W  = Math.floor(W * 0.52);
    const TOT_X = ML + FP_W + 4;
    const TOT_W = W - FP_W - 4;

    let yLeft = y;

    // ── Información Adicional ─────────────────────────────────────────────────
    // Datos del comprador (correo, teléfono, dirección) + vendedor + observaciones
    const camposIA = [];
    if (factura.emailComprador)     camposIA.push({ n: 'Correo',      v: factura.emailComprador });
    if (factura.telefonoComprador)  camposIA.push({ n: 'Teléfono',    v: factura.telefonoComprador });
    if (factura.direccionComprador) camposIA.push({ n: 'Dirección',   v: factura.direccionComprador });
    if (factura.vendedor)           camposIA.push({ n: 'Vendedor',    v: factura.vendedor });
    if (factura.observaciones)      camposIA.push({ n: 'Observación', v: factura.observaciones });

    if (camposIA.length > 0) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(AZUL)
         .text('INFORMACIÓN ADICIONAL', ML, yLeft, { lineBreak: false });
      yLeft += 11;

      // Cabecera de la tabla
      const IA_H    = 12;
      const LABEL_W = FP_W * 0.30;
      const VAL_W   = FP_W - LABEL_W;

      doc.rect(ML, yLeft, FP_W, IA_H).fill(AZUL);
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Campo', ML + 3, yLeft + 3, { width: LABEL_W - 6, lineBreak: false });
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Valor', ML + LABEL_W + 3, yLeft + 3, { width: VAL_W - 6, lineBreak: false });
      yLeft += IA_H;

      camposIA.forEach((campo, idx) => {
        doc.rect(ML, yLeft, FP_W, IA_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
        doc.rect(ML, yLeft, FP_W, IA_H).lineWidth(0.2).stroke('#DDDDDD');
        doc.rect(ML + LABEL_W, yLeft, 0, IA_H).lineWidth(0.2).stroke('#DDDDDD');
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRIS)
           .text(campo.n, ML + 3, yLeft + 2, { width: LABEL_W - 6, lineBreak: false });
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(campo.v, ML + LABEL_W + 3, yLeft + 2, { width: VAL_W - 6, lineBreak: false });
        yLeft += IA_H;
      });
      yLeft += 4;
    }

    // Forma de pago
    doc.fontSize(7).font('Helvetica-Bold').fillColor(AZUL)
       .text('Forma de pago', ML, yLeft, { lineBreak: false });
    yLeft += 11;

    const PG_H  = 13;
    const PG_WS = [FP_W * 0.65, FP_W * 0.35];

    doc.rect(ML, yLeft, FP_W, PG_H).fill(AZUL);
    let px = ML;
    ['Forma de pago', 'Valor'].forEach((lbl, i) => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(BLANCO)
         .text(lbl, px + 3, yLeft + 3, { width: PG_WS[i] - 6, align: i === 0 ? 'left' : 'right', lineBreak: false });
      px += PG_WS[i];
    });
    yLeft += PG_H;

    const formaPagoDesc = {
      '01': '01 - EFECTIVO', '02': '02 - CHEQUE PROPIO', '03': '03 - DÉBITO BANCARIO',
      '15': '15 - COMPENSACIÓN DE DEUDAS', '16': '16 - TARJETA DE CRÉDITO',
      '17': '17 - TARJETA DE DÉBITO', '18': '18 - DINERO ELECTRÓNICO',
      '19': '19 - TARJETA PREPAGO', '20': '20 - OTROS CON UTILIZACION DEL SISTEMA FINANCIERO',
      '21': '21 - ENDOSO DE TÍTULOS',
    };

    pagos.forEach((p, idx) => {
      doc.rect(ML, yLeft, FP_W, PG_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(ML, yLeft, FP_W, PG_H).lineWidth(0.2).stroke('#DDDDDD');
      const fpLabel = formaPagoDesc[p.formaPago] || p.formaPago || 'Efectivo';
      px = ML;
      [fpLabel, `$${parseFloat(p.total).toFixed(2)}`].forEach((pv, i) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(pv, px + 3, yLeft + 3, { width: PG_WS[i] - 6, align: i === 0 ? 'left' : 'right', lineBreak: false });
        px += PG_WS[i];
      });
      yLeft += PG_H;
    });

    // ── Caja de totales SRI ───────────────────────────────────────────────────
    const st15    = parseFloat(factura.subtotal15 || 0);
    const st0     = parseFloat(factura.subtotal0  || 0);
    const stNoIva = parseFloat(factura.subtotalNoObjetoIva || 0);
    const totDesc = parseFloat(factura.totalDescuento || 0);
    const iva15   = parseFloat(factura.totalIva || 0);
    const propina = parseFloat(factura.propina  || 0);
    const total   = parseFloat(factura.importeTotal || 0);

    const TOT_ROWS = [
      { l: 'SUBTOTAL IVA 15%',          v: st15                   },
      { l: 'SUBTOTAL 0%',               v: st0                    },
      { l: 'SUBTOTAL NO OBJETO DE IVA', v: stNoIva                },
      { l: 'SUBTOTAL EXENTO DE IVA',    v: 0                      },
      { l: 'SUBTOTAL SIN IMPUESTOS',    v: st0 + st15 + stNoIva   },
      { l: 'TOTAL DESCUENTO',           v: totDesc                },
      { l: 'ICE',                       v: 0                      },
      { l: 'IVA 15%',                   v: iva15                  },
      { l: 'PROPINA',                   v: propina                },
      { l: 'VALOR TOTAL',               v: total, bold: true      },
    ];

    const TR_H = 13;
    const TOT_BOX_H = TOT_ROWS.length * TR_H + 4;
    doc.rect(TOT_X, y, TOT_W, TOT_BOX_H).lineWidth(0.5).stroke('#AAAAAA');

    let yT = y + 2;
    TOT_ROWS.forEach((row, ri) => {
      if (ri > 0) {
        doc.moveTo(TOT_X, yT).lineTo(TOT_X + TOT_W, yT).lineWidth(0.2).stroke('#DDDDDD');
      }
      const fn = row.bold ? 'Helvetica-Bold' : 'Helvetica';
      const fc = row.bold ? AZUL : NEGRO;
      const bg = row.bold ? '#EEF3FB' : (ri % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(TOT_X, yT, TOT_W, TR_H).fill(bg);
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(row.l, TOT_X + 3, yT + 3, { width: TOT_W * 0.65 - 3, align: 'left', lineBreak: false });
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(`$${row.v.toFixed(2)}`, TOT_X + TOT_W * 0.65, yT + 3, { width: TOT_W * 0.35 - 3, align: 'right', lineBreak: false });
      yT += TR_H;
    });

    // ── PIE DE PÁGINA ──────────────────────────────────────────────────────
    const bottomY = Math.max(yLeft, yT) + 10;
    doc.fontSize(6).font('Helvetica').fillColor('#888888')
       .text(
         'Este documento es una Representación Impresa de un Comprobante Electrónico — SRI Ecuador',
         ML, bottomY, { width: W, align: 'center' }
       );

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Genera el RIDE de una Nota de Crédito.
 */
async function generarRIDENotaCredito(nc, configSri, outputPath) {
  const qrDataUrl = await QRCode.toDataURL(nc.claveAcceso, { width: 100, margin: 1 });
  const qrBuffer  = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const W    = doc.page.width - 80;
    const AZUL = '#1e3a5f';
    const GRIS = '#64748b';
    let y = 40;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(AZUL)
      .text(configSri.razonSocial, 40, y, { width: W, align: 'center' });
    y += 16;
    doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`RUC: ${configSri.ruc}  |  NOTA DE CRÉDITO No. ${nc.numeroNC}`, 40, y, { width: W, align: 'center' });
    y += 12;
    doc.image(qrBuffer, W - 60 + 40, y, { width: 60, height: 60 });
    doc.fontSize(7).fillColor(GRIS)
      .text(`Clave de acceso: ${nc.claveAcceso}`, 40, y + 5, { width: W - 80 })
      .text(`Autorización: ${nc.numeroAutorizacion || 'PENDIENTE'}`, 40, y + 17, { width: W - 80 })
      .text(`Factura afectada: ${nc.numeroFacturaAfectada}`, 40, y + 29)
      .text(`Motivo: ${nc.motivoModificacion}`, 40, y + 41);
    y += 75;

    const detalles = typeof nc.detalles === 'string' ? JSON.parse(nc.detalles) : nc.detalles;
    doc.rect(40, y, W, 16).fill(AZUL);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff')
      .text('Descripción', 50, y + 4)
      .text('Cantidad', 280, y + 4, { width: 60, align: 'right' })
      .text('P.Unit.', 345, y + 4, { width: 60, align: 'right' })
      .text('Subtotal', 410, y + 4, { width: 70, align: 'right' });
    y += 16;
    detalles.forEach((det, idx) => {
      const cant  = parseFloat(det.cantidad);
      const prec  = parseFloat(det.precioUnitario);
      const sub   = (cant * prec).toFixed(2);
      doc.rect(40, y, W, 14).fill(idx % 2 === 0 ? '#fff' : '#f8fafc');
      doc.fontSize(7).font('Helvetica').fillColor('#000')
        .text(det.descripcion, 50, y + 3)
        .text(cant.toFixed(2), 280, y + 3, { width: 60, align: 'right' })
        .text(prec.toFixed(2), 345, y + 3, { width: 60, align: 'right' })
        .text(sub, 410, y + 3, { width: 70, align: 'right' });
      y += 14;
    });

    y += 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(AZUL)
      .text(`Subtotal: $${parseFloat(nc.totalSinImpuestos).toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });
    y += 14;
    doc.text(`IVA: $${parseFloat(nc.totalIva).toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });
    y += 14;
    doc.text(`TOTAL NC: $${parseFloat(nc.importeTotal).toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Genera el RIDE (PDF) de una Nota de Débito.
 */
async function generarRIDENotaDebito(nd, configSri, outputPath) {
  const qrDataUrl = await QRCode.toDataURL(nd.claveAcceso, { width: 100, margin: 1 });
  const qrBuffer  = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 40 });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const W    = doc.page.width - 80;
    const AZUL = '#1e3a5f';
    const GRIS = '#64748b';
    let y = 40;

    doc.fontSize(11).font('Helvetica-Bold').fillColor(AZUL)
      .text(configSri.razonSocial, 40, y, { width: W, align: 'center' });
    y += 16;
    doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`RUC: ${configSri.ruc}  |  NOTA DE DÉBITO No. ${nd.numero}`, 40, y, { width: W, align: 'center' });
    y += 12;
    doc.image(qrBuffer, W - 60 + 40, y, { width: 60, height: 60 });
    doc.fontSize(7).fillColor(GRIS)
      .text(`Clave de acceso: ${nd.claveAcceso}`, 40, y + 5, { width: W - 80 })
      .text(`Autorización: ${nd.numeroAutorizacion || 'PENDIENTE'}`, 40, y + 17, { width: W - 80 })
      .text(`Doc. sustento: ${nd.numeroDocSustento}`, 40, y + 29)
      .text(`Comprador: ${nd.razonSocialComprador}  |  ${nd.identificacionComprador}`, 40, y + 41);
    y += 75;

    const motivos = typeof nd.motivos === 'string' ? JSON.parse(nd.motivos) : (nd.motivos || []);
    doc.rect(40, y, W, 16).fill(AZUL);
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#fff')
      .text('Razón del débito', 50, y + 4)
      .text('Valor', 410, y + 4, { width: 70, align: 'right' });
    y += 16;
    motivos.forEach((m, idx) => {
      doc.rect(40, y, W, 14).fill(idx % 2 === 0 ? '#fff' : '#f8fafc');
      doc.fontSize(7).font('Helvetica').fillColor('#000')
        .text(m.razon, 50, y + 3, { width: 350 })
        .text(`$${parseFloat(m.valor).toFixed(2)}`, 410, y + 3, { width: 70, align: 'right' });
      y += 14;
    });

    y += 10;
    const totalSin = parseFloat(nd.totalSinImpuestos || 0);
    const totalIva = parseFloat(nd.totalIva || 0);
    const total    = parseFloat(nd.valorTotal || nd.importeTotal || totalSin + totalIva);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(AZUL)
      .text(`Subtotal: $${totalSin.toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });
    y += 14;
    doc.text(`IVA: $${totalIva.toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });
    y += 14;
    doc.text(`TOTAL ND: $${total.toFixed(2)}`, W - 100 + 40, y, { width: 110, align: 'right' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

/**
 * Genera un recibo de pago pequeño para impresoras térmicas POS (~80 mm).
 * No es un comprobante fiscal — es sólo el comprobante interno de caja.
 * @param {object} factura    - Registro de factura
 * @param {object} configSri  - Configuración de la empresa
 * @param {string} outputPath - Ruta de salida del PDF
 * @returns {Promise<string>} ruta del archivo generado
 */
async function generarReciboPOS(factura, configSri, outputPath) {
  return new Promise((resolve, reject) => {
    // 80 mm de rollo → ~227 pt; zona imprimible ≈204 pt (72 mm)
    const POS_W = 204;
    const ML    = 6;
    const W     = POS_W - ML * 2;

    // Altura generosa; la impresora corta al final del contenido
    const doc    = new PDFDocument({ size: [POS_W, 900], margins: { top: 8, bottom: 8, left: ML, right: ML }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const config   = configSri || {};
    const detalles = typeof factura.detalles === 'string' ? JSON.parse(factura.detalles) : (factura.detalles || []);
    const pagos    = typeof factura.pagos    === 'string' ? JSON.parse(factura.pagos)    : (factura.pagos    || []);

    let y = 8;

    // Línea separadora punteada
    const linea = () => {
      y += 3;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.5).stroke('#AAAAAA');
      y += 5;
    };

    // ── Encabezado empresa ───────────────────────────────────────────────────
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000')
       .text((config.razonSocial || '').toUpperCase(), ML, y, { width: W, align: 'center' });
    y += 12;
    if (config.nombreComercial) {
      doc.fontSize(7).font('Helvetica').fillColor('#333333')
         .text(config.nombreComercial, ML, y, { width: W, align: 'center' });
      y += 10;
    }
    doc.fontSize(7).font('Helvetica').fillColor('#333333')
       .text(`RUC: ${config.ruc || ''}`, ML, y, { width: W, align: 'center' });
    y += 10;
    doc.fontSize(6.5).font('Helvetica').fillColor('#555555')
       .text(config.dirMatriz || '', ML, y, { width: W, align: 'center' });
    y += 10;

    linea();

    // ── Datos del comprobante ────────────────────────────────────────────────
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
       .text(`FACTURA No. ${factura.numeroFactura || ''}`, ML, y, { width: W, align: 'center' });
    y += 12;
    const fEm = factura.fechaEmision
      ? new Date(factura.fechaEmision).toLocaleDateString('es-EC')
      : '';
    doc.fontSize(6.5).font('Helvetica').fillColor('#555555')
       .text(`Fecha: ${fEm}`, ML, y, { width: W, align: 'center' });
    y += 10;
    doc.fontSize(6).font('Helvetica').fillColor('#777777')
       .text(`Ambiente: ${config.ambiente === 2 ? 'PRODUCCIÓN' : 'PRUEBAS'}`, ML, y, { width: W, align: 'center' });
    y += 10;

    linea();

    // ── Cliente ──────────────────────────────────────────────────────────────
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000').text('CLIENTE:', ML, y);
    y += 10;
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
       .text(factura.razonSocialComprador || '', ML, y, { width: W });
    y += 9;
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
       .text(`CI/RUC: ${factura.identificacionComprador || ''}`, ML, y, { width: W });
    y += 10;

    linea();

    // ── Tabla de ítems ────────────────────────────────────────────────────────
    const C0 = W * 0.48; // Descripción
    const C1 = W * 0.14; // Cant.
    const C2 = W * 0.18; // P.U.
    const C3 = W * 0.20; // Total

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000')
       .text('Descripción', ML, y, { width: C0, lineBreak: false });
    doc.text('Cant', ML + C0, y, { width: C1, align: 'right', lineBreak: false });
    doc.text('P.U.',  ML + C0 + C1, y, { width: C2, align: 'right', lineBreak: false });
    doc.text('Total', ML + C0 + C1 + C2, y, { width: C3, align: 'right', lineBreak: false });
    y += 9;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.3).stroke('#AAAAAA');
    y += 4;

    detalles.forEach(det => {
      const cant  = parseFloat(det.cantidad)      || 0;
      const prec  = parseFloat(det.precioUnitario) || 0;
      const desc  = parseFloat(det.descuento)     || 0;
      const tot   = (cant * prec - desc).toFixed(2);
      const descH = doc.heightOfString(det.descripcion || '', { width: C0 });
      const rowH  = Math.max(descH, 9) + 2;

      doc.fontSize(6.5).font('Helvetica').fillColor('#000000')
         .text(det.descripcion || '', ML, y, { width: C0 });
      doc.text(cant.toFixed(2), ML + C0,           y, { width: C1, align: 'right', lineBreak: false });
      doc.text(prec.toFixed(2), ML + C0 + C1,      y, { width: C2, align: 'right', lineBreak: false });
      doc.text(tot,             ML + C0 + C1 + C2, y, { width: C3, align: 'right', lineBreak: false });
      y += rowH;
    });

    linea();

    // ── Totales ──────────────────────────────────────────────────────────────
    const st0   = parseFloat(factura.subtotal0       || 0);
    const st15  = parseFloat(factura.subtotal15      || 0);
    const iva15 = parseFloat(factura.totalIva        || 0);
    const tdesc = parseFloat(factura.totalDescuento  || 0);
    const prop  = parseFloat(factura.propina         || 0);
    const total = parseFloat(factura.importeTotal    || 0);

    const fila = (label, val, bold = false) => {
      const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
      const sz = bold ? 8 : 6.5;
      doc.fontSize(sz).font(fn).fillColor('#000000')
         .text(label, ML, y, { width: W * 0.65, lineBreak: false });
      doc.text(`$${val.toFixed(2)}`, ML + W * 0.65, y, { width: W * 0.35, align: 'right', lineBreak: false });
      y += bold ? 12 : 9;
    };

    if (st0  > 0) fila('Subtotal 0%:',   st0);
    if (st15 > 0) fila('Subtotal 15%:',  st15);
    if (iva15 > 0) fila('IVA 15%:',      iva15);
    if (tdesc > 0) fila('Descuento:',    tdesc);
    if (prop  > 0) fila('Propina:',      prop);
    fila('TOTAL:', total, true);

    linea();

    // ── Forma de pago ─────────────────────────────────────────────────────────
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000')
       .text('FORMA DE PAGO:', ML, y);
    y += 10;
    pagos.forEach(p => {
      doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
         .text(`${p.formaPago || 'Efectivo'}:`, ML, y, { width: W * 0.65, lineBreak: false });
      doc.text(`$${parseFloat(p.total).toFixed(2)}`, ML + W * 0.65, y, { width: W * 0.35, align: 'right', lineBreak: false });
      y += 9;
    });

    linea();

    // ── Autorización y clave ──────────────────────────────────────────────────
    if (factura.numeroAutorizacion) {
      doc.fontSize(5.5).font('Helvetica').fillColor('#555555')
         .text(`Auth: ${factura.numeroAutorizacion}`, ML, y, { width: W, align: 'center' });
      y += 9;
    }
    doc.fontSize(5).font('Helvetica').fillColor('#888888')
       .text(`Clave: ${factura.claveAcceso || ''}`, ML, y, { width: W, align: 'center' });
    y += 9;

    linea();

    // ── Pie ───────────────────────────────────────────────────────────────────
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
       .text('¡Gracias por su preferencia!', ML, y, { width: W, align: 'center' });
    y += 11;
    doc.fontSize(5.5).font('Helvetica').fillColor('#888888')
       .text('Representación impresa de comprobante electrónico — SRI Ecuador', ML, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// ─── 6. COMPROBANTE DE RETENCIÓN (tipo 07) ───────────────────────────────────

/**
 * Catálogo de impuestos para retenciones.
 * codigo 1 = Renta (IR), codigo 2 = IVA, codigo 6 = ISD
 */
const CODIGOS_RETENCION_RENTA = {
  '303': { descripcion: 'Honorarios profesionales', porcentaje: 8 },
  '304': { descripcion: 'Servicios predomina M.O.',  porcentaje: 8 },
  '307': { descripcion: 'Publicidad y comunicación', porcentaje: 1.75 },
  '309': { descripcion: 'Transporte privado',         porcentaje: 1 },
  '310': { descripcion: 'Arrendamiento inmuebles',    porcentaje: 8 },
  '312': { descripcion: 'Transferencia bienes m.n.',  porcentaje: 1.75 },
  '319': { descripcion: 'Arrendamiento de bienes',    porcentaje: 1.75 },
  '320': { descripcion: 'Seguros y reaseguros',       porcentaje: 1.75 },
  '322': { descripcion: 'Servicios entre sociedades', porcentaje: 1.75 },
  '323': { descripcion: 'Pagos al exterior servicios', porcentaje: 22 },
  '332': { descripcion: 'Compraventa de divisas',     porcentaje: 1 },
  '340': { descripcion: 'Relación de dependencia',    porcentaje: 0 }, // variable
  '341': { descripcion: 'Décimo tercer sueldo',       porcentaje: 0 }, // variable
  '3440': { descripcion: 'Otras retenciones',         porcentaje: 1.75 },
};

const CODIGOS_RETENCION_IVA = {
  '721': { descripcion: '30% Ret. IVA — compra bienes',        porcentaje: 30 },
  '723': { descripcion: '70% Ret. IVA — compra servicios',      porcentaje: 70 },
  '725': { descripcion: '100% Ret. IVA — LC y liquidaciones',   porcentaje: 100 },
  '727': { descripcion: '100% Ret. IVA — agente ret. especial', porcentaje: 100 },
  '729': { descripcion: '100% Ret. IVA — presunción crédito',   porcentaje: 100 },
};

/**
 * Genera el XML de un Comprobante de Retención según el esquema SRI versión 1.0.0.
 * @param {object} data   - Datos de la retención
 * @param {object} config - Configuración SRI del emisor
 * @returns {{ xml: string, totales: object }}
 */
function generarXMLRetencion(data, config) {
  const {
    claveAcceso,
    secuencial,
    fechaEmision,
    periodoFiscal,
    tipoIdentificacionProveedor,
    identificacionProveedor,
    razonSocialProveedor,
    tipoDocSustento,
    numeroDocSustento,
    fechaEmisionDocSustento,
    impuestos, // [{codigo, codigoPorcentaje, baseImponible, porcentajeRetener, valorRetenido, codDocSustento, numDocSustento, fechaDocSustento}]
    observaciones,
  } = data;

  const d = new Date(fechaEmision);
  const fechaStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  const dSust = new Date(fechaEmisionDocSustento);
  const fechaSustStr = `${String(dSust.getDate()).padStart(2,'0')}/${String(dSust.getMonth()+1).padStart(2,'0')}/${dSust.getFullYear()}`;

  const totalRetenido = impuestos.reduce((s, i) => s + parseFloat(i.valorRetenido), 0);

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('comprobanteRetencion', { id: 'comprobante', version: '1.0.0' });

  // infoTributaria
  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.COMPROBANTE_RETENCION);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.agenteRetencion) infoTrib.ele('agenteRetencion').txt(config.agenteRetencion);
  if (config.contribuyenteRimpe) {
    const rimpeLabel = config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE';
    infoTrib.ele('contribuyenteRimpe').txt(rimpeLabel);
  }

  // infoCompRetencion
  const infoComp = root.ele('infoCompRetencion');
  infoComp.ele('fechaEmision').txt(fechaStr);
  infoComp.ele('dirEstablecimiento').txt(config.dirEstablecimiento || config.dirMatriz);
  if (config.contribuyenteEspecial) infoComp.ele('contribuyenteEspecial').txt(config.contribuyenteEspecial);
  infoComp.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoComp.ele('tipoIdentificacionSujetoRetenido').txt(tipoIdentificacionProveedor);
  infoComp.ele('razonSocialSujetoRetenido').txt(razonSocialProveedor);
  infoComp.ele('identificacionSujetoRetenido').txt(identificacionProveedor);
  infoComp.ele('periodoFiscal').txt(periodoFiscal); // MM/YYYY

  // impuestos
  const impuestosEle = root.ele('impuestos');
  impuestos.forEach(imp => {
    const impEle = impuestosEle.ele('impuesto');
    impEle.ele('codigo').txt(String(imp.codigo));              // 1=Renta, 2=IVA, 6=ISD
    impEle.ele('codigoRetencion').txt(String(imp.codigoPorcentaje));
    impEle.ele('baseImponible').txt(parseFloat(imp.baseImponible).toFixed(2));
    impEle.ele('porcentajeRetener').txt(parseFloat(imp.porcentajeRetener).toFixed(2));
    impEle.ele('valorRetenido').txt(parseFloat(imp.valorRetenido).toFixed(2));
    impEle.ele('codDocSustento').txt(String(tipoDocSustento));
    impEle.ele('numDocSustento').txt(String(numeroDocSustento));
    impEle.ele('fechaEmisionDocSustento').txt(fechaSustStr);
  });

  // infoAdicional
  if (observaciones) {
    const infoAd = root.ele('infoAdicional');
    infoAd.ele('campoAdicional', { nombre: 'Observacion' }).txt(observaciones);
  }

  return {
    xml: root.end({ prettyPrint: true }),
    totales: { totalRetenido: parseFloat(totalRetenido.toFixed(2)) },
  };
}

/**
 * Genera el RIDE A4 de un Comprobante de Retención.
 */
async function generarRIDERetencion(retencion, configSri, outputPath) {
  const claveAcceso = retencion.claveAcceso || '0'.repeat(49);
  let barcodeBuffer = null;
  try {
    barcodeBuffer = await bwipjs.toBuffer({
      bcid:            'code128',
      text:            claveAcceso,
      scale:           2,
      height:          10,
      includetext:     false,
      backgroundcolor: 'FFFFFF',
    });
  } catch(e) { /* omitir si falla */ }

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 20, left: 28, right: 28 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML    = 28;
    const PW    = doc.page.width;
    const W     = PW - ML * 2;

    const AZUL   = '#1B3A6B';
    const GRIS   = '#555555';
    const NEGRO  = '#000000';
    const BLANCO = '#FFFFFF';
    const BG_ALT = '#F5F8FC';

    const config   = configSri || {};
    const impuestos = typeof retencion.impuestos === 'string'
      ? JSON.parse(retencion.impuestos)
      : (retencion.impuestos || []);

    const { logoData, tienelogo } = _resolverLogo(config.logoUrl);

    let y = 20;

    // ── HEADER: panel izquierdo (logo + emisor) | panel derecho (clave acceso) ──
    const LP   = Math.floor(W * 0.44);
    const GAP  = 8;
    const RP_X = ML + LP + GAP;
    const RP_W = W - LP - GAP;

    let yL = y;
    if (tienelogo) {
      try { doc.image(logoData, ML, yL, { fit: [LP - 4, 65] }); yL += 70; } catch(e) {}
    }

    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NEGRO)
       .text((config.razonSocial || '').toUpperCase(), ML, yL, { width: LP - 4, lineBreak: false });
    yL += 13;
    if (config.nombreComercial) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
         .text(config.nombreComercial, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 11;
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Dir. Matriz: ${config.dirMatriz || ''}`, ML, yL, { width: LP - 4 });
    yL = doc.y + 2;
    if (config.contribuyenteEspecial) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Contrib. Especial Nro: ${config.contribuyenteEspecial}`, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 10;
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Obligado a llevar contabilidad: ${config.obligadoContabilidad ? 'SI' : 'NO'}`, ML, yL, { width: LP - 4, lineBreak: false });
    yL += 10;
    if (config.agenteRetencion) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Agente de Retención Nro: ${config.agenteRetencion}`, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 10;
    }

    let yR = y;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
       .text('R.U.C.:', RP_X, yR, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ruc || ''}`, RP_X + 32, yR, { lineBreak: false });
    yR += 13;

    doc.fontSize(14).font('Helvetica-Bold').fillColor(NEGRO)
       .text('COMPROBANTE DE RETENCIÓN', RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 20;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text(`No. ${retencion.numeroRetencion || ''}`, RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 14;

    doc.moveTo(RP_X, yR).lineTo(RP_X + RP_W, yR).lineWidth(0.4).stroke('#CCCCCC');
    yR += 5;

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('NÚMERO DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(retencion.numeroAutorizacion || 'PENDIENTE DE AUTORIZACIÓN', RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    const fAut = retencion.fechaAutorizacion
      ? new Date(retencion.fechaAutorizacion).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })
      : '---';
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA Y HORA DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(fAut, RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('AMBIENTE:', RP_X, yR, { lineBreak: false });
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ambiente === 2 ? 'PRODUCCIÓN' : 'PRUEBAS'}`, RP_X + 38, yR, { lineBreak: false });
    yR += 12;

    // Barcode / clave acceso
    const BC_PAD = 4; const BC_LABEL_H = 11; const BC_H = 32; const BC_NUM_H = 11;
    const BC_BOX_H = BC_PAD + BC_LABEL_H + BC_PAD + BC_H + BC_NUM_H + BC_PAD;
    doc.rect(RP_X, yR, RP_W, BC_BOX_H).lineWidth(0.7).stroke('#888888');
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('CLAVE DE ACCESO / N° DE AUTORIZACIÓN', RP_X, yR + BC_PAD, { width: RP_W, align: 'center', lineBreak: false });
    const bcY = yR + BC_PAD + BC_LABEL_H + BC_PAD;
    if (barcodeBuffer) doc.image(barcodeBuffer, RP_X + 2, bcY, { width: RP_W - 4, height: BC_H });
    doc.fontSize(5.5).font('Helvetica').fillColor(GRIS)
       .text(claveAcceso, RP_X + 2, bcY + BC_H + 2, { width: RP_W - 4, align: 'center', lineBreak: false });
    yR += BC_BOX_H + 4;

    y = Math.max(yL, yR) + 6;

    // ── DATOS DEL PROVEEDOR / SUJETO RETENIDO ────────────────────────────────
    const PROV_H = 50;
    doc.rect(ML, y, W, PROV_H).lineWidth(0.5).stroke('#AAAAAA');
    doc.moveTo(ML, y + 20).lineTo(ML + W, y + 20).lineWidth(0.3).stroke('#CCCCCC');
    doc.moveTo(ML, y + 35).lineTo(ML + W, y + 35).lineWidth(0.3).stroke('#CCCCCC');

    // Fila 1: Razón Social
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RAZÓN SOCIAL / SUJETO RETENIDO:', ML + 3, y + 3, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(NEGRO)
       .text(retencion.razonSocialProveedor || '', ML + 3, y + 12, { width: W - 6, lineBreak: false });

    // Fila 2: Identificación | Período Fiscal
    const halfW = W / 2;
    doc.moveTo(ML + halfW, y + 20).lineTo(ML + halfW, y + PROV_H).lineWidth(0.3).stroke('#CCCCCC');
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RUC / IDENTIFICACIÓN:', ML + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(retencion.identificacionProveedor || '', ML + 3, y + 31, { width: halfW - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('PERÍODO FISCAL:', ML + halfW + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(retencion.periodoFiscal || '', ML + halfW + 3, y + 31, { width: halfW - 6, lineBreak: false });

    // Fila 3: Fecha Emisión | Documento Sustento
    const thirdW = W / 3;
    doc.moveTo(ML + thirdW, y + 35).lineTo(ML + thirdW, y + PROV_H).lineWidth(0.3).stroke('#CCCCCC');
    doc.moveTo(ML + thirdW * 2, y + 35).lineTo(ML + thirdW * 2, y + PROV_H).lineWidth(0.3).stroke('#CCCCCC');

    const fEm = retencion.fechaEmision
      ? new Date(retencion.fechaEmision).toLocaleDateString('es-EC')
      : '';
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA DE EMISIÓN:', ML + 3, y + 37, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(fEm, ML + 3, y + 44, { width: thirdW - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('TIPO DOC. SUSTENTO:', ML + thirdW + 3, y + 37, { lineBreak: false });
    const tiposDoc = { '01':'Factura', '02':'Nota de Venta', '03':'Liquidación de Compra',
                       '04':'Nota de Crédito', '05':'Nota de Débito', '06':'Guía de Remisión', '07':'Comprobante de Retención' };
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(tiposDoc[retencion.tipoDocSustento] || retencion.tipoDocSustento || '', ML + thirdW + 3, y + 44, { width: thirdW - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('Nro. DOC. SUSTENTO:', ML + thirdW * 2 + 3, y + 37, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(retencion.numeroDocSustento || '', ML + thirdW * 2 + 3, y + 44, { width: thirdW - 6, lineBreak: false });

    y += PROV_H + 6;

    // ── TABLA DE IMPUESTOS RETENIDOS ─────────────────────────────────────────
    const COLS = [
      { h: 'Cód.\nImpuesto', w: 45,  al: 'center' },
      { h: 'Cód.\nPorcentaje', w: 55, al: 'center' },
      { h: 'Concepto de Retención', w: 0, al: 'left' },  // flex
      { h: '% de\nRetención', w: 55,  al: 'right' },
      { h: 'Base\nImponible', w: 70,  al: 'right' },
      { h: 'Valor\nRetenido', w: 70,  al: 'right' },
    ];
    const fixedW = COLS.filter(c => c.w > 0).reduce((s, c) => s + c.w, 0);
    COLS.find(c => c.w === 0).w = W - fixedW;

    const TH_H = 24;
    doc.rect(ML, y, W, TH_H).fill(AZUL);
    let cx = ML;
    COLS.forEach(col => {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(BLANCO)
         .text(col.h, cx + 2, y + 4, { width: col.w - 4, align: col.al });
      cx += col.w;
    });
    y += TH_H;

    const TIPO_IMP_DESC = { '1': 'Renta (IR)', '2': 'IVA', '6': 'ISD' };
    let totalRetenidoPDF = 0;

    impuestos.forEach((imp, idx) => {
      const ROW_H = 14;
      const baseImp = parseFloat(imp.baseImponible) || 0;
      const valRet  = parseFloat(imp.valorRetenido)  || 0;
      const pct     = parseFloat(imp.porcentajeRetener) || 0;
      totalRetenidoPDF += valRet;

      // Obtener descripción del código de porcentaje
      let concepto = '';
      if (String(imp.codigo) === '1') {
        concepto = CODIGOS_RETENCION_RENTA[String(imp.codigoPorcentaje)]?.descripcion || `Código ${imp.codigoPorcentaje}`;
      } else if (String(imp.codigo) === '2') {
        concepto = CODIGOS_RETENCION_IVA[String(imp.codigoPorcentaje)]?.descripcion || `Código ${imp.codigoPorcentaje}`;
      } else {
        concepto = `Código ${imp.codigoPorcentaje}`;
      }

      doc.rect(ML, y, W, ROW_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(ML, y, W, ROW_H).lineWidth(0.2).stroke('#DDDDDD');

      const vals = [
        { v: `${imp.codigo} — ${TIPO_IMP_DESC[String(imp.codigo)] || imp.codigo}`, al: 'left' },
        { v: String(imp.codigoPorcentaje), al: 'center' },
        { v: concepto,    al: 'left'  },
        { v: `${pct.toFixed(2)}%`, al: 'right' },
        { v: `$${baseImp.toFixed(2)}`, al: 'right' },
        { v: `$${valRet.toFixed(2)}`,  al: 'right' },
      ];
      cx = ML;
      vals.forEach((v, vi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(v.v, cx + 2, y + 3, { width: COLS[vi].w - 4, align: v.al, lineBreak: false });
        cx += COLS[vi].w;
      });
      y += ROW_H;
    });

    // Fila de total
    y += 2;
    doc.rect(ML, y, W, 16).fill('#EEF3FB');
    doc.rect(ML, y, W, 16).lineWidth(0.5).stroke(AZUL);
    doc.fontSize(8).font('Helvetica-Bold').fillColor(AZUL)
       .text('TOTAL RETENIDO:', ML + 3, y + 4, { width: W - 80, align: 'right', lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(AZUL)
       .text(`$${totalRetenidoPDF.toFixed(2)}`, ML + W - 75, y + 3, { width: 70, align: 'right', lineBreak: false });
    y += 20;

    // ── PIE ───────────────────────────────────────────────────────────────────
    if (retencion.observaciones) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
         .text('Observaciones: ', ML, y, { continued: true });
      doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
         .text(retencion.observaciones, { lineBreak: false });
      y += 14;
    }

    y += 6;
    doc.fontSize(6).font('Helvetica').fillColor('#888888')
       .text(
         'Este documento es una Representación Impresa de un Comprobante Electrónico — SRI Ecuador',
         ML, y, { width: W, align: 'center' }
       );

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// ─── 7. LIQUIDACIÓN DE COMPRA (tipo 03) ──────────────────────────────────────

/**
 * Genera el XML de una Liquidación de Compra según el esquema SRI versión 1.1.0
 * Comprobante tipo 03: compras a personas naturales sin RUC.
 */
function generarXMLLiquidacionCompra(data, config) {
  const {
    claveAcceso,
    secuencial,
    fechaEmision,
    tipoIdentificacionProveedor,
    identificacionProveedor,
    razonSocialProveedor,
    direccionProveedor,
    detalles,
    pagos,
    observaciones,
  } = data;

  const d = new Date(fechaEmision);
  const fechaStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

  let subtotal0   = 0;
  let subtotal5   = 0;
  let subtotal12  = 0;
  let subtotal15  = 0;
  let totalDesc   = 0;
  let totalIva    = 0;

  const detallesXML = detalles.map(det => {
    const cant   = parseFloat(det.cantidad) || 0;
    const precio = parseFloat(det.precioUnitario) || 0;
    const desc   = parseFloat(det.descuento) || 0;
    const ivaPct = parseInt(det.ivaPorcentaje) || 0;

    const subtotalLinea = parseFloat(((cant * precio) - desc).toFixed(2));
    const ivaLinea      = parseFloat((subtotalLinea * (IVA_TARIFA[ivaPct] ?? 0)).toFixed(2));

    totalDesc += desc;
    if (ivaPct === 0)  subtotal0  += subtotalLinea;
    if (ivaPct === 5)  subtotal5  += subtotalLinea;
    if (ivaPct === 12) subtotal12 += subtotalLinea;
    if (ivaPct === 15) subtotal15 += subtotalLinea;
    totalIva  += ivaLinea;

    return {
      codigoPrincipal: det.codigoPrincipal || 'SRV001',
      descripcion:     det.descripcion,
      cantidad:        cant.toFixed(2),
      precioUnitario:  precio.toFixed(6),
      descuento:       desc.toFixed(2),
      precioTotalSinImpuesto: subtotalLinea.toFixed(2),
      ivaCodigo:       '2',
      ivaCodPct:       IVA_CODIGO[ivaPct] || '0',
      ivaTarifa:       (ivaPct).toFixed(2),
      ivaBaseImponible: subtotalLinea.toFixed(2),
      ivaValor:        ivaLinea.toFixed(2),
    };
  });

  subtotal0  = parseFloat(subtotal0.toFixed(2));
  subtotal5  = parseFloat(subtotal5.toFixed(2));
  subtotal12 = parseFloat(subtotal12.toFixed(2));
  subtotal15 = parseFloat(subtotal15.toFixed(2));
  totalDesc  = parseFloat(totalDesc.toFixed(2));
  totalIva   = parseFloat(totalIva.toFixed(2));
  const totalSinImpuestos = parseFloat((subtotal0 + subtotal5 + subtotal12 + subtotal15).toFixed(2));
  const importeTotal      = parseFloat((totalSinImpuestos + totalIva).toFixed(2));

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('liquidacionCompra', { id: 'comprobante', version: '1.1.0' });

  // infoTributaria
  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.LIQUIDACION_COMPRA);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.contribuyenteRimpe) {
    infoTrib.ele('contribuyenteRimpe').txt(config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE');
  }

  // infoLiquidacionCompra
  const infoLiq = root.ele('infoLiquidacionCompra');
  infoLiq.ele('fechaEmision').txt(fechaStr);
  infoLiq.ele('dirEstablecimiento').txt(config.dirEstablecimiento || config.dirMatriz);
  if (config.contribuyenteEspecial) infoLiq.ele('contribuyenteEspecial').txt(config.contribuyenteEspecial);
  infoLiq.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoLiq.ele('tipoIdentificacionProveedor').txt(tipoIdentificacionProveedor);
  infoLiq.ele('razonSocialProveedor').txt(razonSocialProveedor);
  infoLiq.ele('identificacionProveedor').txt(identificacionProveedor);
  if (direccionProveedor) infoLiq.ele('direccionProveedor').txt(direccionProveedor);
  infoLiq.ele('totalSinImpuestos').txt(totalSinImpuestos.toFixed(2));
  infoLiq.ele('totalDescuento').txt(totalDesc.toFixed(2));

  const totImpuestos = infoLiq.ele('totalConImpuestos');
  if (subtotal0 > 0 || (subtotal5 === 0 && subtotal12 === 0 && subtotal15 === 0)) {
    const ti0 = totImpuestos.ele('totalImpuesto');
    ti0.ele('codigo').txt('2');
    ti0.ele('codigoPorcentaje').txt('0');
    ti0.ele('baseImponible').txt(subtotal0.toFixed(2));
    ti0.ele('valor').txt('0.00');
  }
  if (subtotal5 > 0) {
    const ti5 = totImpuestos.ele('totalImpuesto');
    ti5.ele('codigo').txt('2');
    ti5.ele('codigoPorcentaje').txt('5');
    ti5.ele('baseImponible').txt(subtotal5.toFixed(2));
    ti5.ele('valor').txt((subtotal5 * 0.05).toFixed(2));
  }
  if (subtotal12 > 0) {
    const ti12 = totImpuestos.ele('totalImpuesto');
    ti12.ele('codigo').txt('2');
    ti12.ele('codigoPorcentaje').txt('2');
    ti12.ele('baseImponible').txt(subtotal12.toFixed(2));
    ti12.ele('valor').txt((subtotal12 * 0.12).toFixed(2));
  }
  if (subtotal15 > 0) {
    const ti15 = totImpuestos.ele('totalImpuesto');
    ti15.ele('codigo').txt('2');
    ti15.ele('codigoPorcentaje').txt('4');
    ti15.ele('baseImponible').txt(subtotal15.toFixed(2));
    ti15.ele('valor').txt((subtotal15 * 0.15).toFixed(2));
  }

  infoLiq.ele('importeTotal').txt(importeTotal.toFixed(2));
  infoLiq.ele('moneda').txt('DOLAR');

  const pagosEle = infoLiq.ele('pagos');
  (pagos && pagos.length > 0 ? pagos : [{ formaPago: 'Efectivo', total: importeTotal }]).forEach(p => {
    const pagoEle = pagosEle.ele('pago');
    pagoEle.ele('formaPago').txt(resolverFormaPago(p.formaPago));
    pagoEle.ele('total').txt(parseFloat(p.total).toFixed(2));
    pagoEle.ele('plazo').txt(String(p.plazo || 0));
    pagoEle.ele('unidadTiempo').txt(p.unidadTiempo || 'dias');
  });

  // detalles
  const detallesEle = root.ele('detalles');
  detallesXML.forEach(det => {
    const detEle = detallesEle.ele('detalle');
    detEle.ele('codigoPrincipal').txt(det.codigoPrincipal);
    detEle.ele('descripcion').txt(det.descripcion);
    detEle.ele('cantidad').txt(det.cantidad);
    detEle.ele('precioUnitario').txt(det.precioUnitario);
    detEle.ele('descuento').txt(det.descuento);
    detEle.ele('precioTotalSinImpuesto').txt(det.precioTotalSinImpuesto);
    const impEle = detEle.ele('impuestos').ele('impuesto');
    impEle.ele('codigo').txt(det.ivaCodigo);
    impEle.ele('codigoPorcentaje').txt(det.ivaCodPct);
    impEle.ele('tarifa').txt(det.ivaTarifa);
    impEle.ele('baseImponible').txt(det.ivaBaseImponible);
    impEle.ele('valor').txt(det.ivaValor);
  });

  // infoAdicional
  {
    const camposAd = [];
    if (direccionProveedor) camposAd.push({ nombre: 'Direccion',   valor: direccionProveedor });
    if (observaciones)      camposAd.push({ nombre: 'Observacion', valor: observaciones });
    if (camposAd.length > 0) {
      const infoAd = root.ele('infoAdicional');
      camposAd.forEach(c => infoAd.ele('campoAdicional', { nombre: c.nombre }).txt(c.valor));
    }
  }

  return {
    xml: root.end({ prettyPrint: true }),
    totales: { subtotal0, subtotal5, subtotal12, subtotal15, totalDescuento: totalDesc, totalIva, importeTotal },
  };
}

/**
 * Genera el RIDE A4 de una Liquidación de Compra.
 */
async function generarRIDELiquidacionCompra(liq, configSri, outputPath) {
  const claveAcceso = liq.claveAcceso || '0'.repeat(49);
  let barcodeBuffer = null;
  try {
    barcodeBuffer = await bwipjs.toBuffer({
      bcid: 'code128', text: claveAcceso, scale: 2, height: 10,
      includetext: false, backgroundcolor: 'FFFFFF',
    });
  } catch(e) { /* omitir barcode si falla */ }

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 20, left: 28, right: 28 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML   = 28;
    const PW   = doc.page.width;
    const W    = PW - ML * 2;
    const AZUL  = '#1B3A6B';
    const GRIS  = '#555555';
    const NEGRO = '#000000';
    const BG_ALT = '#F5F8FC';

    const config   = configSri || {};
    const detalles = typeof liq.detalles === 'string' ? JSON.parse(liq.detalles) : (liq.detalles || []);
    const pagos    = typeof liq.pagos    === 'string' ? JSON.parse(liq.pagos)    : (liq.pagos    || []);

    const { logoData, tienelogo } = _resolverLogo(config.logoUrl);

    let y = 20;
    const LP   = Math.floor(W * 0.44);
    const GAP  = 8;
    const RP_X = ML + LP + GAP;
    const RP_W = W - LP - GAP;

    // Panel izquierdo: logo + datos emisor
    let yL = y;
    if (tienelogo) {
      try { doc.image(logoData, ML, yL, { fit: [LP - 4, 65] }); yL += 70; } catch(e) {}
    }
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NEGRO)
       .text((config.razonSocial || '').toUpperCase(), ML, yL, { width: LP - 4, lineBreak: false });
    yL += 13;
    if (config.nombreComercial) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS).text(config.nombreComercial, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 11;
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS).text(`Dir. Matriz: ${config.dirMatriz || ''}`, ML, yL, { width: LP - 4 });
    yL = doc.y + 2;
    if (config.dirEstablecimiento) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS).text(`Dir. Sucursal: ${config.dirEstablecimiento}`, ML, yL, { width: LP - 4 });
      yL = doc.y + 2;
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Obligado a llevar contabilidad: ${config.obligadoContabilidad ? 'SI' : 'NO'}`, ML, yL, { width: LP - 4, lineBreak: false });
    yL += 10;

    // Panel derecho: RUC + título + autorización + barcode
    let yR = y;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS).text('R.U.C.:', RP_X, yR, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO).text(`  ${config.ruc || ''}`, RP_X + 32, yR, { lineBreak: false });
    yR += 13;

    doc.fontSize(12).font('Helvetica-Bold').fillColor(NEGRO)
       .text('LIQUIDACIÓN DE COMPRA', RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 18;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text(`No. ${liq.numeroLiquidacion || ''}`, RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 14;

    doc.moveTo(RP_X, yR).lineTo(RP_X + RP_W, yR).lineWidth(0.4).stroke('#CCCCCC');
    yR += 5;

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS).text('NÚMERO DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(liq.numeroAutorizacion || 'PENDIENTE DE AUTORIZACIÓN', RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    const fAut = liq.fechaAutorizacion ? new Date(liq.fechaAutorizacion).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) : '---';
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS).text('FECHA Y HORA DE AUTORIZACIÓN:', RP_X, yR, { lineBreak: false });
    yR += 9;
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO).text(fAut, RP_X, yR, { width: RP_W, lineBreak: false });
    yR += 10;

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS).text('AMBIENTE:', RP_X, yR, { lineBreak: false });
    doc.fontSize(6).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ambiente === 2 ? 'PRODUCCIÓN' : 'PRUEBAS'}`, RP_X + 38, yR, { lineBreak: false });
    yR += 12;

    // Barcode
    const BC_PAD = 4; const BC_LABEL_H = 11; const BC_H = 32; const BC_NUM_H = 11;
    const BC_BOX_H = BC_PAD + BC_LABEL_H + BC_PAD + BC_H + BC_NUM_H + BC_PAD;
    doc.rect(RP_X, yR, RP_W, BC_BOX_H).lineWidth(0.7).stroke('#888888');
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('CLAVE DE ACCESO / N° DE AUTORIZACIÓN', RP_X, yR + BC_PAD, { width: RP_W, align: 'center', lineBreak: false });
    const bcY = yR + BC_PAD + BC_LABEL_H + BC_PAD;
    if (barcodeBuffer) doc.image(barcodeBuffer, RP_X + 2, bcY, { width: RP_W - 4, height: BC_H });
    doc.fontSize(5.5).font('Helvetica').fillColor(GRIS)
       .text(claveAcceso, RP_X + 2, bcY + BC_H + 2, { width: RP_W - 4, align: 'center', lineBreak: false });
    yR += BC_BOX_H + 4;

    y = Math.max(yL, yR) + 6;

    // ── DATOS DEL PROVEEDOR ──────────────────────────────────────────────────
    const PROV_H = 40;
    doc.rect(ML, y, W, PROV_H).lineWidth(0.5).stroke('#AAAAAA');
    doc.moveTo(ML, y + 20).lineTo(ML + W, y + 20).lineWidth(0.3).stroke('#CCCCCC');
    const COL_ID_W = W * 0.55;
    doc.moveTo(ML + COL_ID_W, y + 20).lineTo(ML + COL_ID_W, y + PROV_H).lineWidth(0.3).stroke('#CCCCCC');

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('PROVEEDOR (PERSONA NATURAL):', ML + 3, y + 3, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(NEGRO)
       .text(liq.razonSocialProveedor || '', ML + 3, y + 12, { width: W - 6, lineBreak: false });

    const fEm = liq.fechaEmision ? new Date(liq.fechaEmision).toLocaleDateString('es-EC') : '';
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('CÉDULA / PASAPORTE:', ML + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(liq.identificacionProveedor || '', ML + 3, y + 32, { width: COL_ID_W - 6, lineBreak: false });
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA DE EMISIÓN:', ML + COL_ID_W + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(fEm, ML + COL_ID_W + 3, y + 32, { lineBreak: false });
    y += PROV_H + 8;

    // ── TABLA DE DETALLES ──────────────────────────────────────────────────
    const HDR_H = 16;
    const COLS  = [
      { label: 'Cód.',        w: Math.floor(W * 0.08) },
      { label: 'Descripción', w: Math.floor(W * 0.35) },
      { label: 'Cant.',       w: Math.floor(W * 0.07) },
      { label: 'P. Unit.',    w: Math.floor(W * 0.12) },
      { label: 'Desc.',       w: Math.floor(W * 0.09) },
      { label: 'IVA%',        w: Math.floor(W * 0.07) },
      { label: 'Total',       w: Math.floor(W * 0.12) },
    ];
    const LAST_W = W - COLS.slice(0, -1).reduce((s, c) => s + c.w, 0);
    COLS[COLS.length - 1].w = LAST_W;

    // Encabezado tabla
    doc.rect(ML, y, W, HDR_H).fill(AZUL);
    let cx = ML;
    COLS.forEach(col => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#FFFFFF')
         .text(col.label, cx + 2, y + 4, { width: col.w - 4, align: 'center', lineBreak: false });
      cx += col.w;
    });
    y += HDR_H;

    const ROW_H = 15;
    detalles.forEach((det, idx) => {
      const cant   = parseFloat(det.cantidad) || 0;
      const precio = parseFloat(det.precioUnitario) || 0;
      const desc   = parseFloat(det.descuento) || 0;
      const ivaPct = parseInt(det.ivaPorcentaje) || 0;
      const total  = parseFloat(((cant * precio) - desc).toFixed(2));

      if (idx % 2 === 1) doc.rect(ML, y, W, ROW_H).fill(BG_ALT);

      const vals = [
        { v: det.codigoPrincipal || '-',         al: 'center' },
        { v: det.descripcion || '',               al: 'left'   },
        { v: cant.toFixed(2),                     al: 'right'  },
        { v: `$${precio.toFixed(4)}`,             al: 'right'  },
        { v: `$${desc.toFixed(2)}`,               al: 'right'  },
        { v: `${ivaPct}%`,                        al: 'center' },
        { v: `$${total.toFixed(2)}`,              al: 'right'  },
      ];
      cx = ML;
      vals.forEach((v, vi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(v.v, cx + 2, y + 4, { width: COLS[vi].w - 4, align: v.al, lineBreak: false });
        cx += COLS[vi].w;
      });
      doc.moveTo(ML, y + ROW_H).lineTo(ML + W, y + ROW_H).lineWidth(0.2).stroke('#DDDDDD');
      y += ROW_H;
    });

    y += 6;

    // ── TOTALES + PAGO ────────────────────────────────────────────────────
    const TOT_X = ML + W - 180;
    const TOT_W = 180;

    const subtotal0  = parseFloat(liq.subtotal0  || 0);
    const subtotal15 = parseFloat(liq.subtotal15 || 0);
    const totalIva   = parseFloat(liq.totalIva   || 0);
    const impTotal   = parseFloat(liq.importeTotal || 0);

    const totRows = [
      { label: 'SUBTOTAL 0%',         val: subtotal0  },
      { label: 'SUBTOTAL 15%',        val: subtotal15 },
      { label: 'IVA 15%',             val: totalIva   },
    ];

    let yTot = y;
    totRows.forEach(row => {
      doc.fontSize(7).font('Helvetica').fillColor(GRIS)
         .text(row.label + ':', TOT_X, yTot, { width: 100, align: 'right', lineBreak: false });
      doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
         .text(`$${row.val.toFixed(2)}`, TOT_X + 105, yTot, { width: 70, align: 'right', lineBreak: false });
      yTot += 13;
    });

    // Total final (resaltado)
    yTot += 2;
    doc.rect(TOT_X - 4, yTot - 2, TOT_W + 4, 18).fill('#EEF3FB');
    doc.fontSize(9).font('Helvetica-Bold').fillColor(AZUL)
       .text('IMPORTE TOTAL:', TOT_X, yTot + 2, { width: 100, align: 'right', lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(AZUL)
       .text(`$${impTotal.toFixed(2)}`, TOT_X + 105, yTot + 2, { width: 70, align: 'right', lineBreak: false });
    yTot += 22;

    // Forma de pago
    if (pagos && pagos.length > 0) {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRIS).text('FORMA DE PAGO:', ML, y + 2, { lineBreak: false });
      pagos.forEach((p, pi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(`${p.formaPago}: $${parseFloat(p.total).toFixed(2)}`, ML, y + 14 + pi * 12, { lineBreak: false });
      });
    }

    y = Math.max(yTot, y + 40) + 6;

    // Observaciones
    if (liq.observaciones) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS).text('Observaciones: ', ML, y, { continued: true });
      doc.fontSize(7).font('Helvetica').fillColor(NEGRO).text(liq.observaciones, { lineBreak: false });
      y += 14;
    }

    y += 6;
    doc.fontSize(6).font('Helvetica').fillColor('#888888')
       .text('Este documento es una Representación Impresa de un Comprobante Electrónico — SRI Ecuador', ML, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// ─── GUÍA DE REMISIÓN ────────────────────────────────────────────────────────

/**
 * Genera el XML de una Guía de Remisión según esquema SRI v1.0.0 (tipo 06).
 *
 * @param {object} data
 *   claveAcceso, secuencial, fechaIniTransporte, fechaFinTransporte,
 *   dirPartida,
 *   rucTransportista, nombreTransportista, placaVehiculo,
 *   rucDestinatario, nombreDestinatario, dirDestinatario,
 *   motivoTraslado, docAduaneroUnico?,
 *   codDocSustento, numDocSustento, numAutDocSustento, fechaEmisionDocSustento,
 *   detalles: [{ codigoInterno?, descripcion, cantidad }],
 *   observaciones?
 * @param {object} config — configuracion_sri de la empresa
 * @returns {{ xml: string }}
 */
function generarXMLGuiaRemision(data, config) {
  const {
    claveAcceso, secuencial,
    fechaIniTransporte, fechaFinTransporte,
    dirPartida,
    rucTransportista, nombreTransportista, placaVehiculo,
    rucDestinatario,  nombreDestinatario,  dirDestinatario,
    motivoTraslado,   docAduaneroUnico,
    codDocSustento = '01',
    numDocSustento = '001-001-000000000',
    numAutDocSustento = '',
    fechaEmisionDocSustento,
    detalles = [],
    observaciones,
  } = data;

  const fmt = (d) => {
    const dt = d ? new Date(d) : new Date();
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  };

  // Determinar tipo de identificación del transportista (04=RUC 13 dígitos, 05=cédula 10)
  const tipoIdTransportista = String(rucTransportista).replace(/\D/g,'').length === 13 ? '04' : '05';

  const root = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('guiaRemision', { id: 'comprobante', version: '1.0.0' });

  // infoTributaria
  const infoTrib = root.ele('infoTributaria');
  infoTrib.ele('ambiente').txt(String(config.ambiente));
  infoTrib.ele('tipoEmision').txt('1');
  infoTrib.ele('razonSocial').txt(config.razonSocial);
  if (config.nombreComercial) infoTrib.ele('nombreComercial').txt(config.nombreComercial);
  infoTrib.ele('ruc').txt(config.ruc);
  infoTrib.ele('claveAcceso').txt(claveAcceso);
  infoTrib.ele('codDoc').txt(TIPO_COMPROBANTE.GUIA_REMISION);
  infoTrib.ele('estab').txt(String(config.establecimiento).padStart(3, '0'));
  infoTrib.ele('ptoEmi').txt(String(config.puntoEmision).padStart(3, '0'));
  infoTrib.ele('secuencial').txt(String(secuencial).padStart(9, '0'));
  infoTrib.ele('dirMatriz').txt(config.dirMatriz);
  if (config.contribuyenteRimpe) {
    infoTrib.ele('contribuyenteRimpe').txt(config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE');
  }

  // infoGuiaRemision
  const infoGR = root.ele('infoGuiaRemision');
  infoGR.ele('dirPartida').txt(dirPartida || config.dirMatriz);
  infoGR.ele('razonSocialTransportista').txt(nombreTransportista);
  infoGR.ele('tipoIdentificacionTransportista').txt(tipoIdTransportista);
  infoGR.ele('rucTransportista').txt(rucTransportista);
  infoGR.ele('obligadoContabilidad').txt(config.obligadoContabilidad ? 'SI' : 'NO');
  infoGR.ele('fechaIniTransporte').txt(fmt(fechaIniTransporte));
  infoGR.ele('fechaFinTransporte').txt(fmt(fechaFinTransporte));
  if (placaVehiculo) infoGR.ele('placa').txt(placaVehiculo);

  // destinatarios (mínimo 1)
  const destinatariosEle = root.ele('destinatarios');
  const dest = destinatariosEle.ele('destinatario');
  dest.ele('identificacionDestinatario').txt(rucDestinatario);
  dest.ele('razonSocialDestinatario').txt(nombreDestinatario);
  dest.ele('dirDestinatario').txt(dirDestinatario);
  dest.ele('motivoTraslado').txt(motivoTraslado);
  if (docAduaneroUnico) dest.ele('docAduaneroUnico').txt(docAduaneroUnico);
  dest.ele('codDocSustento').txt(codDocSustento);
  dest.ele('numDocSustento').txt(numDocSustento);
  dest.ele('numAutDocSustento').txt(numAutDocSustento || '');
  dest.ele('fechaEmisionDocSustento').txt(fmt(fechaEmisionDocSustento));

  // detalles del destinatario
  const detallesEle = dest.ele('detalles');
  (detalles.length > 0 ? detalles : [{ descripcion: 'Mercadería', cantidad: 1 }]).forEach(d => {
    const det = detallesEle.ele('detalle');
    if (d.codigoInterno) det.ele('codigoInterno').txt(String(d.codigoInterno));
    det.ele('descripcion').txt(d.descripcion || 'Artículo');
    det.ele('cantidad').txt(parseFloat(d.cantidad || 1).toFixed(2));
  });

  // infoAdicional — observaciones
  if (observaciones) {
    root.ele('infoAdicional')
        .ele('campoAdicional', { nombre: 'Observacion' }).txt(observaciones);
  }

  return { xml: root.end({ prettyPrint: true }) };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  calcularDigitoVerificador,
  generarClaveAcceso,
  formatearNumeroFactura,
  generarXMLFactura,
  generarXMLNotaCredito,
  generarXMLNotaDebito,
  generarXMLRetencion,
  generarXMLLiquidacionCompra,
  generarXMLGuiaRemision,
  firmarXML,
  enviarComprobanteSRI,
  autorizarComprobanteSRI,
  generarRIDEFactura,
  generarRIDENotaCredito,
  generarRIDENotaDebito,
  generarRIDERetencion,
  generarRIDELiquidacionCompra,
  generarReciboPOS,
  TIPO_COMPROBANTE,
  FORMAS_PAGO,
  VALID_SRI_FORMA_PAGO,
  resolverFormaPago,
  CODIGOS_RETENCION_RENTA,
  CODIGOS_RETENCION_IVA,
  IVA_CODIGO,
  IVA_TARIFA,
  parsearNotaCreditoRecibidaXml,
};
