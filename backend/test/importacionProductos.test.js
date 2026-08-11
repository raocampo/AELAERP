const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { mapearFilaProducto, leerFilasDesdeExcel, desambiguarCodigosDuplicados } = require('../utils/importacionProductos');

test('mapearFilaProducto reconoce encabezados "precio de venta" / "stock actual" con espacios', () => {
  const fila = { codigoPrincipal: 'P001', nombre: 'Test', 'precio de venta': '0.87', 'stock actual': '5' };
  const producto = mapearFilaProducto(fila, 0);
  assert.equal(producto.precioUnitario, 0.87);
  assert.equal(producto.stockActual, 5);
});

test('leerFilasDesdeExcel reconstruye códigos de barras que Excel muestra en notación científica', () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ['codigoPrincipal', 'nombre', 'precio de venta'],
    [7802225427777, 'Producto código largo', 0.8695652173913044],
  ]);
  ws.C2.z = '0.00'; // Excel lo muestra como "0.87", pero el valor guardado trae más decimales
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filas = leerFilasDesdeExcel(buffer);
  assert.equal(filas[0].codigoPrincipal, 7802225427777);
  assert.ok(!/e\+/i.test(String(filas[0].codigoPrincipal)));
  // El precio conserva la precisión completa (no el "0.87" redondeado que Excel muestra) —
  // el IVA se calcula sobre este valor, y con solo 2 decimales el PVP no vuelve a cerrar
  // exacto al facturar (0.43 × 1.15 = 0.49, nunca 0.50).
  assert.equal(filas[0]['precio de venta'], 0.8695652173913044);
});

test('mapearFilaProducto conserva la precisión completa del precio para que el IVA cierre exacto', () => {
  // PVP real $0.50 con IVA 15% desglosado por fórmula de Excel
  const fila = { codigoPrincipal: 'P002', nombre: 'Test IVA', 'precio de venta': 0.4347826086956522, iva: '15' };
  const producto = mapearFilaProducto(fila, 0);
  assert.equal(producto.precioUnitario, 0.4347826086956522);
  // Redondeado a los 4 decimales que soporta la columna (Decimal(14,4)) y multiplicado por
  // el IVA, el PVP debe volver a acercarse a 0.50 (no quedarse en 0.49 como con 2 decimales)
  const precioRedondeado = Number(producto.precioUnitario.toFixed(4));
  const pvpRecalculado = Math.round(precioRedondeado * 1.15 * 100) / 100;
  assert.equal(pvpRecalculado, 0.5);
});

test('desambiguarCodigosDuplicados asigna código único cuando el mismo código tiene nombres distintos', () => {
  const productos = [
    { codigoPrincipal: 'TARJETA', nombre: 'Tarjeta Claro 5.50' },
    { codigoPrincipal: 'TARJETA', nombre: 'Tarjeta Claro 1.10' },
    { codigoPrincipal: 'TARJETA', nombre: 'Tarjeta Claro 3.50' },
  ];
  const cambios = desambiguarCodigosDuplicados(productos);

  assert.equal(productos[0].codigoPrincipal, 'TARJETA');
  assert.equal(productos[1].codigoPrincipal, 'TARJETA-2');
  assert.equal(productos[2].codigoPrincipal, 'TARJETA-3');
  assert.equal(cambios.length, 2);
});

test('desambiguarCodigosDuplicados deja igual el código cuando el nombre repetido es el mismo producto', () => {
  const productos = [
    { codigoPrincipal: 'P001', nombre: 'Producto X' },
    { codigoPrincipal: 'P001', nombre: '  producto x  ' },
  ];
  const cambios = desambiguarCodigosDuplicados(productos);

  assert.equal(productos[0].codigoPrincipal, 'P001');
  assert.equal(productos[1].codigoPrincipal, 'P001');
  assert.equal(cambios.length, 0);
});

test('desambiguarCodigosDuplicados no genera un código que ya existe en el archivo', () => {
  const productos = [
    { codigoPrincipal: 'X', nombre: 'Uno' },
    { codigoPrincipal: 'X', nombre: 'Dos' },
    { codigoPrincipal: 'X-2', nombre: 'Ya ocupado de antes' },
  ];
  const cambios = desambiguarCodigosDuplicados(productos);

  assert.equal(productos[1].codigoPrincipal, 'X-3');
  assert.equal(cambios[0].codigoNuevo, 'X-3');
});
