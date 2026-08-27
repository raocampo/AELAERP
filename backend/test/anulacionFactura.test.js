const test = require('node:test');
const assert = require('node:assert/strict');
const { requiereNCAutomaticaPorVentana } = require('../utils/anulacionFactura');

test('dentro de la ventana libre (mismo mes) no fuerza NC', () => {
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-08-15', new Date(2026, 7, 20)),
    false,
  );
});

test('día 6 del mes siguiente todavía dentro de la ventana libre', () => {
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-08-15', new Date(2026, 8, 6, 23, 59)),
    false,
  );
});

test('día 7 del mes siguiente ya fuerza NC automática', () => {
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-08-15', new Date(2026, 8, 7, 0, 0)),
    true,
  );
});

test('caso del usuario: factura del 15 de agosto anulada el 8 de septiembre fuerza NC', () => {
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-08-15', new Date(2026, 8, 8)),
    true,
  );
});

test('respeta el cruce de año (diciembre -> enero)', () => {
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-12-20', new Date(2027, 0, 6)),
    false,
  );
  assert.equal(
    requiereNCAutomaticaPorVentana('2026-12-20', new Date(2027, 0, 7)),
    true,
  );
});

test('fecha de emisión inválida fuerza NC por seguridad', () => {
  assert.equal(requiereNCAutomaticaPorVentana('no-es-fecha'), true);
});
