const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const express = require('express');

// API externa /api/ext/v1 (AVALAB) — 2026-11-10: pagos idempotentes por
// idPagoExterno y por clave de acceso, notas de crédito, anulación,
// verificación de faltantes. BD simulada en memoria; contabilidad stubbeada.

const CLAVE_A = '1'.repeat(49);
const CLAVE_B = '2'.repeat(49);
const CLAVE_NC = '3'.repeat(49);

function crearDbFake() {
  const st = {
    facturas: [{
      id: 10, empresaId: 1, claveAcceso: CLAVE_A, numeroFactura: '001-001-000011300',
      establecimiento: '001', puntoEmision: '001', secuencial: '000011300',
      importeTotal: 100, anulada: false, estadoSri: 'AUTORIZADO', clienteId: 5,
      tipoIdentificacionComprador: '05', identificacionComprador: '0102030405',
      razonSocialComprador: 'JUAN', fechaEmision: new Date('2026-10-20'), origenRegistro: 'WEBSERVICE',
    }],
    cobros: [], ncs: [], log: [],
    bancos: [{ id: 7, empresaId: 1, activo: true, nombre: 'Pichincha Cte', banco: 'Pichincha', tipoCuenta: 'CORRIENTE', numeroCuenta: '123' }],
  };
  const match = (row, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      return true;
    }
    return row[k] === v;
  });
  const db = {
    st,
    empresas: { findFirst: async () => ({ id: 1, razonSocial: 'LAB', ruc: '0999' }) },
    facturas: {
      findFirst: async ({ where }) => st.facturas.find(f => match(f, where)) || null,
      findMany: async ({ where }) => st.facturas.filter(f => match(f, where)),
      update: async ({ where, data }) => Object.assign(st.facturas.find(f => f.id === where.id), data),
    },
    cobros_cliente: {
      findFirst: async ({ where }) => st.cobros.find(c => match(c, where)) || null,
      findMany: async ({ where }) => st.cobros.filter(c => match(c, where)),
      aggregate: async ({ where }) => ({ _sum: { monto: st.cobros.filter(c => match(c, where)).reduce((s, c) => s + c.monto, 0) } }),
      create: async ({ data }) => { const c = { id: 100 + st.cobros.length, anulado: false, ...data }; st.cobros.push(c); return c; },
      update: async ({ where, data }) => Object.assign(st.cobros.find(c => c.id === where.id), data),
    },
    notas_credito: {
      findUnique: async ({ where }) => st.ncs.find(n => n.claveAcceso === where.claveAcceso) || null,
      aggregate: async ({ where }) => ({ _sum: { importeTotal: st.ncs.filter(n => match(n, where)).reduce((s, n) => s + n.importeTotal, 0) } }),
      create: async ({ data }) => { const n = { id: 200 + st.ncs.length, anulada: false, ...data }; st.ncs.push(n); return n; },
    },
    bancos: {
      findFirst: async ({ where }) => st.bancos.find(b => match(b, where)) || null,
      findMany: async ({ where }) => st.bancos.filter(b => match(b, where)),
    },
    $queryRaw: async () => [],
    $executeRaw: async (...args) => { st.log.push(args.slice(1)); return 1; },
    $transaction: async (fn) => fn(db),
  };
  return db;
}

function stub(rel, exportsObj) {
  const file = require.resolve(path.join(__dirname, '..', rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: exportsObj };
}

let db;
const asientos = [];
stub('config/prismaMaster', {
  getPrismaMaster: () => ({
    tenants: { findMany: async () => [{ id: 1, slug: 'labsanjose', estado: 'activo', brandConfig: { apiKey: 'k' } }] },
  }),
});
stub('config/prismaTenant', { getTenantPrisma: async () => db });
stub('utils/contabilidad', {
  round2: (n) => Math.round((Number(n) || 0) * 100) / 100,
  crearAsientoFacturaAutorizada: async () => ({ asiento: { id: 1 } }),
  crearAsientoCobroCliente: async ({ cobroId }) => { asientos.push(['COBRO', cobroId]); return { asiento: { id: 2 } }; },
  crearAsientoReversoCobroCliente: async ({ cobroId }) => { asientos.push(['REV_COBRO', cobroId]); return { asiento: { id: 3 } }; },
  crearAsientoNotaCreditoEmitida: async ({ notaCreditoId }) => { asientos.push(['NC', notaCreditoId]); return { asiento: { id: 4 } }; },
  crearAsientoReversoFacturaAnulada: async ({ facturaId }) => { asientos.push(['ANUL', facturaId]); return { asiento: { id: 5 } }; },
  siguienteNumeroGenerico: async () => `REC-${Date.now()}-${Math.random()}`,
});
const router = require('../routes/external');

async function conServidor(fn) {
  db = crearDbFake();
  asientos.length = 0;
  const app = express();
  app.use(express.json());
  app.use('/api/ext/v1', router);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/ext/v1`;
  const call = async (method, url, body) => {
    const r = await fetch(base + url, {
      method, headers: { 'Content-Type': 'application/json', 'X-API-Key': 'k' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json() };
  };
  try { await fn(call); } finally { server.close(); }
}

test('POST /pagos por claveAcceso con idPagoExterno no duplica al reintentar', async () => {
  await conServidor(async (call) => {
    const pago = { claveAcceso: CLAVE_A, monto: 40, metodoPago: 'Transferencia', idPagoExterno: 'AV-1' };
    const r1 = await call('POST', '/pagos', pago);
    assert.equal(r1.status, 201);
    assert.equal(r1.body.data.bancoId, 7, 'una sola cuenta activa → se usa como destino');
    const r2 = await call('POST', '/pagos', pago);
    assert.equal(r2.status, 200);
    assert.equal(db.st.cobros.length, 1);
    assert.equal(db.st.cobros[0].idExterno, 'AV-1');
    assert.deepEqual(asientos, [['COBRO', r1.body.data.id]]);
  });
});

test('POST /pagos rechaza exceder el saldo descontando notas de crédito', async () => {
  await conServidor(async (call) => {
    const nc = await call('POST', '/notas-credito', {
      claveAcceso: CLAVE_NC, numeroNotaCredito: '001-001-000000094', fechaEmision: '2026-10-22',
      motivo: 'Corrección', facturaClaveAcceso: CLAVE_A,
      items: [{ descripcion: 'Examen', cantidad: 1, precioUnitario: 30, ivaPorcentaje: 0 }],
    });
    assert.equal(nc.status, 201);
    assert.equal(nc.body.data.facturaId, 10);
    const r = await call('POST', '/pagos', { numeroFactura: '1-1-11300', monto: 80, metodoPago: 'efectivo' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /saldo pendiente \(\$70\.00\)/);
    const ok = await call('POST', '/pagos', { numeroFactura: '1-1-11300', monto: 70, metodoPago: 'efectivo' });
    assert.equal(ok.status, 201);
    const est = await call('GET', `/facturas/${CLAVE_A}`);
    assert.equal(est.body.data.saldo, 0);
    assert.equal(est.body.data.totalNotasCredito, 30);
  });
});

test('POST /notas-credito es idempotente y no excede la factura', async () => {
  await conServidor(async (call) => {
    const base = { numeroNotaCredito: '001-001-000000095', fechaEmision: '2026-10-22', motivo: 'x', facturaId: 10 };
    const grande = await call('POST', '/notas-credito', { ...base, claveAcceso: CLAVE_NC, items: [{ cantidad: 1, precioUnitario: 101, ivaPorcentaje: 0 }] });
    assert.equal(grande.status, 400);
    const r1 = await call('POST', '/notas-credito', { ...base, claveAcceso: CLAVE_NC, items: [{ cantidad: 1, precioUnitario: 10, ivaPorcentaje: 0 }] });
    const r2 = await call('POST', '/notas-credito', { ...base, claveAcceso: CLAVE_NC, items: [{ cantidad: 1, precioUnitario: 10, ivaPorcentaje: 0 }] });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 200);
    assert.equal(db.st.ncs.length, 1);
    assert.equal(db.st.ncs[0].estadoSri, 'AUTORIZADO');
  });
});

test('POST /facturas/verificar separa registradas y faltantes', async () => {
  await conServidor(async (call) => {
    const r = await call('POST', '/facturas/verificar', { clavesAcceso: [CLAVE_A, CLAVE_B, CLAVE_A] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.registradas.map(f => f.id), [10]);
    assert.deepEqual(r.body.faltantes, [CLAVE_B]);
  });
});

test('POST /facturas/anular exige anular antes los cobros y reversa el asiento', async () => {
  await conServidor(async (call) => {
    await call('POST', '/pagos', { facturaId: 10, monto: 10, metodoPago: 'efectivo', idPagoExterno: 'AV-9' });
    const bloqueada = await call('POST', '/facturas/anular', { claveAcceso: CLAVE_A, motivo: 'Anulada en SRI' });
    assert.equal(bloqueada.status, 409);
    const an = await call('POST', '/pagos/anular', { idPagoExterno: 'AV-9', motivo: 'error' });
    assert.equal(an.status, 200);
    const ok = await call('POST', '/facturas/anular', { claveAcceso: CLAVE_A, motivo: 'Anulada en SRI' });
    assert.equal(ok.status, 200);
    assert.equal(db.st.facturas[0].anulada, true);
    assert.equal(db.st.facturas[0].estadoSri, 'ANULADO');
    assert.deepEqual(asientos.map(a => a[0]), ['COBRO', 'REV_COBRO', 'ANUL']);
    const pago = await call('POST', '/pagos', { facturaId: 10, monto: 1, metodoPago: 'efectivo' });
    assert.equal(pago.status, 400);
  });
});

test('las llamadas POST quedan en la bitácora con su referencia y error', async () => {
  await conServidor(async (call) => {
    await call('POST', '/pagos', { claveAcceso: CLAVE_B, monto: 5, metodoPago: 'efectivo' });
    await new Promise(r => setTimeout(r, 20));
    const fila = db.st.log[0];
    assert.equal(fila[0], 'POST');
    assert.equal(fila[2], 404);
    assert.equal(fila[3], CLAVE_B);
    assert.match(fila[4], /Factura no encontrada/);
  });
});
