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

test('esErrorConectividad reconoce SRI_REDIRECT (3xx desde el WS del SRI)', () => {
  assert.equal(esErrorConectividad(err('SRI_REDIRECT', 'El SRI respondió con una redirección (HTTP 302 -> https://181.113.227.222/)')), true);
});

test('esErrorConectividad reconoce el error de TLS cuando el SRI redirige a una IP', () => {
  // Caso real de producción 2026-09-10: el SRI redirige a 181.113.227.222
  // y el cert de esa IP no la cubre.
  assert.equal(esErrorConectividad(err('ERR_TLS_CERT_ALTNAME_INVALID')), true);
  assert.equal(esErrorConectividad(err(null, "Error de red al contactar el SRI: Hostname/IP does not match certificate's altnames: IP: 181.113.227.222 is not in the cert's list:")), true);
});

test('esErrorConectividad reconoce un HTTP 500/503 del SRI (su server caído)', () => {
  // Caso real 2026-09-10: factura 002-002-000000208 volvió a ERROR con
  // "Servicio SRI no disponible (HTTP 500)".
  assert.equal(esErrorConectividad(err('SRI_HTTP_NO_OK', 'El SRI respondió HTTP 500 — problema temporal de su servicio')), true);
  assert.equal(esErrorConectividad(err(null, 'Servicio SRI no disponible (HTTP 500)')), true);
  assert.equal(esErrorConectividad(err(null, 'El SRI respondió HTTP 503 — problema temporal de su servicio')), true);
});

test('esErrorConectividad reconoce mensajes de red sin código', () => {
  assert.equal(esErrorConectividad(err(null, 'socket hang up')), true);
  assert.equal(esErrorConectividad(err(null, 'Error de red: timeout')), true);
});

test('esErrorConectividad NO clasifica un rechazo real de contenido como conectividad', () => {
  assert.equal(esErrorConectividad(err('ALGUN_OTRO_CODIGO', 'RUC inválido')), false);
  assert.equal(esErrorConectividad(null), false);
});
