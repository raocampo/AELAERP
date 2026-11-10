const test = require('node:test');
const assert = require('node:assert/strict');
const { XMLParser, XMLValidator } = require('fast-xml-parser');
const { tipoIdProveedorAts, construirPagoExteriorXML, construirFormasDePagoXML, construirVentasEstablecimientoXML } = require('../routes/ats');

test('tipoIdProveedorAts convierte el catálogo de comprobantes (04/05/06) al de ATS-compras (01/02/03)', () => {
  assert.equal(tipoIdProveedorAts('04'), '01'); // RUC
  assert.equal(tipoIdProveedorAts('05'), '02'); // Cédula
  assert.equal(tipoIdProveedorAts('06'), '03'); // Pasaporte
});

test('tipoIdProveedorAts deja pasar un código que ya viene en el catálogo del ATS', () => {
  assert.equal(tipoIdProveedorAts('01'), '01');
  assert.equal(tipoIdProveedorAts('02'), '02');
  assert.equal(tipoIdProveedorAts('03'), '03');
});

test('tipoIdProveedorAts usa RUC (01) como default seguro ante un código vacío o desconocido', () => {
  assert.equal(tipoIdProveedorAts(''), '01');
  assert.equal(tipoIdProveedorAts(null), '01');
  assert.equal(tipoIdProveedorAts(undefined), '01');
  assert.equal(tipoIdProveedorAts('07'), '01'); // 07=Consumidor Final no aplica a compras
});

// ─── construirPagoExteriorXML / construirFormasDePagoXML ─────────────────────
// Regresión del bug real: el fix anterior (5f51031) emitía <pagoLocExt> y
// <formaPago> SUELTOS, directo bajo <detalleCompras> — no existen ahí en el
// XSD oficial del SRI (ats.xsd), DIMM los rechazaba como "XML mal formado"
// en absolutamente toda línea. Confirmado descargando el XSD real
// (https://descargas.sri.gob.ec/download/anexos/ats/ats.xsd) y validando con
// lxml.XMLSchema contra el XML real que el usuario compartió (inválido con
// el bug, válido con este fix) — ver docs/pendientes-2026-10-12-*.md.

function parsearFragmento(xml) {
  // Los fragmentos no son documentos XML completos — se envuelven en una
  // raíz dummy para poder validar bien-formación y parsear con las mismas
  // herramientas que el resto del proyecto.
  const envuelto = `<root>${xml}</root>`;
  const validacion = XMLValidator.validate(envuelto);
  assert.equal(validacion, true, `fragmento mal formado: ${JSON.stringify(validacion)}`);
  return new XMLParser().parse(envuelto).root;
}

test('construirPagoExteriorXML anida pagoLocExt dentro de <pagoExterior> junto a los 2 subcampos obligatorios del XSD, y respeta 01/02 (local/exterior)', () => {
  const doc01 = new XMLParser({ parseTagValue: false }).parse(`<root>${construirPagoExteriorXML('01')}</root>`).root;
  const doc02 = new XMLParser({ parseTagValue: false }).parse(`<root>${construirPagoExteriorXML('02')}</root>`).root;
  assert.deepEqual(doc01.pagoExterior, { pagoLocExt: '01', aplicConvDobTrib: 'NA', pagExtSujRetNorLeg: 'NA' });
  assert.deepEqual(doc02.pagoExterior, { pagoLocExt: '02', aplicConvDobTrib: 'NA', pagExtSujRetNorLeg: 'NA' });
});

test('construirFormasDePagoXML devuelve vacío sin códigos (el bloque es opcional en el XSD)', () => {
  assert.equal(construirFormasDePagoXML([]), '');
  assert.equal(construirFormasDePagoXML(null), '');
  assert.equal(construirFormasDePagoXML(undefined), '');
});

test('construirFormasDePagoXML anida cada código dentro de <formasDePago><formaPago>', () => {
  const parser = new XMLParser({ parseTagValue: false, isArray: (name) => name === 'formaPago' });
  const parsed = parser.parse(`<root>${construirFormasDePagoXML(['01', '20'])}</root>`).root;
  assert.deepEqual(parsed.formasDePago.formaPago, ['01', '20']);
});

test('ambos fragmentos combinados siguen produciendo XML bien formado (regresión del bug real reportado)', () => {
  const fragmento = construirPagoExteriorXML('01') + construirFormasDePagoXML(['20']);
  parsearFragmento(fragmento); // lanza si no está bien formado
});

// ─── construirVentasEstablecimientoXML ────────────────────────────────────────
// Regresión del error real de DIMM: "Cuando existan detalles de Ventas debe
// exitir Ventas Establecimiento" (sic) — faltaba el bloque por completo. La
// función solo arma el XML a partir de los ítems que recibe; la DECISIÓN de
// si hay que incluir un fallback (establecimiento principal en $0 cuando hay
// compras pero cero ventas en el período — confirmado con un XML real del
// usuario que DIMM seguía rechazando con este mismo error incluso con
// <ventas></ventas> completamente vacío, contradiciendo la lectura literal
// del mensaje) vive en el caller (GET /exportar), no acá.
test('construirVentasEstablecimientoXML devuelve vacío sin ítems', () => {
  assert.equal(construirVentasEstablecimientoXML([]), '');
  assert.equal(construirVentasEstablecimientoXML(null), '');
  assert.equal(construirVentasEstablecimientoXML(undefined), '');
});

test('construirVentasEstablecimientoXML genera un <ventaEst> por establecimiento con codEstab/ventasEstab/ivaComp', () => {
  const parser = new XMLParser({ parseTagValue: false, isArray: (name) => name === 'ventaEst' });
  const xml = construirVentasEstablecimientoXML([
    { codEstab: '001', total: 1234.56, iva: 160.65 },
    { codEstab: '031', total: 111.16, iva: 16.67 },
  ]);
  const parsed = parser.parse(`<root>${xml}</root>`).root;
  assert.deepEqual(parsed.ventasEstablecimiento.ventaEst, [
    { codEstab: '001', ventasEstab: '1234.56', ivaComp: '160.65' },
    { codEstab: '031', ventasEstab: '111.16', ivaComp: '16.67' },
  ]);
});

// ─── <detalleVentas> ─────────────────────────────────────────────────────────
// Regresión del error real de DIMM (Laboratorio San José, ATS 2026-10): cada
// venta con cédula salía con tipoComprobante 01, tipoCliente y sin formas de
// cobro. Ficha Técnica ATS, módulo Ventas: tipo 18 para facturas/notas de
// venta, tipoCliente solo con pasaporte (06), forma de cobro obligatoria.
const { tipoComprobanteVentaAts, codigosFormaPagoVenta, construirDetalleVentaXML } = require('../routes/ats');

function ventaBase(extra = {}) {
  return {
    tpIdCliente: '05', idCliente: '1104301336', tipoComprobante: '18', razonSocial: 'Juan Pérez',
    count: 2, baseNoGraIva: 0, baseImponible: 25, baseImpGrav: 0, montoIva: 0,
    formasPago: new Set(['01']), ...extra,
  };
}
const parserVenta = new XMLParser({ parseTagValue: false, isArray: (n) => n === 'formaPago' });
const parsearVenta = (xml) => parserVenta.parse(`<root>${xml}</root>`).root.detalleVentas;

test('tipoComprobanteVentaAts: factura (01) y nota de venta (02) se reportan como 18; NC queda 04', () => {
  assert.equal(tipoComprobanteVentaAts('01'), '18');
  assert.equal(tipoComprobanteVentaAts('02'), '18');
  assert.equal(tipoComprobanteVentaAts('04'), '04');
});

test('codigosFormaPagoVenta usa la Tabla 13 con códigos o nombres y deduplica', () => {
  assert.deepEqual(codigosFormaPagoVenta({ pagos: [{ formaPago: '01' }, { formaPago: 'Efectivo' }, { formaPago: 'Transferencia' }] }), ['01', '20']);
  assert.deepEqual(codigosFormaPagoVenta({ pagos: JSON.stringify([{ formaPago: '19' }]) }), ['19']);
  assert.deepEqual(codigosFormaPagoVenta({ pagos: null, formaPago: 'Tarjeta de crédito' }), ['19']);
  assert.deepEqual(codigosFormaPagoVenta({}), []);
});

test('construirDetalleVentaXML con cédula: sin tipoCliente, con parteRelVtas y forma de cobro', () => {
  const v = parsearVenta(construirDetalleVentaXML(ventaBase({ formasPago: new Set(['01', '20']) })));
  assert.equal(v.tipoComprobante, '18');
  assert.equal(v.tipoCliente, undefined);
  assert.equal(v.denoCli, undefined);
  assert.equal(v.parteRelVtas, 'NO');
  assert.deepEqual(v.formasDePago.formaPago, ['01', '20']);
});

test('construirDetalleVentaXML con consumidor final (07): sin parteRelVtas ni tipoCliente; cobro 01 por defecto', () => {
  const v = parsearVenta(construirDetalleVentaXML(ventaBase({ tpIdCliente: '07', idCliente: '9999999999999', formasPago: new Set() })));
  assert.equal(v.parteRelVtas, undefined);
  assert.equal(v.tipoCliente, undefined);
  assert.deepEqual(v.formasDePago.formaPago, ['01']);
});

test('construirDetalleVentaXML con pasaporte (06): tipoCliente y denoCli limpio (solo alfanumérico)', () => {
  const v = parsearVenta(construirDetalleVentaXML(ventaBase({ tpIdCliente: '06', idCliente: 'AB123', razonSocial: 'José Ñúñez & Cía.' })));
  assert.equal(v.tipoCliente, '01');
  assert.equal(v.denoCli, 'Jose Nunez Cia');
});

test('construirDetalleVentaXML con nota de crédito (04): sin formasDePago', () => {
  const v = parsearVenta(construirDetalleVentaXML(ventaBase({ tipoComprobante: '04' })));
  assert.equal(v.tipoComprobante, '04');
  assert.equal(v.formasDePago, undefined);
});
