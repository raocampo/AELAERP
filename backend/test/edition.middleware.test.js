const test = require('node:test');
const assert = require('node:assert/strict');
const {
  obtenerPlan,
  soloMediumOPro,
  soloPro,
  soloMono,
} = require('../middleware/edition');

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

test('obtenerPlan normaliza full y usa pro como fallback seguro', () => {
  assert.equal(obtenerPlan({ empresa: { plan: 'full' } }), 'pro');
  assert.equal(obtenerPlan({ empresa: { plan: 'medium' } }), 'medium');
  assert.equal(obtenerPlan({ empresa: { plan: 'desconocido' } }), 'pro');
});

test('soloMediumOPro bloquea Lite y permite Medium/Pro', () => {
  const resLite = crearRes();
  let nextCalls = 0;

  soloMediumOPro({ empresa: { plan: 'lite' } }, resLite, () => { nextCalls += 1; });
  assert.equal(resLite.statusCode, 403);
  assert.equal(resLite.body.plan, 'lite');
  assert.equal(nextCalls, 0);

  const resPro = crearRes();
  soloMediumOPro({ empresa: { plan: 'pro' } }, resPro, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
});

test('soloPro bloquea Lite y Medium, y deja pasar Pro', () => {
  const resMedium = crearRes();
  let autorizado = false;

  soloPro({ empresa: { plan: 'medium' } }, resMedium, () => { autorizado = true; });
  assert.equal(resMedium.statusCode, 403);
  assert.equal(resMedium.body.plan, 'medium');
  assert.equal(autorizado, false);

  soloPro({ empresa: { plan: 'pro' } }, crearRes(), () => { autorizado = true; });
  assert.equal(autorizado, true);
});

test('soloMono exige Pro cuando el modo global es multiempresa', () => {
  const originalModo = process.env.MODO_EMPRESA;
  process.env.MODO_EMPRESA = 'multi';

  const resLite = crearRes();
  let autorizado = false;
  soloMono({ empresa: { plan: 'lite' } }, resLite, () => { autorizado = true; });
  assert.equal(resLite.statusCode, 403);
  assert.equal(autorizado, false);

  const resPro = crearRes();
  soloMono({ empresa: { plan: 'pro' } }, resPro, () => { autorizado = true; });
  assert.equal(autorizado, true);

  process.env.MODO_EMPRESA = originalModo;
});
