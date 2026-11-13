const test = require('node:test');
const assert = require('node:assert/strict');
const { resumenVentas } = require('../utils/resumenVentas');

const f = (o) => ({
  anulada: false, estadoSri: 'AUTORIZADO', subtotal0: 0, subtotal5: 0, subtotal12: 0, subtotal15: 0,
  subtotalNoObjetoIva: 0, totalIva: 0, importeTotal: 0, pagos: [], ...o,
});

test('agrupa por forma de cobro, reparte pagos mixtos y excluye anuladas/rechazadas', () => {
  const r = resumenVentas([
    f({ subtotal0: 115, importeTotal: 115, pagos: [{ formaPago: '20', total: 115 }] }),
    f({ subtotal15: 100, totalIva: 15, importeTotal: 115, pagos: [{ formaPago: '01', uid: 'efe', total: 15 }, { formaPago: '20', uid: 'trf', total: 100 }] }),
    f({ subtotal0: 50, importeTotal: 50, pagos: [] }),
    f({ subtotal0: 999, importeTotal: 999, anulada: true, estadoSri: 'ANULADO' }),
    f({ subtotal0: 10, importeTotal: 10, estadoSri: 'RECHAZADO' }),
  ]);
  assert.deepEqual(r.totales, { facturas: 3, base0: 165, baseIva: 100, iva: 15, total: 280, anuladas: 1, rechazadas: 1 });
  const g = Object.fromEntries(r.grupos.map((x) => [x.categoria, x]));
  assert.equal(g.OTRO_FINANCIERO.total, 115);
  assert.equal(g.TRANSFERENCIA.total, 100);
  assert.equal(g.EFECTIVO.total, 15);
  assert.equal(g.EFECTIVO.iva, 1.96);
  assert.equal(g.SIN_DETALLE.total, 50);
  assert.equal(r.grupos.reduce((s, x) => s + x.total, 0), 280);
});
