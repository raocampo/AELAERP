const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularRebajaGastosPersonales } = require('../utils/rebajaGastosPersonales');

// Tabla oficial: Boletín SRI NAC-COM-26-006 (6 de febrero de 2026).
// cargas -> [canastas, topeGastos, topeRebaja]
const TABLA_OFICIAL = [
  [0, 7, 5752.60, 1035.47],
  [1, 9, 7396.20, 1331.32],
  [2, 11, 9039.80, 1627.16],
  [3, 14, 11505.20, 2070.94],
  [4, 17, 13970.60, 2514.71],
  [5, 20, 16436.00, 2958.48],
];

test('calcularRebajaGastosPersonales reproduce exacto la tabla oficial de topes por cargas familiares (gasto = tope)', () => {
  for (const [cargas, canastas, topeGastos, topeRebaja] of TABLA_OFICIAL) {
    const r = calcularRebajaGastosPersonales({ gastosPersonalesProyectados: 999999, cargasFamiliares: cargas });
    assert.equal(r.canastas, canastas, `cargas=${cargas}`);
    assert.equal(r.topeGastos, topeGastos, `cargas=${cargas}`);
    assert.equal(r.rebaja, topeRebaja, `cargas=${cargas}`);
  }
});

test('calcularRebajaGastosPersonales — discapacidad/enfermedad catastrófica usa 100 canastas ($82,180.00 tope, $14,792.40 rebaja)', () => {
  const r = calcularRebajaGastosPersonales({
    gastosPersonalesProyectados: 999999,
    cargasFamiliares: 0,
    tieneDiscapacidadOEnfermedadCatastrofica: true,
  });
  assert.equal(r.canastas, 100);
  assert.equal(r.topeGastos, 82180.00);
  assert.equal(r.rebaja, 14792.40);
});

test('calcularRebajaGastosPersonales usa el gasto real cuando es menor que el tope', () => {
  const r = calcularRebajaGastosPersonales({ gastosPersonalesProyectados: 1000, cargasFamiliares: 0 });
  assert.equal(r.gastosConsiderados, 1000);
  assert.equal(r.rebaja, 180); // 18% de 1000
});

test('calcularRebajaGastosPersonales — 6 o más cargas familiares sigue usando el tramo "5 o más" (20 canastas)', () => {
  const r = calcularRebajaGastosPersonales({ gastosPersonalesProyectados: 999999, cargasFamiliares: 8 });
  assert.equal(r.canastas, 20);
});

test('calcularRebajaGastosPersonales nunca da rebaja negativa con gastos en 0', () => {
  const r = calcularRebajaGastosPersonales({ gastosPersonalesProyectados: 0, cargasFamiliares: 2 });
  assert.equal(r.rebaja, 0);
});
