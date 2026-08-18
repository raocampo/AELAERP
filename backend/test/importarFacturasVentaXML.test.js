const test = require('node:test');
const assert = require('node:assert/strict');
const { parsearFacturaXML } = require('../utils/importarFacturasVentaXML');

function totalImpuestoXml({ codigoPorcentaje, base, valor }) {
  return `
    <totalImpuesto>
      <codigo>2</codigo>
      <codigoPorcentaje>${codigoPorcentaje}</codigoPorcentaje>
      <baseImponible>${base.toFixed(2)}</baseImponible>
      <valor>${valor.toFixed(2)}</valor>
    </totalImpuesto>`;
}

function detalleXml({ codigo, descripcion, cantidad, precioUnitario, codigoPorcentaje, base, valor }) {
  return `
    <detalle>
      <codigoPrincipal>${codigo}</codigoPrincipal>
      <descripcion>${descripcion}</descripcion>
      <cantidad>${cantidad}</cantidad>
      <precioUnitario>${precioUnitario}</precioUnitario>
      <descuento>0</descuento>
      <precioTotalSinImpuesto>${base.toFixed(2)}</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>${codigoPorcentaje}</codigoPorcentaje>
          <baseImponible>${base.toFixed(2)}</baseImponible>
          <valor>${valor.toFixed(2)}</valor>
        </impuesto>
      </impuestos>
    </detalle>`;
}

function facturaXml({ totalImpuestosXml, detallesXml }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <factura id="comprobante" version="1.0.0">
      <infoTributaria>
        <ruc>1790016919001</ruc>
        <razonSocial>EMISOR TEST</razonSocial>
        <estab>001</estab>
        <ptoEmi>001</ptoEmi>
        <secuencial>000000001</secuencial>
        <claveAcceso>${'0'.repeat(49)}</claveAcceso>
      </infoTributaria>
      <infoFactura>
        <fechaEmision>01/07/2026</fechaEmision>
        <tipoIdentificacionComprador>05</tipoIdentificacionComprador>
        <identificacionComprador>1104196546</identificacionComprador>
        <razonSocialComprador>COMPRADOR TEST</razonSocialComprador>
        <totalDescuento>0</totalDescuento>
        <totalConImpuestos>${totalImpuestosXml.join('')}</totalConImpuestos>
        <propina>0</propina>
        <importeTotal>1000.00</importeTotal>
      </infoFactura>
      <detalles>${detallesXml.join('')}</detalles>
    </factura>`;
}

test('parsearFacturaXML separa No Objeto/Exento usando codigoPorcentaje, no el campo <codigo> (siempre "2" para IVA) — antes se mezclaban con subtotal0', () => {
  const xml = facturaXml({
    totalImpuestosXml: [
      totalImpuestoXml({ codigoPorcentaje: '0', base: 10, valor: 0 }),
      totalImpuestoXml({ codigoPorcentaje: '6', base: 20, valor: 0 }),
      totalImpuestoXml({ codigoPorcentaje: '7', base: 30, valor: 0 }),
      totalImpuestoXml({ codigoPorcentaje: '4', base: 100, valor: 15 }),
    ],
    detallesXml: [
      detalleXml({ codigo: 'A', descripcion: 'Item 0%', cantidad: 1, precioUnitario: 10, codigoPorcentaje: '0', base: 10, valor: 0 }),
      detalleXml({ codigo: 'B', descripcion: 'Item No Objeto', cantidad: 1, precioUnitario: 20, codigoPorcentaje: '6', base: 20, valor: 0 }),
      detalleXml({ codigo: 'C', descripcion: 'Item Exento', cantidad: 1, precioUnitario: 30, codigoPorcentaje: '7', base: 30, valor: 0 }),
      detalleXml({ codigo: 'D', descripcion: 'Item 15%', cantidad: 1, precioUnitario: 100, codigoPorcentaje: '4', base: 100, valor: 15 }),
    ],
  });

  const datos = parsearFacturaXML(xml);
  assert.equal(datos.subtotal0, 10);
  assert.equal(datos.subtotalNoObjetoIva, 50); // 20 No Objeto + 30 Exento combinados
  assert.equal(datos.subtotal15, 100);
  assert.equal(datos.totalIva, 15);

  assert.equal(datos.detalles[0].ivaPorcentaje, 0);
  assert.equal(datos.detalles[1].ivaPorcentaje, 6);
  assert.equal(datos.detalles[2].ivaPorcentaje, 7);
  assert.equal(datos.detalles[3].ivaPorcentaje, 15);
});
