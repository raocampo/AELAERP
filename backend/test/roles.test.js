const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarRol,
  esRolValido,
  obtenerRolLabel,
  tienePermiso,
} = require('../utils/roles');

test('normalizarRol resuelve aliases conocidos y usa operador por defecto', () => {
  assert.equal(normalizarRol('Administrador'), 'admin');
  assert.equal(normalizarRol(' financiero '), 'contador');
  assert.equal(normalizarRol(''), 'operador');
});

test('esRolValido reconoce roles definidos y rechaza desconocidos', () => {
  assert.equal(esRolValido('supervisor'), true);
  assert.equal(esRolValido('gerente'), true);
  assert.equal(esRolValido('desconocido'), false);
});

test('obtenerRolLabel devuelve etiquetas legibles', () => {
  assert.equal(obtenerRolLabel('admin'), 'Administrador');
  assert.equal(obtenerRolLabel('contador'), 'Contador / Financiero');
});

test('tienePermiso respeta la matriz de permisos por rol', () => {
  assert.equal(tienePermiso('contador', 'retenciones.gestionar'), true);
  assert.equal(tienePermiso('operador', 'retenciones.gestionar'), false);
  assert.equal(tienePermiso('facturador', 'facturacion.emitir'), true);
});
