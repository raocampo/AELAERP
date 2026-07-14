// ====================================
// PARSEO DE FACTURAS DE VENTA EMITIDAS DESDE SU XML AUTORIZADO
// backend/utils/importarFacturasVentaXML.js
//
// Para clientes con contabilidad atrasada que ya tienen a mano los XML de
// sus facturas emitidas (descargados de srienlinea.sri.gob.ec) — evita
// re-teclear cada factura en la plantilla Excel de "Importar Históricas".
// Acepta el <factura> autorizado directamente (mismo formato que genera
// utils/sri.js al firmar), sin el wrapper <autorizacion> de la respuesta
// SOAP del SRI (ya viene solo el comprobante).
// ====================================

const { XMLParser } = require('fast-xml-parser');

const XML_OPTIONS = { ignoreAttributes: false, trimValues: true, parseTagValue: false };

function ensureArray(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}
function toNum(v, fallback = 0) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? fallback : n;
}
function limpiar(v) { return v === undefined || v === null ? '' : String(v).trim(); }

function parsearFechaDDMMAAAA(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
}

// Deriva la tarifa real (0/5/12/14/15) del valor de IVA sobre la base,
// en vez de confiar en el catálogo de códigos codigoPorcentaje del SRI
// (que cambió varias veces — 2=12%, luego 4=15%, etc.) — más robusto.
function inferirTarifa(baseImponible, valor) {
  if (baseImponible <= 0) return 0;
  const pct = Math.round((valor / baseImponible) * 100);
  if ([0, 5, 12, 14, 15].includes(pct)) return pct;
  // tolerancia de redondeo
  return [0, 5, 12, 14, 15].reduce((mejor, cand) => Math.abs(cand - pct) < Math.abs(mejor - pct) ? cand : mejor, 15);
}

/**
 * Parsea un <factura> XML autorizado y devuelve los datos necesarios para
 * crear el registro en `facturas` (mismo shape que usa el importador
 * histórico por Excel — ver routes/facturas.js "/importar/ejecutar").
 */
function parsearFacturaXML(xmlString) {
  const parser = new XMLParser(XML_OPTIONS);
  const parsed = parser.parse(xmlString);
  const doc = parsed?.factura;
  if (!doc) throw new Error('No es un XML de <factura> válido');

  const infoTrib = doc.infoTributaria || {};
  const infoFac  = doc.infoFactura || {};

  const claveAcceso = limpiar(infoTrib.claveAcceso);
  if (!/^\d{49}$/.test(claveAcceso)) throw new Error(`claveAcceso inválida: "${claveAcceso}"`);

  const fechaEmision = parsearFechaDDMMAAAA(infoFac.fechaEmision);
  if (!fechaEmision) throw new Error(`fechaEmision inválida: "${infoFac.fechaEmision}"`);

  let subtotal0 = 0, subtotal5 = 0, subtotal15 = 0, subtotalNoObjetoIva = 0, totalIva = 0;
  const impuestos = ensureArray(infoFac?.totalConImpuestos?.totalImpuesto);
  for (const imp of impuestos) {
    const base  = toNum(imp.baseImponible);
    const valor = toNum(imp.valor);
    const codigo = limpiar(imp.codigo); // 2=IVA, 6=No objeto, 7=Exento
    if (codigo === '6' || codigo === '7') { subtotalNoObjetoIva += base; continue; }
    const tarifa = inferirTarifa(base, valor);
    if (tarifa === 5) subtotal5 += base;
    else if (tarifa === 0) subtotal0 += base;
    else subtotal15 += base; // 12/14/15 histórico — mismo criterio que el importador Excel
    totalIva += valor;
  }

  const detalles = ensureArray(doc?.detalles?.detalle).map((d) => {
    const impDet = ensureArray(d?.impuestos?.impuesto)[0] || {};
    const base = toNum(impDet.baseImponible, toNum(d.precioTotalSinImpuesto));
    const valorIva = toNum(impDet.valor);
    return {
      codigoPrincipal: limpiar(d.codigoPrincipal) || null,
      descripcion: limpiar(d.descripcion) || 'Ítem',
      cantidad: toNum(d.cantidad, 1),
      precioUnitario: toNum(d.precioUnitario),
      descuento: toNum(d.descuento),
      ivaPorcentaje: inferirTarifa(base, valorIva),
    };
  });

  return {
    claveAcceso,
    numeroFactura: `${limpiar(infoTrib.estab)}-${limpiar(infoTrib.ptoEmi)}-${limpiar(infoTrib.secuencial)}`,
    secuencial: limpiar(infoTrib.secuencial),
    rucEmisor: limpiar(infoTrib.ruc),
    razonSocialEmisor: limpiar(infoTrib.razonSocial),
    tipoIdentificacionComprador: limpiar(infoFac.tipoIdentificacionComprador) || '07',
    identificacionComprador: limpiar(infoFac.identificacionComprador) || '9999999999999',
    razonSocialComprador: limpiar(infoFac.razonSocialComprador) || 'CONSUMIDOR FINAL',
    emailComprador: limpiar(infoFac?.email) || null,
    fechaEmision,
    subtotal0: round2(subtotal0),
    subtotal5: round2(subtotal5),
    subtotal15: round2(subtotal15),
    subtotalNoObjetoIva: round2(subtotalNoObjetoIva),
    totalDescuento: round2(toNum(infoFac.totalDescuento)),
    totalIva: round2(totalIva),
    propina: round2(toNum(infoFac.propina)),
    importeTotal: round2(toNum(infoFac.importeTotal)),
    detalles,
    pagos: ensureArray(infoFac?.pagos?.pago).map((p) => ({ formaPago: limpiar(p.formaPago), total: toNum(p.total) })),
    numeroAutorizacion: claveAcceso,
  };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

module.exports = { parsearFacturaXML };
