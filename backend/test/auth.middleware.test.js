const test = require('node:test');
const assert = require('node:assert/strict');
const {
  proteger,
  soloAdmin,
  adminOContador,
  autorizarRoles,
  autorizarPermiso,
} = require('../middleware/auth');

function crearRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('proteger responde 401 cuando no hay token', async () => {
  const res = crearRes();

  await proteger({ headers: {} }, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.match(res.body.mensaje, /token no proporcionado/i);
});

test('soloAdmin permite admin y bloquea operador', () => {
  let nextCalls = 0;

  soloAdmin({ usuario: { rol: 'admin' } }, crearRes(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);

  const res = crearRes();
  soloAdmin({ usuario: { rol: 'operador' } }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('adminOContador acepta admin y contador', () => {
  let autorizado = 0;
  adminOContador({ usuario: { rol: 'admin' } }, crearRes(), () => { autorizado += 1; });
  adminOContador({ usuario: { rol: 'contador' } }, crearRes(), () => { autorizado += 1; });
  assert.equal(autorizado, 2);
});

test('autorizarRoles valida presencia de usuario y roles permitidos', () => {
  const middleware = autorizarRoles('admin', 'supervisor');

  const resNoAuth = crearRes();
  middleware({}, resNoAuth, () => {});
  assert.equal(resNoAuth.statusCode, 401);

  let autorizado = false;
  middleware({ usuario: { rol: 'Supervisor' } }, crearRes(), () => { autorizado = true; });
  assert.equal(autorizado, true);

  const resBloqueado = crearRes();
  middleware({ usuario: { rol: 'operador' } }, resBloqueado, () => {});
  assert.equal(resBloqueado.statusCode, 403);
});

test('autorizarPermiso respeta la matriz de permisos por rol', () => {
  const middleware = autorizarPermiso('retenciones.gestionar');

  let autorizado = false;
  middleware({ usuario: { rol: 'contador' } }, crearRes(), () => { autorizado = true; });
  assert.equal(autorizado, true);

  const resBloqueado = crearRes();
  middleware({ usuario: { rol: 'operador' } }, resBloqueado, () => {});
  assert.equal(resBloqueado.statusCode, 403);
  assert.match(resBloqueado.body.mensaje, /no tiene permiso/i);
});
