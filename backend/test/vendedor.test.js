const test = require('node:test');
const assert = require('node:assert/strict');
const { scopeVendedor, saldoPendientePorCliente, estadoCuentaCliente, facturasPendientesPorClientes } = require('../utils/vendedor');

test('scopeVendedor acota solo al rol vendedor', () => {
  assert.deepEqual(scopeVendedor({ rol: 'vendedor', id: 7 }), { vendedorId: 7 });
  assert.deepEqual(scopeVendedor({ rol: 'asesor', id: 9 }), { vendedorId: 9 }); // alias
  assert.deepEqual(scopeVendedor({ rol: 'admin', id: 1 }), {});
  assert.deepEqual(scopeVendedor({ rol: 'supervisor', id: 2 }), {});
  assert.deepEqual(scopeVendedor(null), {});
  assert.deepEqual(scopeVendedor({ rol: 'vendedor' }), {}); // sin id, no acota
});

// ── Mock mínimo de Prisma para los helpers de saldo ──────────────────────────
function crearDb({ facturas = [], cobros = [], notasCredito = [] } = {}) {
  const groupBySum = (rows, byField, sumField, where) => {
    const filtradas = rows.filter((r) => {
      if (where.empresaId !== undefined && r.empresaId !== where.empresaId) return false;
      if (where.facturaId?.in && !where.facturaId.in.includes(r.facturaId)) return false;
      if (where.anulado !== undefined && r.anulado !== where.anulado) return false;
      if (where.anulada !== undefined && r.anulada !== where.anulada) return false;
      if (where.estadoSri !== undefined && r.estadoSri !== where.estadoSri) return false;
      return true;
    });
    const acc = new Map();
    for (const r of filtradas) acc.set(r[byField], (acc.get(r[byField]) || 0) + Number(r[sumField] || 0));
    return [...acc.entries()].map(([k, v]) => ({ [byField]: k, _sum: { [sumField]: v } }));
  };
  return {
    facturas: {
      async findMany({ where, select }) {
        return facturas.filter((f) => {
          if (where.empresaId !== undefined && f.empresaId !== where.empresaId) return false;
          if (where.clienteId?.in && !where.clienteId.in.includes(f.clienteId)) return false;
          if (where.clienteId !== undefined && !where.clienteId.in && f.clienteId !== where.clienteId) return false;
          if (where.anulada !== undefined && f.anulada !== where.anulada) return false;
          if (where.estadoSri?.in && !where.estadoSri.in.includes(f.estadoSri)) return false;
          return true;
        }).map((f) => ({ ...f }));
      },
    },
    cobros_cliente: { async groupBy({ by, where, _sum }) { return groupBySum(cobros, by[0], Object.keys(_sum)[0], where); } },
    notas_credito: { async groupBy({ by, where, _sum }) { return groupBySum(notasCredito, by[0], Object.keys(_sum)[0], where); } },
  };
}

test('saldoPendientePorCliente: total factura − cobros − NC, agrupado por cliente', async () => {
  const db = crearDb({
    facturas: [
      { id: 1, empresaId: 1, clienteId: 10, importeTotal: 100, anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 2, empresaId: 1, clienteId: 10, importeTotal: 50,  anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 3, empresaId: 1, clienteId: 20, importeTotal: 200, anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 4, empresaId: 1, clienteId: 20, importeTotal: 999, anulada: true,  estadoSri: 'AUTORIZADO' }, // anulada → ignora
    ],
    cobros: [
      { facturaId: 1, empresaId: 1, monto: 30, anulado: false },
      { facturaId: 1, empresaId: 1, monto: 70, anulado: false }, // factura 1 queda saldada
      { facturaId: 3, empresaId: 1, monto: 500, anulado: true },  // cobro anulado → no cuenta
    ],
    notasCredito: [
      { facturaId: 3, empresaId: 1, importeTotal: 50, estadoSri: 'AUTORIZADO', anulada: false },
    ],
  });
  const saldos = await saldoPendientePorCliente(db, 1, [10, 20]);
  assert.equal(saldos.get(10), 50);   // 100-100=0 (excluida) + 50-0 = 50
  assert.equal(saldos.get(20), 150);  // 200 - 0 - 50 (NC) = 150
});

test('saldoPendientePorCliente devuelve Map vacío sin ids', async () => {
  const saldos = await saldoPendientePorCliente(crearDb(), 1, []);
  assert.equal(saldos.size, 0);
});

test('estadoCuentaCliente lista solo facturas con saldo > 0 y el total', async () => {
  const db = crearDb({
    facturas: [
      { id: 1, empresaId: 1, clienteId: 10, numeroFactura: 'F-1', fechaEmision: new Date('2026-01-01'), importeTotal: 100, anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 2, empresaId: 1, clienteId: 10, numeroFactura: 'F-2', fechaEmision: new Date('2026-02-01'), importeTotal: 80,  anulada: false, estadoSri: 'AUTORIZADO' },
    ],
    cobros: [{ facturaId: 1, empresaId: 1, monto: 100, anulado: false }], // F-1 saldada
  });
  const r = await estadoCuentaCliente(db, 1, 10);
  assert.equal(r.facturasPendientes.length, 1);
  assert.equal(r.facturasPendientes[0].numeroFactura, 'F-2');
  assert.equal(r.facturasPendientes[0].saldo, 80);
  assert.equal(r.saldoTotal, 80);
});

test('facturasPendientesPorClientes aplana facturas de varios clientes y excluye las saldadas', async () => {
  const db = crearDb({
    facturas: [
      { id: 1, empresaId: 1, clienteId: 10, numeroFactura: 'F-1', razonSocialComprador: 'Cliente A', fechaEmision: new Date('2026-02-01'), importeTotal: 100, anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 2, empresaId: 1, clienteId: 20, numeroFactura: 'F-2', razonSocialComprador: 'Cliente B', fechaEmision: new Date('2026-01-01'), importeTotal: 50, anulada: false, estadoSri: 'AUTORIZADO' },
      { id: 3, empresaId: 1, clienteId: 20, numeroFactura: 'F-3', razonSocialComprador: 'Cliente B', fechaEmision: new Date('2026-03-01'), importeTotal: 30, anulada: false, estadoSri: 'AUTORIZADO' },
    ],
    cobros: [{ facturaId: 3, empresaId: 1, monto: 30, anulado: false }], // F-3 saldada, se excluye
  });
  const r = await facturasPendientesPorClientes(db, 1, [10, 20]);
  assert.equal(r.length, 2);
  assert.deepEqual(new Set(r.map((f) => f.numeroFactura)), new Set(['F-1', 'F-2']));
  const f2 = r.find((f) => f.numeroFactura === 'F-2');
  assert.equal(f2.clienteNombre, 'Cliente B');
  assert.equal(f2.saldo, 50);
  const f1 = r.find((f) => f.numeroFactura === 'F-1');
  assert.equal(f1.saldo, 100);
});

test('facturasPendientesPorClientes devuelve vacío sin clientes', async () => {
  const r = await facturasPendientesPorClientes(crearDb(), 1, []);
  assert.equal(r.length, 0);
});
