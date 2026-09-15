const test = require('node:test');
const assert = require('node:assert/strict');
const { aplicarMovimientosVentaDesdeDetalles } = require('../utils/inventario');

// Venta por paquete además de por unidad (2026-09-14, ver
// docs/roadmap si aplica): el stock siempre se lleva en unidades
// individuales — una línea `esPaquete` debe descontar
// cantidad * producto.unidadesPorPaquete, nunca solo `cantidad`. El
// factor se resuelve del producto en BD, nunca del detalle enviado por
// el cliente (evita manipulación).
function crearTx({ productos }) {
  const movimientos = [];
  const productosPorCodigo = new Map(productos.map((p) => [p.codigoPrincipal, { ...p }]));
  return {
    movimientos,
    empresas: { async findUnique({ where }) { return { id: where.id }; } },
    configuracion_sistema: {
      async findUnique() { return { inventarioHabilitado: true, permitirStockNegativo: true }; },
    },
    productos_servicios: {
      async findMany({ where }) {
        return [...productosPorCodigo.values()].filter((p) => where.codigoPrincipal.in.includes(p.codigoPrincipal));
      },
      async findFirst({ where }) {
        return [...productosPorCodigo.values()].find((p) => p.id === where.id) || null;
      },
      async update({ where, data }) {
        const p = [...productosPorCodigo.values()].find((x) => x.id === where.id);
        Object.assign(p, data);
        return p;
      },
    },
    movimientos_inventario: {
      async create({ data }) { movimientos.push(data); return { id: movimientos.length, ...data }; },
    },
  };
}

test('línea normal (sin esPaquete) descuenta 1:1, igual que siempre', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'BON-01', stockActual: 100, costoUnitario: 0.19, unidadesPorPaquete: 10, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1, detalles: [{ codigoPrincipal: 'BON-01', cantidad: 3 }], tipoDocumento: 'FACTURA',
  });
  assert.equal(tx.movimientos.length, 1);
  assert.equal(tx.movimientos[0].cantidad, 3);
  assert.equal(tx.movimientos[0].stockNuevo, 97);
});

test('línea esPaquete descuenta cantidad * unidadesPorPaquete del producto en BD', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'BON-01', stockActual: 100, costoUnitario: 0.19, unidadesPorPaquete: 10, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1, detalles: [{ codigoPrincipal: 'BON-01', cantidad: 1, esPaquete: true }], tipoDocumento: 'FACTURA',
  });
  assert.equal(tx.movimientos.length, 1);
  assert.equal(tx.movimientos[0].cantidad, 10); // 1 paquete de 10 unidades
  assert.equal(tx.movimientos[0].stockNuevo, 90);
});

test('ignora el factor que venga en el detalle — solo confía en el producto real (BD)', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'BON-01', stockActual: 100, costoUnitario: 0.19, unidadesPorPaquete: 10, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1,
    // un cliente manipulado podría mandar unidadesPorPaquete: 999 en el
    // detalle — debe ignorarse por completo.
    detalles: [{ codigoPrincipal: 'BON-01', cantidad: 1, esPaquete: true, unidadesPorPaquete: 999 }],
    tipoDocumento: 'FACTURA',
  });
  assert.equal(tx.movimientos[0].cantidad, 10);
});

test('mezcla en la misma venta: unidad suelta + paquete completo del mismo producto', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'BON-01', stockActual: 100, costoUnitario: 0.19, unidadesPorPaquete: 10, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1,
    detalles: [
      { codigoPrincipal: 'BON-01', cantidad: 3 },              // 3 unidades sueltas
      { codigoPrincipal: 'BON-01', cantidad: 1, esPaquete: true }, // 1 funda de 10
    ],
    tipoDocumento: 'FACTURA',
  });
  // Se agrupan en un solo movimiento por código: 3 + 10 = 13
  assert.equal(tx.movimientos.length, 1);
  assert.equal(tx.movimientos[0].cantidad, 13);
  assert.equal(tx.movimientos[0].stockNuevo, 87);
});

test('producto sin unidadesPorPaquete configurado (default 1) — esPaquete no cambia nada', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'ABC', stockActual: 50, costoUnitario: 1, unidadesPorPaquete: 1, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1, detalles: [{ codigoPrincipal: 'ABC', cantidad: 2, esPaquete: true }], tipoDocumento: 'FACTURA',
  });
  assert.equal(tx.movimientos[0].cantidad, 2);
});

test('revertir (anulación) también respeta esPaquete y devuelve el stock correcto', async () => {
  const tx = crearTx({ productos: [{ id: 1, codigoPrincipal: 'BON-01', stockActual: 90, costoUnitario: 0.19, unidadesPorPaquete: 10, inventariable: true }] });
  await aplicarMovimientosVentaDesdeDetalles({
    tx, empresaId: 1,
    detalles: [{ codigoPrincipal: 'BON-01', cantidad: 1, esPaquete: true }],
    tipoDocumento: 'FACTURA', revertir: true,
  });
  assert.equal(tx.movimientos[0].cantidad, 10);
  assert.equal(tx.movimientos[0].stockNuevo, 100);
});
