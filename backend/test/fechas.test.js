const test = require('node:test');
const assert = require('node:assert/strict');
const { diaCalendarioEC, fechaHoyEC, mesAnioActualEC } = require('../utils/fechas');

test('diaCalendarioEC() sin argumento devuelve hoy en Ecuador, no "Invalid Date"', () => {
  assert.match(diaCalendarioEC(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(diaCalendarioEC(), fechaHoyEC());
});

test('diaCalendarioEC respeta un string YYYY-MM-DD tal cual', () => {
  assert.equal(diaCalendarioEC('2026-03-05'), '2026-03-05');
});

test('mesAnioActualEC devuelve números válidos', () => {
  const { anio, mes } = mesAnioActualEC();
  assert.ok(Number.isInteger(anio) && anio >= 2026);
  assert.ok(Number.isInteger(mes) && mes >= 1 && mes <= 12);
});
