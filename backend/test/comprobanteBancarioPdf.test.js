const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  generarComprobanteBancarioPdf, CATEGORIA_POR_TIPO_MOVIMIENTO, CATEGORIA_POR_TIPO_COMPROBANTE,
} = require('../utils/comprobanteBancarioPdf');

const cfg = { razonSocial: 'Empresa de Prueba', ruc: '1790000000001', dirMatriz: 'Loja', telefono: '072000000' };

test('genera un PDF válido para cada categoría de comprobante', async () => {
  for (const categoria of ['INGRESO', 'EGRESO', 'CREDITO', 'DEBITO', 'AJUSTE']) {
    const out = path.join(os.tmpdir(), `comp-test-${categoria}-${Date.now()}.pdf`);
    await generarComprobanteBancarioPdf({
      categoria, numero: 'ING-202609-0001', fecha: '2026-09-18T00:00:00.000Z', monto: 125.5,
      filas: [['Concepto:', 'Prueba', true], ['Referencia:', null]],
      tablas: [{ titulo: 'Detalle', columnas: [{ titulo: 'Cuenta' }, { titulo: 'Valor', ancho: 80, alinear: 'right' }], filas: [['Caja', '$125.50']] }],
    }, cfg, out);
    const buf = fs.readFileSync(out);
    fs.unlinkSync(out);
    assert.equal(buf.slice(0, 5).toString(), '%PDF-', categoria);
    assert.ok(buf.length > 1000, categoria);
  }
});

test('un comprobante anulado y con muchas filas sigue generando PDF (paginación)', async () => {
  const out = path.join(os.tmpdir(), `comp-test-largo-${Date.now()}.pdf`);
  const filas = Array.from({ length: 80 }, (_, i) => [`1.1.${i}`, `Cuenta número ${i}`, '$1.00']);
  await generarComprobanteBancarioPdf({
    categoria: 'EGRESO', numero: 'EGR-202609-0002', fecha: new Date(), anulado: true, monto: 80,
    tablas: [{ titulo: 'Detalle', columnas: [{ titulo: 'Código', ancho: 80 }, { titulo: 'Cuenta' }, { titulo: 'Valor', ancho: 80 }], filas }],
  }, cfg, out);
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
});

test('mapeo de tipos de movimiento / comprobante a categoría', () => {
  assert.equal(CATEGORIA_POR_TIPO_MOVIMIENTO.DEPOSITO, 'INGRESO');
  assert.equal(CATEGORIA_POR_TIPO_MOVIMIENTO.TRANSFERENCIA_OUT, 'EGRESO');
  assert.equal(CATEGORIA_POR_TIPO_MOVIMIENTO.CHEQUE, 'EGRESO');
  assert.equal(CATEGORIA_POR_TIPO_COMPROBANTE.PAGO, 'EGRESO');
  assert.equal(CATEGORIA_POR_TIPO_COMPROBANTE.INGRESO, 'INGRESO');
});
