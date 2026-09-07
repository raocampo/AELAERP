const test = require('node:test');
const assert = require('node:assert/strict');
const { categoriaFormaPago, requiereBanco, esEfectivo } = require('../utils/formasPago');
const { validarPagosConBanco } = require('../utils/pagosVenta');

test('categoriaFormaPago clasifica los 4 vocabularios reales del sistema', () => {
  // POS-factura / FormFactura: uid interno antes de convertir a sriCodigo
  assert.equal(categoriaFormaPago({ uid: 'TRF' }), 'TRANSFERENCIA');
  assert.equal(categoriaFormaPago({ uid: 'CHQ' }), 'CHEQUE');
  assert.equal(categoriaFormaPago({ uid: 'APP' }), 'APP');
  assert.equal(categoriaFormaPago({ uid: '16' }), 'TARJETA');
  assert.equal(categoriaFormaPago({ uid: '19' }), 'TARJETA');
  assert.equal(categoriaFormaPago({ uid: '01' }), 'EFECTIVO');
  // FormFactura uid '20' ("Otros con utilización del sistema financiero")
  assert.equal(categoriaFormaPago({ uid: '20' }), 'TRANSFERENCIA');
  // Notas de venta (POS y FormNotaVenta): label humano, sin uid
  assert.equal(categoriaFormaPago({ formaPago: 'Transferencia' }), 'TRANSFERENCIA');
  assert.equal(categoriaFormaPago({ formaPago: 'Cheque' }), 'CHEQUE');
  assert.equal(categoriaFormaPago({ formaPago: 'Tarjeta débito' }), 'TARJETA');
  assert.equal(categoriaFormaPago({ formaPago: 'App Móvil' }), 'APP');
  assert.equal(categoriaFormaPago({ formaPago: 'Efectivo' }), 'EFECTIVO');
  // valor no reconocido: fail-safe a EFECTIVO (no exige banco)
  assert.equal(categoriaFormaPago({ formaPago: 'Contra Entrega' }), 'EFECTIVO');
});

test('la colisión de sriCodigo "20" entre Transferencia y Cheque se resuelve por uid', () => {
  // Ambos comparten formaPago SRI '20' en el payload real que llega al
  // backend — sin el uid serían indistinguibles.
  assert.equal(categoriaFormaPago({ formaPago: '20', uid: 'TRF' }), 'TRANSFERENCIA');
  assert.equal(categoriaFormaPago({ formaPago: '20', uid: 'CHQ' }), 'CHEQUE');
  assert.equal(requiereBanco({ formaPago: '20', uid: 'TRF' }), true);
  assert.equal(requiereBanco({ formaPago: '20', uid: 'CHQ' }), false);
});

test('requiereBanco es true solo para transferencia/tarjeta/app', () => {
  assert.equal(requiereBanco({ uid: 'TRF' }), true);
  assert.equal(requiereBanco({ uid: '19' }), true);
  assert.equal(requiereBanco({ uid: 'APP' }), true);
  assert.equal(requiereBanco({ uid: 'CHQ' }), false);
  assert.equal(requiereBanco({ uid: '01' }), false);
});

test('esEfectivo es true solo para efectivo', () => {
  assert.equal(esEfectivo({ uid: '01' }), true);
  assert.equal(esEfectivo({ formaPago: 'Efectivo' }), true);
  assert.equal(esEfectivo({ uid: 'TRF' }), false);
  assert.equal(esEfectivo({ uid: 'CHQ' }), false);
});

test('validarPagosConBanco no rechaza efectivo ni cheque sin bancoId', () => {
  assert.doesNotThrow(() => validarPagosConBanco([
    { formaPago: 'Efectivo', total: 50 },
    { uid: 'CHQ', formaPago: '20', total: 50 },
  ]));
});

test('validarPagosConBanco rechaza transferencia/tarjeta/app sin bancoId', () => {
  assert.throws(() => validarPagosConBanco([{ uid: 'TRF', formaPago: '20', total: 100 }]), /cuenta bancaria/);
  assert.throws(() => validarPagosConBanco([{ formaPago: 'Tarjeta débito', total: 100 }]), /cuenta bancaria/);
  assert.throws(() => validarPagosConBanco([{ formaPago: 'App Móvil', total: 100 }]), /cuenta bancaria/);
});

test('validarPagosConBanco pasa cuando la transferencia sí trae bancoId', () => {
  assert.doesNotThrow(() => validarPagosConBanco([{ uid: 'TRF', formaPago: '20', total: 100, bancoId: 3 }]));
});
