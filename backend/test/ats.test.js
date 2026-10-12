const test = require('node:test');
const assert = require('node:assert/strict');
const { tipoIdProveedorAts } = require('../routes/ats');

test('tipoIdProveedorAts convierte el catálogo de comprobantes (04/05/06) al de ATS-compras (01/02/03)', () => {
  assert.equal(tipoIdProveedorAts('04'), '01'); // RUC
  assert.equal(tipoIdProveedorAts('05'), '02'); // Cédula
  assert.equal(tipoIdProveedorAts('06'), '03'); // Pasaporte
});

test('tipoIdProveedorAts deja pasar un código que ya viene en el catálogo del ATS', () => {
  assert.equal(tipoIdProveedorAts('01'), '01');
  assert.equal(tipoIdProveedorAts('02'), '02');
  assert.equal(tipoIdProveedorAts('03'), '03');
});

test('tipoIdProveedorAts usa RUC (01) como default seguro ante un código vacío o desconocido', () => {
  assert.equal(tipoIdProveedorAts(''), '01');
  assert.equal(tipoIdProveedorAts(null), '01');
  assert.equal(tipoIdProveedorAts(undefined), '01');
  assert.equal(tipoIdProveedorAts('07'), '01'); // 07=Consumidor Final no aplica a compras
});
