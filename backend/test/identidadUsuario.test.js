const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarLogin,
  normalizarEmail,
  esUsernameValido,
  esEmailValido,
  mensajeDuplicidadUsuario,
} = require('../utils/identidadUsuario');

test('normalizarLogin limpia espacios y convierte a minúsculas', () => {
  assert.equal(normalizarLogin('  Admin.User  '), 'admin.user');
});

test('normalizarEmail devuelve null cuando llega vacío', () => {
  assert.equal(normalizarEmail('   '), null);
});

test('esUsernameValido acepta formatos permitidos y rechaza inválidos', () => {
  assert.equal(esUsernameValido('usuario.demo'), true);
  assert.equal(esUsernameValido('ab'), false);
  assert.equal(esUsernameValido('usuario con espacios'), false);
});

test('esEmailValido acepta correos válidos y rechaza formatos incorrectos', () => {
  assert.equal(esEmailValido('demo@correo.com'), true);
  assert.equal(esEmailValido('correo-invalido'), false);
  assert.equal(esEmailValido(''), true);
});

test('mensajeDuplicidadUsuario detecta duplicidad por usuario, correo o genérico', () => {
  assert.equal(
    mensajeDuplicidadUsuario({ meta: { target: ['username'] } }),
    'El usuario ya está registrado'
  );
  assert.equal(
    mensajeDuplicidadUsuario({ meta: { target: ['email'] } }),
    'El correo ya está registrado'
  );
  assert.equal(
    mensajeDuplicidadUsuario({ meta: { target: ['otroCampo'] } }),
    'Ya existe un registro con esos datos'
  );
});
