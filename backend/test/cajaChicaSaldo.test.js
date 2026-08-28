const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularSaldoCajaChica, gastosPendientesReponerCajaChica } = require('../utils/cajaChicaSaldo');

function mov(tipo, monto, fecha, anulado = false) {
  return { tipo, monto, fecha, anulado };
}

test('calcularSaldoCajaChica suma apertura/reposicion/incremento y resta gasto/disminucion/compra', () => {
  const movimientos = [
    mov('APERTURA', 200, '2026-01-01'),
    mov('GASTO', 30, '2026-01-05'),
    mov('COMPRA', 40, '2026-01-06'),
    mov('DISMINUCION', 10, '2026-01-07'),
    mov('REPOSICION', 70, '2026-01-10'),
    mov('INCREMENTO', 50, '2026-01-11'),
  ];
  assert.equal(calcularSaldoCajaChica(movimientos), 200 - 30 - 40 - 10 + 70 + 50);
});

test('calcularSaldoCajaChica ignora movimientos anulados', () => {
  const movimientos = [
    mov('APERTURA', 200, '2026-01-01'),
    mov('COMPRA', 999, '2026-01-05', true),
  ];
  assert.equal(calcularSaldoCajaChica(movimientos), 200);
});

test('calcularSaldoCajaChica no descuenta CIERRE', () => {
  const movimientos = [mov('APERTURA', 200, '2026-01-01'), mov('CIERRE', 200, '2026-02-01')];
  assert.equal(calcularSaldoCajaChica(movimientos), 200);
});

test('gastosPendientesReponerCajaChica incluye GASTO y COMPRA posteriores a la última reposición', () => {
  const movimientos = [
    mov('APERTURA', 200, '2026-01-01'),
    mov('GASTO', 20, '2026-01-05'),
    mov('REPOSICION', 20, '2026-01-10'),
    mov('COMPRA', 35, '2026-01-15'),
    mov('GASTO', 5, '2026-01-16'),
  ];
  const pendientes = gastosPendientesReponerCajaChica(movimientos);
  assert.equal(pendientes.length, 2);
  assert.equal(pendientes.reduce((s, m) => s + m.monto, 0), 40);
});

test('gastosPendientesReponerCajaChica excluye anulados', () => {
  const movimientos = [
    mov('APERTURA', 200, '2026-01-01'),
    mov('COMPRA', 35, '2026-01-15', true),
  ];
  assert.equal(gastosPendientesReponerCajaChica(movimientos).length, 0);
});
