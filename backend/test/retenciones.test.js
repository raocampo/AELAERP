const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parsearImpuestos,
  calcularRetencionesCompra,
  totalRetenidoCompra,
  serializarCompraPreload,
  resumirCompraBusquedaRetencion,
} = require('../utils/retenciones');

test('parsearImpuestos soporta arrays, JSON string y tolera datos inválidos', () => {
  assert.deepEqual(parsearImpuestos([{ codigo: '1' }]), [{ codigo: '1' }]);
  assert.deepEqual(parsearImpuestos('[{"codigo":"2"}]'), [{ codigo: '2' }]);
  assert.deepEqual(parsearImpuestos('{json roto}'), []);
  assert.deepEqual(parsearImpuestos(null), []);
});

test('calcularRetencionesCompra separa correctamente renta e IVA', () => {
  const totales = calcularRetencionesCompra([
    { codigo: '1', valorRetenido: '12.50' },
    { codigo: '2', valorRetenido: '4.25' },
    { codigo: '9', valorRetenido: '99.99' },
  ]);

  assert.deepEqual(totales, {
    retencionIVA: 4.25,
    retencionRenta: 12.5,
  });
});

test('totalRetenidoCompra y los serializadores exponen el acumulado esperado', () => {
  const compra = {
    id: 10,
    numeroFactura: '001-001-000000123',
    fechaEmision: new Date('2026-04-21T00:00:00.000Z'),
    tipoIdentificacionProveedor: '04',
    identificacionProveedor: '1790012345001',
    razonSocialProveedor: 'Proveedor Demo',
    nombreComercialProveedor: 'Demo Comercial',
    subtotal0: 10,
    subtotal5: 0,
    subtotal15: 90,
    totalIva: 13.5,
    importeTotal: 113.5,
    retencionIVA: 3.25,
    retencionRenta: 7.5,
    retenciones: [{ id: 1, numeroRetencion: '001-001-000000001' }],
  };

  assert.equal(totalRetenidoCompra(compra), 10.75);

  const preload = serializarCompraPreload(compra);
  assert.equal(preload.numeroDocSustento, compra.numeroFactura);
  assert.equal(preload.totalRetenidoActual, 10.75);
  assert.equal(preload.retenciones.length, 1);

  const resumen = resumirCompraBusquedaRetencion(compra);
  assert.equal(resumen.totalRetenidoActual, 10.75);
});
