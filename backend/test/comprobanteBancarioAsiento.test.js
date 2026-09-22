const test = require('node:test');
const assert = require('node:assert/strict');
const { crearAsientoReversoComprobanteBancario } = require('../utils/contabilidad');

// Mock mínimo de tx: cubre exactamente lo que tocan
// crearAsientoReversoComprobanteBancario -> crearAsientoContable
// (siguienteNumeroAsiento, validarCuentasMovimiento, asientos_contables.create).
function crearTxFake({ asientoOriginal }) {
  const creados = [];
  return {
    creados,
    asientos_contables: {
      findUnique: async ({ where }) => (where.id === asientoOriginal.id ? asientoOriginal : null),
      findFirst: async () => null, // sin asientos previos este mes -> numero empieza en 1
      findMany: async () => [], // sin asientos previos este mes -> numero empieza en 1
      create: async ({ data }) => {
        const asiento = { id: 999, ...data, detalles: data.detalles.create };
        creados.push(asiento);
        return asiento;
      },
    },
    plan_cuentas: {
      findMany: async ({ where }) => where.id.in.map((id) => ({ id, empresaId: where.empresaId, activo: true, aceptaMovimiento: true })),
    },
  };
}

test('crearAsientoReversoComprobanteBancario invierte debe/haber y no toca el asiento original', async () => {
  const asientoOriginal = {
    id: 42,
    empresaId: 7,
    detalles: [
      { cuentaId: 1, descripcion: 'Banco', debe: 100, haber: 0 },
      { cuentaId: 2, descripcion: 'Ventas', debe: 0, haber: 100 },
    ],
  };
  const tx = crearTxFake({ asientoOriginal });

  const reverso = await crearAsientoReversoComprobanteBancario({
    asientoId: 42,
    motivo: 'Corrigió la fecha de 2023 a 2026',
    usuarioId: 5,
    db: tx,
  });

  assert.equal(reverso.id, 999);
  assert.equal(reverso.tipo, 'ANULACION');
  assert.match(reverso.descripcion, /Corrigió la fecha de 2023 a 2026/);
  assert.equal(reverso.detalles.length, 2);
  assert.equal(reverso.detalles[0].cuentaId, 1);
  assert.equal(reverso.detalles[0].debe, 0);
  assert.equal(reverso.detalles[0].haber, 100);
  assert.equal(reverso.detalles[1].cuentaId, 2);
  assert.equal(reverso.detalles[1].debe, 100);
  assert.equal(reverso.detalles[1].haber, 0);

  // El original nunca se modificó (el mock solo permite create, no update).
  assert.equal(asientoOriginal.detalles[0].debe, 100);
});

test('crearAsientoReversoComprobanteBancario lanza si el asiento no existe', async () => {
  const tx = crearTxFake({ asientoOriginal: { id: 1, empresaId: 7, detalles: [] } });
  await assert.rejects(
    () => crearAsientoReversoComprobanteBancario({ asientoId: 404, motivo: 'x', usuarioId: 1, db: tx }),
    /Asiento original no encontrado/,
  );
});
