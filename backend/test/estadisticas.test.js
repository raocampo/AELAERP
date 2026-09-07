const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularTotalesMensuales, calcularVariacionPct, acumularTopProductos } = require('../utils/estadisticas');

function fecha(mes, anio = 2026) {
  return new Date(`${anio}-${String(mes).padStart(2, '0')}-15T00:00:00.000Z`);
}

test('calcularTotalesMensuales suma facturas y notas al mes correcto', () => {
  const facturas = [{ importeTotal: 100, fechaEmision: fecha(1), pagos: [{ formaPago: 'Efectivo', total: 100 }] }];
  const notas = [{ total: 50, fechaEmision: fecha(1), formaPago: 'Efectivo', pagos: null }];
  const r = calcularTotalesMensuales(facturas, notas);
  assert.equal(r.meses[0].ventasFacturas, 100);
  assert.equal(r.meses[0].ventasNotas, 50);
  assert.equal(r.meses[0].ventasTotal, 150);
  assert.equal(r.meses[0].comprobantes, 2);
  assert.equal(r.totalAnio, 150);
});

test('calcularTotalesMensuales reparte efectivo/banco usando desglosarEfectivoBanco', () => {
  const facturas = [
    { importeTotal: 100, fechaEmision: fecha(3), pagos: [{ formaPago: '01', uid: '01', total: 40 }, { formaPago: '20', uid: 'TRF', total: 60 }] },
  ];
  const notas = [
    { total: 30, fechaEmision: fecha(3), formaPago: 'Transferencia', pagos: null },
  ];
  const r = calcularTotalesMensuales(facturas, notas);
  const marzo = r.meses[2];
  assert.equal(marzo.efectivo, 40);
  assert.equal(marzo.banco, 90); // 60 de la factura + 30 de la nota
  assert.equal(r.totalEfectivo, 40);
  assert.equal(r.totalBanco, 90);
});

test('calcularTotalesMensuales calcula ticket promedio por mes y anual', () => {
  const facturas = [
    { importeTotal: 100, fechaEmision: fecha(5), pagos: [{ formaPago: 'Efectivo', total: 100 }] },
    { importeTotal: 300, fechaEmision: fecha(5), pagos: [{ formaPago: 'Efectivo', total: 300 }] },
  ];
  const r = calcularTotalesMensuales(facturas, []);
  assert.equal(r.meses[4].ticketPromedio, 200);
  assert.equal(r.ticketPromedioAnio, 200);
});

test('calcularTotalesMensuales con arrays vacíos no rompe (año sin ventas)', () => {
  const r = calcularTotalesMensuales([], []);
  assert.equal(r.totalAnio, 0);
  assert.equal(r.comprobantesAnio, 0);
  assert.equal(r.ticketPromedioAnio, 0);
  assert.equal(r.meses.length, 12);
});

test('calcularVariacionPct calcula el % de cambio contra el año anterior', () => {
  assert.equal(calcularVariacionPct(150, 100), 50);
  assert.equal(calcularVariacionPct(50, 100), -50);
});

test('calcularVariacionPct devuelve null si el año anterior no tuvo ventas (evita división por cero)', () => {
  assert.equal(calcularVariacionPct(100, 0), null);
  assert.equal(calcularVariacionPct(100, null), null);
});

test('acumularTopProductos suma cantidad/monto por código y ordena por monto desc', () => {
  const detallesFactura = [
    { codigoPrincipal: 'A1', descripcion: 'Producto A', cantidad: 2, precioUnitario: 10, descuento: 0 },
    { codigoPrincipal: 'B1', descripcion: 'Producto B', cantidad: 1, precioUnitario: 100, descuento: 0 },
  ];
  const detallesNota = [
    { codigoPrincipal: 'A1', descripcion: 'Producto A', cantidad: 3, precioUnitario: 10, descuento: 5 },
  ];
  const top = acumularTopProductos([detallesFactura, detallesNota], 10);
  assert.equal(top[0].codigo, 'B1'); // 100 > (20+25)
  assert.equal(top[1].codigo, 'A1');
  assert.equal(top[1].cantidad, 5); // 2 + 3
  assert.equal(top[1].monto, 45); // (2*10) + (3*10 - 5)
});

test('acumularTopProductos respeta el límite pedido', () => {
  const detalles = Array.from({ length: 15 }, (_, i) => ({
    codigoPrincipal: `P${i}`, descripcion: `Producto ${i}`, cantidad: 1, precioUnitario: i + 1, descuento: 0,
  }));
  const top = acumularTopProductos([detalles], 5);
  assert.equal(top.length, 5);
  assert.equal(top[0].codigo, 'P14'); // el de mayor precio/monto
});

test('acumularTopProductos ignora detalles null/undefined sin romper', () => {
  const top = acumularTopProductos([null, undefined, []], 10);
  assert.deepEqual(top, []);
});
