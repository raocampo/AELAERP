const test = require('node:test');
const assert = require('node:assert/strict');
const sri = require('../utils/sri');

const CONFIG_BASE = {
  ruc: '1105863839001',
  ambiente: 1,
  establecimiento: '001',
  puntoEmision: '001',
  razonSocial: 'DIANA FERNANDA SUCUNUTA ALBAN',
  dirMatriz: 'CALLE PRINCIPAL',
  obligadoContabilidad: false,
};

function generarConDescripcion(descripcion) {
  const { xml } = sri.generarXMLFactura({
    fechaEmision: new Date('2026-08-12T12:00:00'),
    tipoIdentificacionComprador: '07',
    identificacionComprador: '9999999999999',
    razonSocialComprador: 'CONSUMIDOR FINAL',
    detalles: [{
      codigoPrincipal: '7861018591712',
      descripcion,
      cantidad: 1,
      precioUnitario: 1,
      descuento: 0,
      ivaPorcentaje: 15,
    }],
    pagos: [{ formaPago: 'Efectivo', total: 1.15 }],
  }, CONFIG_BASE);
  return xml.match(/<descripcion>([\s\S]*?)<\/descripcion>/)[1];
}

test('generarXMLFactura limpia saltos de línea embebidos en la descripción del detalle (error SRI 35)', () => {
  // Caso real: producto importado desde Excel con celda de texto envuelto
  // (Alt+Enter) — el SRI rechaza cualquier \n en <descripcion> con
  // "ARCHIVO NO CUMPLE ESTRUCTURA XML" (patrón XSD [^\n]*).
  const resultado = generarConDescripcion('RUFFLES TWIST LIMON\r\n38GX60X1 RM');
  assert.equal(resultado, 'RUFFLES TWIST LIMON 38GX60X1 RM');
  assert.doesNotMatch(resultado, /[\r\n]/);
});

test('generarXMLFactura no altera una descripción ya limpia', () => {
  const resultado = generarConDescripcion('COCA-COLA E 1250 GRB');
  assert.equal(resultado, 'COCA-COLA E 1250 GRB');
});

test('generarXMLFactura colapsa tabs y espacios múltiples sin perder el contenido', () => {
  const resultado = generarConDescripcion('PAPEL   HIGIENICO\tX 6 ROLLOS');
  assert.equal(resultado, 'PAPEL HIGIENICO X 6 ROLLOS');
});

function generarConCodigoPrincipal(codigoPrincipal) {
  const { xml } = sri.generarXMLFactura({
    fechaEmision: new Date('2026-08-12T12:00:00'),
    tipoIdentificacionComprador: '07',
    identificacionComprador: '9999999999999',
    razonSocialComprador: 'CONSUMIDOR FINAL',
    detalles: [{
      codigoPrincipal,
      descripcion: 'Producto de prueba',
      cantidad: 1,
      precioUnitario: 1,
      descuento: 0,
      ivaPorcentaje: 15,
    }],
    pagos: [{ formaPago: 'Efectivo', total: 1.15 }],
  }, CONFIG_BASE);
  return xml.match(/<codigoPrincipal>([\s\S]*?)<\/codigoPrincipal>/)[1];
}

test('generarXMLFactura limpia saltos de línea embebidos en codigoPrincipal (error SRI 35, caso real tenant sys 2026-08-24)', () => {
  // Caso real: código de barras con un \r\n insertado en medio ("899900269
  // \r\n6514", debía ser "8999002696514") — el SRI rechazó con el mismo
  // error 35 que ya se había corregido para <descripcion>, pero
  // codigoPrincipal nunca pasaba por el mismo saneo.
  const resultado = generarConCodigoPrincipal('899900269\r\n6514');
  assert.equal(resultado, '899900269 6514');
  assert.doesNotMatch(resultado, /[\r\n]/);
});

test('generarXMLFactura no altera un codigoPrincipal ya limpio', () => {
  const resultado = generarConCodigoPrincipal('7861018591712');
  assert.equal(resultado, '7861018591712');
});

test('generarXMLFactura declara totalImpuesto para detalles No Objeto (6) y Exento (7) de IVA', () => {
  // Antes de este fix, un detalle con ivaPorcentaje 6/7 quedaba incluido en
  // totalSinImpuestos pero SIN su propio bloque <totalImpuesto> en la
  // cabecera — la suma de baseImponible ahí no cuadraba con
  // totalSinImpuestos para ninguna factura con estas tarifas. Tampoco se
  // usaba nunca en producción hasta ahora (0 facturas reales con estas
  // tarifas), pero el formulario ya las ofrece.
  const { xml, totales } = sri.generarXMLFactura({
    fechaEmision: new Date('2026-08-15T12:00:00'),
    tipoIdentificacionComprador: '05',
    identificacionComprador: '1105863847',
    razonSocialComprador: 'CLIENTE PRUEBA',
    detalles: [
      { codigoPrincipal: 'A', descripcion: 'Producto tarifa 0%', cantidad: 1, precioUnitario: 10, descuento: 0, ivaPorcentaje: 0 },
      { codigoPrincipal: 'B', descripcion: 'Servicio no objeto de IVA', cantidad: 1, precioUnitario: 20, descuento: 0, ivaPorcentaje: 6 },
      { codigoPrincipal: 'C', descripcion: 'Producto exento de IVA', cantidad: 1, precioUnitario: 30, descuento: 0, ivaPorcentaje: 7 },
      { codigoPrincipal: 'D', descripcion: 'Producto gravado 15%', cantidad: 1, precioUnitario: 100, descuento: 0, ivaPorcentaje: 15 },
    ],
    pagos: [{ formaPago: 'Efectivo', total: 175 }],
  }, CONFIG_BASE);

  // totales.subtotalNoObjetoIva combina 6+7 (20+30=50) — un solo campo en
  // facturas/ATS de ventas, ver comentario en generarXMLFactura.
  assert.equal(totales.subtotalNoObjetoIva, 50);

  const cab = xml.match(/<totalConImpuestos>([\s\S]*?)<\/totalConImpuestos>/)[1];
  assert.match(cab, /<codigoPorcentaje>6<\/codigoPorcentaje>\s*<baseImponible>20\.00<\/baseImponible>/);
  assert.match(cab, /<codigoPorcentaje>7<\/codigoPorcentaje>\s*<baseImponible>30\.00<\/baseImponible>/);

  // La suma de baseImponible de la cabecera debe cuadrar con totalSinImpuestos
  // (regla de validación del SRI) — 10 + 20 + 30 + 100 = 160.
  const sumaBases = [...cab.matchAll(/<baseImponible>([\d.]+)<\/baseImponible>/g)]
    .reduce((s, m) => s + parseFloat(m[1]), 0);
  const totalSinImpuestos = parseFloat(xml.match(/<totalSinImpuestos>([\d.]+)<\/totalSinImpuestos>/)[1]);
  assert.equal(sumaBases.toFixed(2), totalSinImpuestos.toFixed(2));
  assert.equal(totalSinImpuestos, 160);
});

test('generarXMLFactura usa el código de porcentaje real (no "0") en el detalle para No Objeto/Exento', () => {
  // IVA_CODIGO tenía las claves 'noObjeto'/'exento' (string) pero el resto
  // del código siempre busca por el valor numérico de ivaPorcentaje — esas
  // claves nunca se alcanzaban y el detalle caía siempre a codigoPorcentaje '0'.
  const { xml } = sri.generarXMLFactura({
    fechaEmision: new Date('2026-08-15T12:00:00'),
    tipoIdentificacionComprador: '07',
    identificacionComprador: '9999999999999',
    razonSocialComprador: 'CONSUMIDOR FINAL',
    detalles: [
      { codigoPrincipal: 'B', descripcion: 'Servicio no objeto de IVA', cantidad: 1, precioUnitario: 20, descuento: 0, ivaPorcentaje: 6 },
    ],
    pagos: [{ formaPago: 'Efectivo', total: 20 }],
  }, CONFIG_BASE);

  const detalle = xml.match(/<detalle>([\s\S]*?)<\/detalle>/)[1];
  assert.match(detalle, /<codigoPorcentaje>6<\/codigoPorcentaje>/);
});
