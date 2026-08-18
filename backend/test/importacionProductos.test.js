const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { mapearFilaProducto, leerFilasDesdeExcel, desambiguarCodigosDuplicados, pareceNotacionCientifica, parsearFacturaCompraDesdeXml } = require('../utils/importacionProductos');

function detalleXml({ codigo, descripcion, cantidad, precioUnitario, codigoPorcentaje, tarifa, valorIva }) {
  return `
    <detalle>
      <codigoPrincipal>${codigo}</codigoPrincipal>
      <descripcion>${descripcion}</descripcion>
      <cantidad>${cantidad}</cantidad>
      <precioUnitario>${precioUnitario}</precioUnitario>
      <descuento>0</descuento>
      <precioTotalSinImpuesto>${(cantidad * precioUnitario).toFixed(2)}</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>${codigoPorcentaje}</codigoPorcentaje>
          ${tarifa !== undefined ? `<tarifa>${tarifa}</tarifa>` : ''}
          <baseImponible>${(cantidad * precioUnitario).toFixed(2)}</baseImponible>
          <valor>${valorIva}</valor>
        </impuesto>
      </impuestos>
    </detalle>`;
}

function facturaCompraXml(detallesXml) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <factura id="comprobante">
      <infoTributaria>
        <ruc>1790016919001</ruc>
        <razonSocial>PROVEEDOR TEST</razonSocial>
        <estab>001</estab>
        <ptoEmi>001</ptoEmi>
        <secuencial>000000001</secuencial>
        <claveAcceso>0000000000000000000000000000000000000000000000</claveAcceso>
      </infoTributaria>
      <infoFactura>
        <fechaEmision>01/07/2026</fechaEmision>
      </infoFactura>
      <detalles>${detallesXml.join('')}</detalles>
    </factura>`;
}

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

test('mapearFilaProducto limpia saltos de línea de celdas de Excel con texto envuelto (Alt+Enter)', () => {
  // Caso real: "RUFFLES TWIST LIMON 38GX60X1 RM" en una celda con ajuste de
  // texto en Excel se ve como una línea pero guarda un \r\n real — sin
  // limpiar esto, el SRI rechaza la factura con error 35 "ARCHIVO NO
  // CUMPLE ESTRUCTURA XML" recién al vender ese producto.
  const fila = { codigoPrincipal: '7861018591712', nombre: 'RUFFLES TWIST LIMON\r\n38GX60X1 RM' };
  const producto = mapearFilaProducto(fila, 0);
  assert.equal(producto.nombre, 'RUFFLES TWIST LIMON 38GX60X1 RM');
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

test('pareceNotacionCientifica detecta un código pegado en notación científica y no falsos positivos', () => {
  assert.equal(pareceNotacionCientifica('7.80223E+12'), true);
  assert.equal(pareceNotacionCientifica('7.8621e+12'), true);
  assert.equal(pareceNotacionCientifica('7802225427777'), false);
  assert.equal(pareceNotacionCientifica('ARROCILLO'), false);
  assert.equal(pareceNotacionCientifica(7802225427777), false); // número, no texto — no aplica
  assert.equal(pareceNotacionCientifica(undefined), false);
});

test('parsearFacturaCompraDesdeXml usa el código de porcentaje SRI real (4=15%, no "No objeto") — antes tenía una tabla incorrecta', () => {
  const xml = facturaCompraXml([
    detalleXml({ codigo: 'A', descripcion: 'Item 15%', cantidad: 1, precioUnitario: 100, codigoPorcentaje: '4', valorIva: 15 }),
  ]);
  const { detalles, totales } = parsearFacturaCompraDesdeXml(xml);
  assert.equal(detalles[0].porcentajeIva, 15);
  assert.equal(totales.subtotal15, 100);
  assert.equal(totales.subtotalNoObjeto, 0);
  assert.equal(totales.totalIva, 15);
});

test('parsearFacturaCompraDesdeXml separa No Objeto (6) y Exento (7) del resto — antes caían en subtotal0 sin distinguirse', () => {
  const xml = facturaCompraXml([
    detalleXml({ codigo: 'B', descripcion: 'Item No Objeto', cantidad: 1, precioUnitario: 20, codigoPorcentaje: '6', valorIva: 0 }),
    detalleXml({ codigo: 'C', descripcion: 'Item Exento', cantidad: 1, precioUnitario: 30, codigoPorcentaje: '7', valorIva: 0 }),
  ]);
  const { detalles, totales } = parsearFacturaCompraDesdeXml(xml);
  assert.equal(detalles[0].porcentajeIva, 6);
  assert.equal(detalles[1].porcentajeIva, 7);
  assert.equal(totales.subtotalNoObjeto, 20);
  assert.equal(totales.subtotalExento, 30);
  assert.equal(totales.subtotal0, 0);
  assert.equal(totales.totalIva, 0);
});

test('parsearFacturaCompraDesdeXml separa 5% y 12% en sus propios campos — antes se colapsaban en subtotal15', () => {
  const xml = facturaCompraXml([
    detalleXml({ codigo: 'D', descripcion: 'Item 5%', cantidad: 1, precioUnitario: 40, codigoPorcentaje: '5', valorIva: 2 }),
    detalleXml({ codigo: 'E', descripcion: 'Item 12%', cantidad: 1, precioUnitario: 50, codigoPorcentaje: '2', valorIva: 6 }),
  ]);
  const { totales } = parsearFacturaCompraDesdeXml(xml);
  assert.equal(totales.subtotal5, 40);
  assert.equal(totales.subtotal12, 50);
  assert.equal(totales.subtotal15, 0);
  assert.equal(totales.totalIva, 8);
});
