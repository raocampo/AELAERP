const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularResumenDesdeMovimientos } = require('../utils/caja');

function mov(tipo, monto, esEfectivo = true, categoria = null) {
  return { tipo, monto, esEfectivo, categoria };
}

test('venta en efectivo suma a totalEsperado y a totalVentas', () => {
  const caja = { montoApertura: 50 };
  const movimientos = [mov('VENTA_FACTURA', 100, true, 'Efectivo')];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalVentas, 100);
  assert.equal(r.totalEsperado, 150);
});

test('venta con transferencia suma solo a totalVentas, no a totalEsperado', () => {
  const caja = { montoApertura: 50 };
  const movimientos = [mov('VENTA_FACTURA', 100, false, 'TRF')];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalVentas, 100);
  assert.equal(r.totalEsperado, 50);
});

test('venta mixta (una línea efectivo + una línea transferencia) reparte correctamente', () => {
  const caja = { montoApertura: 0 };
  const movimientos = [
    mov('VENTA_NOTA', 30, true, 'Efectivo'),
    mov('VENTA_NOTA', 70, false, 'Transferencia'),
  ];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalVentas, 100);
  assert.equal(r.totalEsperado, 30);
});

test('anulación de una venta con transferencia no mueve totalEsperado', () => {
  const caja = { montoApertura: 50 };
  const movimientos = [
    mov('VENTA_FACTURA', 100, false, 'TRF'),
    mov('ANULACION_FACTURA', 100, false, 'TRF'),
  ];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalVentas, 0);
  assert.equal(r.totalEsperado, 50);
});

test('anulación de una venta en efectivo reduce totalEsperado', () => {
  const caja = { montoApertura: 50 };
  const movimientos = [
    mov('VENTA_NOTA', 100, true, 'Efectivo'),
    mov('ANULACION_NOTA', 100, true, 'Efectivo'),
  ];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalVentas, 0);
  assert.equal(r.totalEsperado, 50);
});

test('INGRESO/EGRESO manuales siguen afectando totalEsperado igual que antes', () => {
  const caja = { montoApertura: 100 };
  const movimientos = [
    { tipo: 'INGRESO', monto: 20 },
    { tipo: 'EGRESO', monto: 5 },
  ];
  const r = calcularResumenDesdeMovimientos(caja, movimientos);
  assert.equal(r.totalEsperado, 115);
});
