const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { cifrar, descifrar } = require('../utils/cifrado');
const previousEnv = { actual: process.env.DB_ENCRYPT_KEY, anterior: process.env.DB_ENCRYPT_KEY_PREVIOUS };
afterEach(() => {
  for (const [name, value] of Object.entries({ DB_ENCRYPT_KEY: previousEnv.actual, DB_ENCRYPT_KEY_PREVIOUS: previousEnv.anterior })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test('la transición permite leer lo anterior y cifra únicamente con la clave nueva', () => {
  process.env.DB_ENCRYPT_KEY = crypto.randomBytes(32).toString('hex');
  const anterior = process.env.DB_ENCRYPT_KEY;
  const guardado = cifrar('credencial de prueba');
  process.env.DB_ENCRYPT_KEY = crypto.randomBytes(32).toString('hex');
  process.env.DB_ENCRYPT_KEY_PREVIOUS = anterior;
  assert.equal(descifrar(guardado), 'credencial de prueba');
  assert.throws(() => descifrar(guardado, { permitirClaveAnterior: false }));
  const migrado = cifrar(descifrar(guardado));
  delete process.env.DB_ENCRYPT_KEY_PREVIOUS;
  assert.equal(descifrar(migrado), 'credencial de prueba');
  assert.throws(() => descifrar(guardado));
});

test('no acepta credenciales alteradas aunque haya una clave anterior', () => {
  process.env.DB_ENCRYPT_KEY = crypto.randomBytes(32).toString('hex');
  process.env.DB_ENCRYPT_KEY_PREVIOUS = crypto.randomBytes(32).toString('hex');
  const partes = cifrar('prueba').split(':');
  partes[2] = (partes[2][0] === '0' ? '1' : '0') + partes[2].slice(1);
  assert.throws(() => descifrar(partes.join(':')));
});

test('rechaza claves no hexadecimales y conserva lectura de valores heredados', () => {
  process.env.DB_ENCRYPT_KEY = 'z'.repeat(64);
  assert.throws(() => cifrar('prueba'));
  assert.equal(descifrar(null), null);
  assert.equal(descifrar('heredado'), 'heredado');
});
