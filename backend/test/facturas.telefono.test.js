const test = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../config/prisma');
const facturas = require('../routes/facturas');
const clientes = require('../routes/clientes');
const { fechaHoyEC } = require('../utils/fechas');

const handler = (router, method, ruta) => router.stack.find(layer => layer.route?.path === ruta && layer.route.methods[method]).route.stack.at(-1).handle;
const resNueva = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const config = { empresaId: 1, ruc: '1790012345001', razonSocial: 'EMISOR DE PRUEBA', dirMatriz: 'Loja', ambiente: 1,
  establecimiento: '001', puntoEmision: '001', tipoCertificado: 'token' };
const reqNueva = telefono => ({
  empresa: { id: 1 }, usuario: { id: 1, nombre: 'Operador de prueba' }, headers: {},
  body: { tipoIdentificacionComprador: '04', identificacionComprador: '1790012345001',
    razonSocialComprador: 'COMPRADOR DE PRUEBA', telefonoComprador: telefono, clienteId: 5,
    fechaEmision: fechaHoyEC(), detalles: [{ codigoPrincipal: 'SRV', descripcion: 'Servicio', cantidad: 1,
      precioUnitario: 100, ivaPorcentaje: 15, descuento: 0 }], pagos: [{ formaPago: '01', total: 115 }] },
});

for (const telefono of ['1'.repeat(51), { numero: '0990000000' }]) {
  test(`un teléfono inválido no reserva secuencial ni crea movimientos (${typeof telefono})`, async t => {
    t.mock.method(console, 'error', () => {});
    const accesos = [];
    const db = new Proxy({ configuracion_sri: { findFirst: async () => config } }, {
      get(target, prop) {
        accesos.push(prop);
        if (!(prop in target)) throw new Error(`Acceso no permitido: ${String(prop)}`);
        return target[prop];
      },
    });
    const res = resNueva();
    await prisma.runWithClient(db, () => handler(facturas, 'post', '/')(reqNueva(telefono), res));
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /teléfono del comprador.*hasta 50 caracteres/);
    assert.deepEqual(accesos, ['configuracion_sri']);
  });
}

test('crea la factura con los dos números completos y los conserva al enriquecer el cliente', async t => {
  const errores = [];
  t.mock.method(console, 'error', (...args) => errores.push(args));
  let guardada;
  let contacto;
  const db = {
    configuracion_sri: { findFirst: async () => config },
    puntos_emision: { findFirst: async () => ({ id: 1, ultimoSecuencialFactura: 0 }),
      update: async () => ({ ultimoSecuencialFactura: 1 }) },
    empresas: { findUnique: async () => ({ id: 1 }) },
    configuracion_sistema: { findUnique: async () => ({ inventarioHabilitado: false, cajaDiariaHabilitada: false }) },
    facturas: {
      create: async ({ data }) => { guardada = { id: 10, ...data }; return guardada; },
      update: async () => guardada,
    },
    clientes: { findUnique: async () => ({ id: 5 }), update: async ({ data }) => { contacto = data; return { id: 5, ...data }; } },
    auditoria: { create: async () => ({}) },
    $transaction: async fn => fn(db),
  };
  const res = resNueva();
  await prisma.runWithClient(db, async () => {
    await handler(facturas, 'post', '/')(reqNueva(' 0990000000; 072000000 '), res);
    await new Promise(resolve => setImmediate(resolve));
  });
  assert.equal(res.statusCode, 201);
  assert.equal(guardada.telefonoComprador, '0990000000; 072000000');
  assert.equal(contacto.telefono, guardada.telefonoComprador);
  assert.ok(guardada.xmlGenerado.includes('0990000000; 072000000'));
  assert.deepEqual(errores, []);
});

test('un P2000 restante se comunica sin mostrar la invocación interna de Prisma', async t => {
  t.mock.method(console, 'error', () => {});
  const db = { configuracion_sri: { findFirst: async () => {
    throw Object.assign(new Error('Invalid prisma.facturas.create invocation'), { code: 'P2000' });
  } } };
  const res = resNueva();
  await prisma.runWithClient(db, () => handler(facturas, 'post', '/')(reqNueva(null), res));
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /supera el tamaño permitido/);
  assert.doesNotMatch(res.body.error, /Prisma|prisma|invocation/);
});

test('crear un cliente conserva varios números también en el directorio', async () => {
  let contacto;
  let directorio;
  const db = {
    clientes: { create: async ({ data }) => { contacto = data; return { id: 5, ...data }; } },
    directorio_global: { upsert: async ({ create }) => { directorio = create; } },
  };
  const res = resNueva();
  await prisma.runWithClient(db, () => handler(clientes, 'post', '/')({ empresa: { id: 1 }, body: {
    tipoIdentificacion: '04', identificacion: '1790012345001', razonSocial: 'COMPRADOR DE PRUEBA', telefono: ' 0990000000; 072000000 ',
  } }, res));
  assert.equal(res.statusCode, 201);
  assert.equal(contacto.telefono, '0990000000; 072000000');
  assert.equal(directorio.telefono, contacto.telefono);
});

for (const method of ['post', 'put']) {
  test(`${method} clientes rechaza un teléfono demasiado largo antes de escribir`, async () => {
    const db = { clientes: { findFirst: async () => ({ id: 5 }) } };
    const res = resNueva();
    await prisma.runWithClient(db, () => handler(clientes, method, method === 'post' ? '/' : '/:id')({
      empresa: { id: 1 }, params: { id: '5' }, body: {
        tipoIdentificacion: '04', identificacion: '1790012345001', razonSocial: 'COMPRADOR DE PRUEBA', telefono: '1'.repeat(51),
      },
    }, res));
    assert.equal(res.statusCode, 400);
    assert.match(res.body.mensaje, /teléfono.*hasta 50 caracteres/);
  });
}
