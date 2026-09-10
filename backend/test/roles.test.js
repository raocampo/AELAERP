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

test('rol vendedor: alias, validez y permisos acotados', () => {
  assert.equal(normalizarRol('Asesor'), 'vendedor');
  assert.equal(normalizarRol('preventista'), 'vendedor');
  assert.equal(esRolValido('vendedor'), true);
  assert.equal(obtenerRolLabel('vendedor'), 'Agente Vendedor');

  // Lo que SÍ puede
  assert.equal(tienePermiso('vendedor', 'vendedor.ver'), true);
  assert.equal(tienePermiso('vendedor', 'vendedor.pedidos'), true);
  assert.equal(tienePermiso('vendedor', 'vendedor.cobros'), true);
  assert.equal(tienePermiso('vendedor', 'productos.ver'), true);

  // Lo que NO puede (no es un rol de oficina)
  assert.equal(tienePermiso('vendedor', 'vendedor.asignar'), false); // solo supervisor/admin
  assert.equal(tienePermiso('vendedor', 'facturacion.emitir'), false);
  assert.equal(tienePermiso('vendedor', 'proformas.gestionar'), false);
  assert.equal(tienePermiso('vendedor', 'cxc.gestionar'), false);
  assert.equal(tienePermiso('vendedor', 'contabilidad.ver'), false);
  assert.equal(tienePermiso('vendedor', 'sistema.configurar'), false);

  // supervisor puede asignar clientes a vendedores
  assert.equal(tienePermiso('supervisor', 'vendedor.asignar'), true);
});
