const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularTotales, formatNumero } = require('../utils/proformas');

// Extraído de routes/proformas.js en la Fase 2 del módulo Agente Vendedor
// (backend/routes/vendedor.js también lo usa para el wrapper de pedidos) —
// mismo cálculo que ya corría en producción, ahora con cobertura propia.

test('calcularTotales reparte subtotales por tarifa de IVA (0/5/15) y suma el IVA', () => {
  const detalles = [
    { cantidad: 2, precioUnitario: 10, descuento: 0, ivaPorcentaje: 15 }, // 20, iva 3
    { cantidad: 1, precioUnitario: 5,  descuento: 0, ivaPorcentaje: 0 },  // 5
    { cantidad: 3, precioUnitario: 4,  descuento: 2, ivaPorcentaje: 5 },  // 10, iva 0.5
  ];
  const t = calcularTotales(detalles);
  assert.equal(t.subtotal0, 5);
  assert.equal(t.subtotal5, 10);
  assert.equal(t.subtotal15, 20);
  assert.equal(t.totalDescuento, 2);
  assert.equal(t.totalIva, 3.5);
  assert.equal(t.importeTotal, 38.5);
});

test('calcularTotales tolera un arreglo vacío', () => {
  const t = calcularTotales([]);
  assert.equal(t.importeTotal, 0);
  assert.equal(t.totalIva, 0);
});

test('formatNumero rellena el secuencial a 9 dígitos con el prefijo PRF-001-', () => {
  assert.equal(formatNumero(1), 'PRF-001-000000001');
  assert.equal(formatNumero(123456789), 'PRF-001-123456789');
});
