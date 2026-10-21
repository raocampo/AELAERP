const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarTelefonoContacto } = require('../utils/telefonoContacto');

test('conserva los dos teléfonos de un contacto sin recortarlos ni juntar sus dígitos', () => {
  assert.equal(normalizarTelefonoContacto(' 0990000000; 072000000 '), '0990000000; 072000000');
  assert.equal(normalizarTelefonoContacto('+593 99 000 0000 ext. 123'), '+593 99 000 0000 ext. 123');
});

test('permite hasta 50 caracteres y rechaza 51 con un mensaje comprensible', () => {
  assert.equal(normalizarTelefonoContacto('1'.repeat(50)), '1'.repeat(50));
  assert.throws(() => normalizarTelefonoContacto('1'.repeat(51)), {
    code: 'TELEFONO_CONTACTO_INVALIDO', message: /hasta 50 caracteres/,
  });
});

test('un teléfono opcional vacío se guarda como null y no acepta objetos', () => {
  for (const valor of [undefined, null, '', '   ']) assert.equal(normalizarTelefonoContacto(valor), null);
  for (const valor of [{}, [], 990000000]) {
    assert.throws(() => normalizarTelefonoContacto(valor), { code: 'TELEFONO_CONTACTO_INVALIDO' });
  }
});
