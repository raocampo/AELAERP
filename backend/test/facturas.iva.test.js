const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../routes/facturas');
const prisma = require('../config/prisma');
const { fechaHoyEC } = require('../utils/fechas');

const handler = (ruta) => router.stack.find((layer) => layer.route?.path === ruta && layer.route.methods.post).route.stack.at(-1).handle;
const crearRes = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});
const detalles = [{ codigoPrincipal: 'LEGADO12', descripcion: 'Producto antiguo', cantidad: 1, precioUnitario: 100, descuento: 0, ivaPorcentaje: 12 }];

test('POST facturas rechaza IVA 12% actual antes de consumir secuencial o registrar movimientos', async (t) => {
  t.mock.method(console, 'error', () => {});
  const accesos = [];
  const db = new Proxy({
    configuracion_sri: { findFirst: async () => ({ negocioPopular: false }) },
  }, {
    get(target, propiedad) {
      accesos.push(propiedad);
      if (!(propiedad in target)) throw new Error(`Acceso no permitido: ${String(propiedad)}`);
      return target[propiedad];
    },
  });
  const req = {
    empresa: { id: 1 },
    body: { detalles, fechaEmision: fechaHoyEC(), tipoIdentificacionComprador: '07', identificacionComprador: '9999999999999', razonSocialComprador: 'CONSUMIDOR FINAL' },
  };
  const res = crearRes();
  await prisma.runWithClient(db, () => handler('/')(req, res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /LEGADO12.*IVA 12%.*no vigente/);
  assert.deepEqual(accesos, ['configuracion_sri']);
});

for (const [formato, almacenados] of [['JSON', detalles], ['string legado', JSON.stringify(detalles)]]) {
  test(`reenviar una factura rechazada con IVA no vigente no llama al SRI ni modifica datos (${formato})`, async () => {
    const accesos = [];
    const db = new Proxy({
      facturas: {
        findFirst: async ({ where }) => {
          assert.deepEqual(where, { id: 10, empresaId: 1 });
          return { id: 10, estadoSri: 'RECHAZADO', fechaEmision: new Date('2026-10-16T00:00:00Z'), detalles: almacenados };
        },
      },
    }, {
      get(target, propiedad) {
        accesos.push(propiedad);
        if (!(propiedad in target)) throw new Error(`Acceso no permitido: ${String(propiedad)}`);
        return target[propiedad];
      },
    });
    const res = crearRes();
    await prisma.runWithClient(db, () => handler('/:id/reenviar')({ empresa: { id: 1 }, params: { id: '10' } }, res));
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /IVA 12%.*Anula localmente.*mismo XML/);
    assert.deepEqual(accesos, ['facturas']);
  });
}
