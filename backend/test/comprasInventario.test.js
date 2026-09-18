const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolverProductoCompra,
  buscarProductoCoincidente,
  buscarPosibleDuplicadoPorNombre,
  pareceMismoProductoEmpacado,
  registrarItemCompraPendiente,
} = require('../utils/comprasInventario');

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
    codigos_compra_alternos: {
      findFirst: async () => null, // sin alias registrado, salvo que un test lo sobreescriba
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

test('buscarProductoCoincidente resuelve por alias de codigos_compra_alternos cuando no hay match exacto, con el factor del alias', async () => {
  const productoReal = { id: 42, empresaId: 1, codigoPrincipal: '7861021705199', unidadesPorPaquete: 1 };
  const tx = {
    productos_servicios: {
      findFirst: async ({ where }) => (where.id === 42 ? productoReal : null),
    },
    codigos_compra_alternos: {
      findFirst: async ({ where }) => (
        where.codigo.in.includes('EU20079P') ? { productoId: 42, unidadesEquivalentes: 8 } : null
      ),
    },
  };

  const resultado = await buscarProductoCoincidente(tx, 1, { codigoPrincipal: 'EU20079P' });

  assert.equal(resultado.id, 42);
  assert.equal(resultado.unidadesPorPaquete, 8); // sobreescrito por el alias, no toca el producto real
});

test('buscarProductoCoincidente no usa un producto desactivado ni por match exacto', async () => {
  const tx = {
    productos_servicios: {
      // Simula la fila real: existe con ese código pero está inactiva
      // (fusionada) — no debe devolverse, para que el alias tome el control.
      findFirst: async ({ where }) => (where.activo === true ? null : { id: 1, activo: false }),
    },
    codigos_compra_alternos: { findFirst: async () => null },
  };

  const resultado = await buscarProductoCoincidente(tx, 1, { codigoPrincipal: 'EU20079P' });
  assert.equal(resultado, null);
});

test('pareceMismoProductoEmpacado detecta el caso real que el Jaccard estricto no atrapa', () => {
  assert.equal(
    pareceMismoProductoEmpacado('SALCHICHA CARNE LA EUROPEA 400G', 'SALCHICHA LONCHERA X8 EUROPEA 400GR/50'),
    true,
  );
  assert.equal(
    pareceMismoProductoEmpacado('AFEITADORA SCHICK  XTREME3', 'SCHICK AFEITADORA XTREME III HOMBRE DPLx12/12'),
    true,
  );
  // Sin marcador de empaque en ninguno de los 2 nombres, no debe activarse
  // (evita falsos positivos entre productos legítimamente distintos).
  assert.equal(pareceMismoProductoEmpacado('AVENA QUAKER 250G', 'AVENA QUAKER 500G'), false);
});

test('buscarPosibleDuplicadoPorNombre marca POSIBLE_DUPLICADO por marcador de empaque aunque el Jaccard no llegue al umbral', async () => {
  const tx = {
    productos_servicios: {
      findMany: async () => [
        { id: 5, codigoPrincipal: '7861021705199', nombre: 'SALCHICHA CARNE LA EUROPEA 400G' },
      ],
    },
  };

  const resultado = await buscarPosibleDuplicadoPorNombre(tx, 1, 'SALCHICHA LONCHERA X8 EUROPEA 400GR/50');
  assert.ok(resultado);
  assert.equal(resultado.producto.id, 5);
});

test('registrarItemCompraPendiente guarda el costo/PVP/IVA ya calculados de la línea — sin esto "Crear producto nuevo" quedaba en $0.00 (caso real Comercial S&S, Coca Cola 2026-09-16)', async () => {
  let guardado = null;
  const tx = {
    items_compra_pendientes: {
      create: async ({ data }) => { guardado = data; return { id: 1, ...data }; },
    },
  };

  await registrarItemCompraPendiente({
    tx,
    empresaId: 1,
    compraId: 103,
    detalle: {
      codigoPrincipal: '7860094',
      descripcion: 'COCA COLA',
      cantidad: 24,
      precioUnitario: 0.6522,
      precioVentaReferencial: 0.74,
      porcentajeIva: 15,
    },
    motivo: 'POSIBLE_DUPLICADO',
    productoSugeridoId: 855,
  });

  assert.equal(guardado.costoUnitario, 0.6522);
  assert.equal(guardado.precioVentaReferencial, 0.74);
  assert.equal(guardado.porcentajeIva, 15);
});

test('registrarItemCompraPendiente guarda null si la línea no trae costo/PVP (no inventa un valor)', async () => {
  let guardado = null;
  const tx = {
    items_compra_pendientes: {
      create: async ({ data }) => { guardado = data; return { id: 1, ...data }; },
    },
  };

  await registrarItemCompraPendiente({
    tx,
    empresaId: 1,
    compraId: 1,
    detalle: { codigoPrincipal: 'ABC', descripcion: 'Regalo', cantidad: 1 },
  });

  assert.equal(guardado.costoUnitario, null);
  assert.equal(guardado.precioVentaReferencial, null);
  assert.equal(guardado.porcentajeIva, null);
});
