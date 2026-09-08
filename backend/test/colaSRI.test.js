const test = require('node:test');
const assert = require('node:assert/strict');
const { esErrorConectividad } = require('../utils/colaSRI');

function err(code, message = '') {
  const e = new Error(message);
  if (code) e.code = code;
  return e;
}

test('esErrorConectividad reconoce códigos de red conocidos', () => {
  assert.equal(esErrorConectividad(err('ETIMEDOUT')), true);
  assert.equal(esErrorConectividad(err('ECONNRESET')), true);
  assert.equal(esErrorConectividad(err('ENOTFOUND')), true);
});

test('esErrorConectividad reconoce SRI_RESPUESTA_NO_SOAP (HTML en vez de SOAP)', () => {
  assert.equal(esErrorConectividad(err('SRI_RESPUESTA_NO_SOAP', 'El SRI devolvió una página HTML')), true);
});

test('esErrorConectividad reconoce mensajes de red sin código', () => {
  assert.equal(esErrorConectividad(err(null, 'socket hang up')), true);
  assert.equal(esErrorConectividad(err(null, 'Error de red: timeout')), true);
});

test('esErrorConectividad NO clasifica un rechazo real de contenido como conectividad', () => {
  assert.equal(esErrorConectividad(err('ALGUN_OTRO_CODIGO', 'RUC inválido')), false);
  assert.equal(esErrorConectividad(null), false);
});
