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
  ws.C2.z = '0.00'; // mismo formato de 2 decimales que trae el archivo real del usuario
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const filas = leerFilasDesdeExcel(buffer);
  assert.equal(filas[0].codigoPrincipal, '7802225427777');
  assert.ok(!/e\+/i.test(filas[0].codigoPrincipal));
  // El precio con muchos decimales debe conservar el redondeo que Excel muestra, no el valor crudo
  assert.equal(filas[0]['precio de venta'], '0.87');
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
