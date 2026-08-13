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
