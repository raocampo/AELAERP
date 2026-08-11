const test = require('node:test');
const assert = require('node:assert/strict');
const { resolverProductoCompra } = require('../utils/comprasInventario');

function crearTxFake() {
  const creados = [];
  return {
    creados,
    productos_servicios: {
      findFirst: async () => null, // nunca hay match exacto, fuerza la rama de creación
      create: async ({ data }) => {
        const producto = { id: creados.length + 1, ...data };
        creados.push(producto);
        return producto;
      },
    },
  };
}

test('resolverProductoCompra no guarda un código en notación científica — genera uno desde la descripción', async () => {
  const tx = crearTxFake();
  const resultado = await resolverProductoCompra({
    tx,
    empresaId: 1,
    detalle: {
      codigoPrincipal: '7.80223E+12',
      codigoAuxiliar: '7.80223E+12',
      descripcion: 'Rocklets chocolate 12*24*15g',
      precioVentaReferencial: 0.3,
      precioUnitario: 0.2,
      porcentajeIva: 15,
      inventariable: true,
    },
    crearProductosFaltantes: true,
  });

  assert.equal(resultado.creado, true);
  assert.notEqual(resultado.producto.codigoPrincipal, '7.80223E+12');
  assert.ok(!/e\+/i.test(resultado.producto.codigoPrincipal));
  assert.equal(resultado.producto.codigoAuxiliar, null);
  assert.match(resultado.producto.infoAdicional, /notación científica/);
});

test('resolverProductoCompra deja el código intacto cuando es válido', async () => {
  const tx = crearTxFake();
  const resultado = await resolverProductoCompra({
    tx,
    empresaId: 1,
    detalle: {
      codigoPrincipal: '7802225427777',
      codigoAuxiliar: '7802225427777',
      descripcion: 'Rocklets chocolate',
      precioVentaReferencial: 0.3,
      precioUnitario: 0.2,
      porcentajeIva: 15,
      inventariable: true,
    },
    crearProductosFaltantes: true,
  });

  assert.equal(resultado.producto.codigoPrincipal, '7802225427777');
  assert.equal(resultado.producto.codigoAuxiliar, '7802225427777');
  assert.doesNotMatch(resultado.producto.infoAdicional, /notación científica/);
});
