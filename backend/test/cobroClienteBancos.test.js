const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAsientoCobroCliente, crearAsientoReversoCobroCliente } = require('../utils/contabilidad');

// Regresión 2026-11-10: el cobro de CxC con transferencia guardaba bancoId
// pero no dejaba fila en Libro de Bancos y debitaba una cuenta "Bancos"
// genérica en vez de la cuenta contable del banco elegido.
function crearTxFake({ cobro, movimientosExistentes = [] }) {
  const estado = { asientos: [], movimientos: [...movimientosExistentes], cobroUpdates: [], movUpdates: [] };
  const cuentas = new Map([
    [500, { id: 500, empresaId: 1, codigo: '1.1.02.005', nombre: 'Banco Pichincha', activo: true, aceptaMovimiento: true }],
  ]);
  let sigCuenta = 1;
  const tx = {
    estado,
    cobros_cliente: {
      findUnique: async () => cobro,
      update: async ({ data }) => { estado.cobroUpdates.push(data); Object.assign(cobro, data); return cobro; },
    },
    asientos_contables: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async ({ where }) => estado.asientos.find(a => a.id === where.id) || null,
      create: async ({ data }) => {
        const a = { id: 900 + estado.asientos.length, ...data, detalles: data.detalles.create };
        estado.asientos.push(a);
        return a;
      },
    },
    plan_cuentas: {
      findUnique: async ({ where }) => cuentas.get(where.id) || null,
      findFirst: async ({ where }) => [...cuentas.values()].find(c => c.codigo === where.codigo) || null,
      create: async ({ data }) => { const c = { id: sigCuenta++, ...data }; cuentas.set(c.id, c); return c; },
      update: async ({ where, data }) => Object.assign(cuentas.get(where.id), data),
      findMany: async ({ where }) => where.id.in.map(id => ({ id, empresaId: where.empresaId, activo: true, aceptaMovimiento: true })),
    },
    movimientos_bancarios: {
      findMany: async () => [],
      findUnique: async ({ where }) => estado.movimientos.find(m => m.id === where.id) || null,
      findFirst: async ({ where }) => estado.movimientos.find(m =>
        m.bancoId === where.bancoId && m.referencia === where.referencia && Number(m.debe) === Number(where.debe)) || null,
      create: async ({ data }) => { const m = { id: 700 + estado.movimientos.length, ...data }; estado.movimientos.push(m); return m; },
      update: async ({ where, data }) => { estado.movUpdates.push({ id: where.id, ...data }); return Object.assign(estado.movimientos.find(m => m.id === where.id), data); },
    },
  };
  return tx;
}

function cobroBase(extra = {}) {
  return {
    id: 10, empresaId: 1, facturaId: 3, numero: 'REC-202611-0001', monto: 50, metodoPago: 'transferencia',
    bancoId: 2, banco: { id: 2, cuentaContableId: 500 }, chequeId: null, referencia: 'TRF-123',
    movimientoBancarioId: null, asientoId: null,
    factura: { numeroFactura: '001-002-000011341' }, ...extra,
  };
}

test('cobro por transferencia: debita la cuenta del banco y crea el ingreso en Libro de Bancos', async () => {
  const cobro = cobroBase();
  const tx = crearTxFake({ cobro });
  const { asiento } = await crearAsientoCobroCliente({ cobroId: 10, db: tx, fecha: new Date('2026-11-10T12:00:00Z') });

  assert.equal(asiento.detalles[0].cuentaId, 500);
  assert.equal(asiento.detalles[0].debe, 50);
  assert.equal(tx.estado.movimientos.length, 1);
  const mov = tx.estado.movimientos[0];
  assert.equal(mov.bancoId, 2);
  assert.equal(mov.tipo, 'TRANSFERENCIA_IN');
  assert.equal(mov.debe, 50);
  assert.equal(mov.haber, 0);
  assert.equal(mov.referencia, 'TRF-123');
  assert.equal(mov.asientoId, asiento.id);
  assert.equal(cobro.movimientoBancarioId, mov.id);
  assert.equal(cobro.asientoId, asiento.id);
});

test('cobro en efectivo: no crea movimiento bancario', async () => {
  const cobro = cobroBase({ metodoPago: 'efectivo', bancoId: null, banco: null });
  const tx = crearTxFake({ cobro });
  await crearAsientoCobroCliente({ cobroId: 10, db: tx });
  assert.equal(tx.estado.movimientos.length, 0);
  assert.equal(cobro.movimientoBancarioId, null);
});

test('cobro en ruta del vendedor ya con movimiento: se enlaza, no se duplica', async () => {
  const movPrevio = { id: 77, bancoId: 2, referencia: 'REC-202611-0001', debe: 50, haber: 0, asientoId: null };
  const cobro = cobroBase({ referencia: null });
  const tx = crearTxFake({ cobro, movimientosExistentes: [movPrevio] });
  const { asiento } = await crearAsientoCobroCliente({ cobroId: 10, db: tx });
  assert.equal(tx.estado.movimientos.length, 1);
  assert.equal(cobro.movimientoBancarioId, 77);
  assert.deepEqual(tx.estado.movUpdates, [{ id: 77, asientoId: asiento.id }]);
});

test('anular cobro con movimiento bancario: crea el retiro de reverso', async () => {
  const cobro = cobroBase();
  const tx = crearTxFake({ cobro });
  await crearAsientoCobroCliente({ cobroId: 10, db: tx });
  await crearAsientoReversoCobroCliente({ cobroId: 10, db: tx });
  assert.equal(tx.estado.movimientos.length, 2);
  const rev = tx.estado.movimientos[1];
  assert.equal(rev.tipo, 'RETIRO');
  assert.equal(rev.haber, 50);
  assert.equal(rev.debe, 0);
  assert.equal(rev.bancoId, 2);
});
