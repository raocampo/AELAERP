const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const prisma = require('../config/prisma');
const sri = require('../utils/sri');
const email = require('../utils/email');
const contabilidad = require('../utils/contabilidad');
const { ejecutarCiclo } = require('../utils/colaSRI');

function escenario(t, opciones = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const masterUrl = process.env.DATABASE_MASTER_URL;
  delete process.env.DATABASE_MASTER_URL;
  t.after(() => {
    if (masterUrl === undefined) delete process.env.DATABASE_MASTER_URL;
    else process.env.DATABASE_MASTER_URL = masterUrl;
  });
  const errores = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', (...args) => errores.push(args));

  const factura = {
    id: 1, empresaId: 7, emisorId: 2, estadoSri: 'FIRMADO_PENDIENTE_ENVIO', anulada: false,
    numeroFactura: '002-001-000000001', claveAcceso: '1'.repeat(49),
    xmlGenerado: '<factura/>', xmlFirmado: opciones.modo === 'sin-firma' ? null : '<firmado/>',
    fechaEmision: new Date('2026-10-20T05:00:00Z'), fechaAutorizacion: null,
    emailComprador: opciones.correo === undefined ? ' comprador@example.com ' : opciones.correo,
    razonSocialEmisor: 'EMISOR DE PRUEBA', razonSocialComprador: 'COMPRADOR DE PRUEBA',
    importeTotal: '115.00',
    detalles: [{ codigoPrincipal: 'P1', descripcion: 'Servicio', cantidad: 1, precioUnitario: 100, descuento: 0, ivaPorcentaje: 15 }],
    pagos: [{ formaPago: '01', total: '115.00' }],
  };
  const filas = [factura];
  const configs = new Map([[7, {
    empresaId: 7, ambiente: 2, tipoCertificado: 'archivo',
    certificadoP12Data: Buffer.from('certificado de prueba').toString('base64'),
    nombreComercial: 'EMPRESA SIETE', logoUrl: 'logo-siete',
  }]]);
  const autorizacion = {
    autorizado: true, estado: 'AUTORIZADO', numeroAutorizacion: '2'.repeat(49),
    fechaAutorizacion: new Date('2026-10-20T12:00:00Z'), xmlAutorizado: '<autorizado/>',
  };
  const enviados = [];
  const rides = [];
  const cambios = [];
  let consultasSri = 0;
  const db = {
    configuracion_sri: {
      findFirst: async ({ where }) => {
        assert.equal(where.activo, true);
        return configs.get(where.empresaId);
      },
    },
    facturas: {
      findMany: async ({ where, select }) => filas
        .filter(f => f.estadoSri === where.estadoSri)
        .map(f => select ? Object.fromEntries(Object.keys(select).map(k => [k, f[k]])) : { ...f }),
      findFirst: async ({ where }) => filas.find(f => f.id === where.id && f.empresaId === where.empresaId),
      findUnique: async ({ where }) => ({ ...filas.find(f => f.id === where.id) }),
      updateMany: async ({ where, data }) => {
        assert.equal(where.anulada, false);
        assert.deepEqual(where.estadoSri, { not: 'AUTORIZADO' });
        const fila = filas.find(f => f.id === where.id && f.empresaId === where.empresaId);
        if (opciones.competidor === data.estadoSri) fila.estadoSri = 'AUTORIZADO';
        if (fila.anulada || fila.estadoSri === 'AUTORIZADO') return { count: 0 };
        Object.assign(fila, data);
        cambios.push(data);
        return { count: 1 };
      },
    },
    retenciones: { findMany: async () => [] },
    liquidaciones_compra: { findMany: async () => [] },
    notas_debito: { findMany: async () => [] },
    notas_credito: { findMany: async () => [] },
  };
  t.mock.method(sri, 'firmarXML', () => '<firmado/>');
  t.mock.method(sri, 'enviarComprobanteSRI', async () => {
    consultasSri++;
    return opciones.rechazo ? { estado: 'DEVUELTA', mensajes: [{ identificador: '43' }] } : { estado: 'RECIBIDA' };
  });
  t.mock.method(sri, 'autorizarComprobanteSRI', async () => {
    consultasSri++;
    if (opciones.modo === 'reenviada' && consultasSri === 1) {
      return { autorizado: false, mensajes: [{ mensaje: 'Comprobante no encontrado' }] };
    }
    return autorizacion;
  });
  t.mock.method(sri, 'generarRIDEFactura', async (datos, config, pdfPath) => {
    rides.push({ datos, config, pdfPath });
  });
  t.mock.method(contabilidad, 'crearAsientoFacturaAutorizada', async () => {});
  t.mock.method(contabilidad, 'crearAsientoCostoVentaFactura', async () => {});
  t.mock.method(email, 'enviarDocumentoFiscal', async datos => {
    const fila = filas.find(f => f.numeroFactura === datos.numero);
    assert.equal(fila.estadoSri, 'AUTORIZADO');
    assert.ok(rides.some(r => r.pdfPath === datos.pdfPath));
    enviados.push(datos);
    if (opciones.falloCorreo) throw new Error('Proveedor no disponible');
  });
  return { db, factura, filas, configs, autorizacion, enviados, rides, errores, cambios,
    consultasSri: () => consultasSri, ejecutar: () => prisma.runWithClient(db, ejecutarCiclo) };
}

for (const modo of ['directa', 'reenviada', 'sin-firma']) {
  test(`cola SRI envía la factura y el RIDE completos después de autorizar (${modo})`, async t => {
    const e = escenario(t, { modo });
    await e.ejecutar();
    assert.equal(e.factura.estadoSri, 'AUTORIZADO');
    assert.equal(e.enviados.length, 1);
    assert.deepEqual(e.enviados[0], {
      tipo: 'FACTURA', numero: e.factura.numeroFactura, email: 'comprador@example.com',
      pdfPath: path.join(__dirname, '..', 'uploads', 'facturas', 'factura-1.pdf'),
      razonSocialEmisor: e.factura.razonSocialEmisor, nombreComercialEmisor: 'EMPRESA SIETE', logoUrl: 'logo-siete',
      razonSocialComprador: e.factura.razonSocialComprador, fecha: e.factura.fechaEmision,
      total: '115.00', claveAcceso: e.factura.claveAcceso, numeroAutorizacion: e.autorizacion.numeroAutorizacion,
    });
    assert.deepEqual(e.rides[0].datos.detalles, e.factura.detalles);
    assert.deepEqual(e.rides[0].datos.pagos, e.factura.pagos);
    assert.equal(e.rides[0].datos.numeroFactura, e.factura.numeroFactura);
    assert.equal(e.rides[0].datos.numeroAutorizacion, e.autorizacion.numeroAutorizacion);
    assert.equal(e.rides[0].datos.fechaAutorizacion, e.autorizacion.fechaAutorizacion);
    assert.deepEqual(e.errores, []);
    await e.ejecutar();
    assert.equal(e.enviados.length, 1, 'Otro ciclo no reenvía una factura ya autorizada');
  });
}

for (const correo of [null, '   ']) {
  test(`cola SRI autoriza sin enviar cuando no hay destinatario (${JSON.stringify(correo)})`, async t => {
    const e = escenario(t, { correo });
    await e.ejecutar();
    assert.equal(e.factura.estadoSri, 'AUTORIZADO');
    assert.equal(e.enviados.length, 0);
    assert.deepEqual(e.errores, []);
  });
}

test('un fallo de correo conserva la autorización y no reencola el documento fiscal', async t => {
  const e = escenario(t, { falloCorreo: true });
  await e.ejecutar();
  assert.equal(e.factura.estadoSri, 'AUTORIZADO');
  assert.equal(e.enviados.length, 1);
  assert.equal(e.errores.length, 1);
  assert.match(e.errores[0].join(' '), /email.*Proveedor no disponible/);
  await e.ejecutar();
  assert.equal(e.enviados.length, 1);
});

for (const modo of ['directa', 'reenviada']) {
  test(`una autorización concurrente no duplica el correo (${modo})`, async t => {
    const e = escenario(t, { modo, competidor: 'AUTORIZADO' });
    await e.ejecutar();
    assert.equal(e.factura.estadoSri, 'AUTORIZADO');
    assert.equal(e.enviados.length, 0);
    assert.deepEqual(e.errores, []);
  });
}

test('no vuelve a enviar al SRI si otro proceso autorizó antes de guardar la firma', async t => {
  const e = escenario(t, { modo: 'sin-firma', competidor: 'ENVIADO' });
  await e.ejecutar();
  assert.equal(e.factura.estadoSri, 'AUTORIZADO');
  assert.equal(e.consultasSri(), 0);
  assert.equal(e.enviados.length, 0);
  assert.deepEqual(e.errores, []);
});

test('un rechazo del SRI no envía el documento al comprador', async t => {
  const e = escenario(t, { modo: 'sin-firma', rechazo: true });
  await e.ejecutar();
  assert.equal(e.factura.estadoSri, 'RECHAZADO');
  assert.equal(e.enviados.length, 0);
  assert.equal(e.rides.length, 0);
});

test('en multiempresa conserva el destinatario y la marca de cada empresa', async t => {
  const e = escenario(t);
  e.filas.push({ ...e.factura, id: 2, empresaId: 8, numeroFactura: '003-001-000000002',
    razonSocialEmisor: 'OTRO EMISOR', emailComprador: 'otro@example.com' });
  e.configs.set(8, { ...e.configs.get(7), empresaId: 8, nombreComercial: 'EMPRESA OCHO', logoUrl: 'logo-ocho' });
  await e.ejecutar();
  assert.deepEqual(e.enviados.map(f => [f.numero, f.email, f.nombreComercialEmisor, f.razonSocialEmisor]), [
    ['002-001-000000001', 'comprador@example.com', 'EMPRESA SIETE', 'EMISOR DE PRUEBA'],
    ['003-001-000000002', 'otro@example.com', 'EMPRESA OCHO', 'OTRO EMISOR'],
  ]);
  assert.deepEqual(e.errores, []);
});

test('el reenvío manual tampoco notifica si la cola ya completó la autorización', async t => {
  const e = escenario(t, { competidor: 'AUTORIZADO' });
  const router = require('../routes/facturas');
  t.after(() => { delete require.cache[require.resolve('../routes/facturas')]; });
  const handler = router.stack.find(layer => layer.route?.path === '/:id/reenviar' && layer.route.methods.post).route.stack.at(-1).handle;
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await prisma.runWithClient(e.db, () => handler({ empresa: { id: 7 }, params: { id: '1' } }, res));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.data.estadoSri, 'AUTORIZADO');
  assert.equal(e.enviados.length, 0);
  assert.deepEqual(e.errores, []);
});

test('la autorización normal conserva el envío del RIDE con sus datos de autorización', async t => {
  const e = escenario(t);
  const router = require('../routes/facturas');
  t.after(() => { delete require.cache[require.resolve('../routes/facturas')]; });
  const handler = router.stack.find(layer => layer.route?.path === '/:id/reenviar' && layer.route.methods.post).route.stack.at(-1).handle;
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await prisma.runWithClient(e.db, () => handler({ empresa: { id: 7 }, params: { id: '1' } }, res));
  assert.equal(res.body.ok, true);
  assert.equal(e.enviados.length, 1);
  assert.equal(e.enviados[0].numero, e.factura.numeroFactura);
  assert.equal(e.rides[0].datos.numeroAutorizacion, e.autorizacion.numeroAutorizacion);
  assert.equal(e.rides[0].datos.fechaAutorizacion, e.autorizacion.fechaAutorizacion);
  assert.deepEqual(e.errores, []);
});
