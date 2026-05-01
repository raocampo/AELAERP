const prisma = require('../config/prisma');
const { asegurarConfiguracionSistemaEmpresa } = require('./configuracionSistema');

function roundStock(valor) {
  return Number(Number(valor || 0).toFixed(3));
}

async function aplicarMovimientoInventario({
  tx = prisma,
  empresaId,
  productoId,
  usuarioId = null,
  tipo,
  deltaCantidad,
  referencia = null,
  observacion = null,
  metadata = null,
  costoUnitario = null,
}) {
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, tx);
  if (!config?.inventarioHabilitado) return null;

  const producto = await tx.productos_servicios.findFirst({
    where: { id: parseInt(productoId, 10), empresaId },
  });

  if (!producto) throw new Error('Producto no encontrado para movimiento de inventario');
  if (!producto.inventariable) return null;

  const delta = roundStock(deltaCantidad);
  if (delta === 0) return null;

  const stockAnterior = roundStock(producto.stockActual);
  const stockNuevo = roundStock(stockAnterior + delta);

  if (!config.permitirStockNegativo && stockNuevo < 0) {
    throw new Error(`Stock insuficiente para ${producto.nombre}. Disponible: ${stockAnterior}`);
  }

  const productoActualizado = await tx.productos_servicios.update({
    where: { id: producto.id },
    data: {
      stockActual: stockNuevo,
      ...(costoUnitario !== null && costoUnitario !== undefined ? { costoUnitario: Number(costoUnitario) } : {}),
    },
  });

  const movimiento = await tx.movimientos_inventario.create({
    data: {
      empresaId,
      productoId: producto.id,
      usuarioId: usuarioId ? parseInt(usuarioId, 10) : null,
      tipo,
      cantidad: Math.abs(delta),
      stockAnterior,
      stockNuevo,
      costoUnitario: costoUnitario !== null && costoUnitario !== undefined
        ? Number(costoUnitario)
        : Number(productoActualizado.costoUnitario || producto.costoUnitario || 0),
      referencia,
      observacion,
      metadata,
    },
  });

  return { producto: productoActualizado, movimiento };
}

async function aplicarMovimientosVentaDesdeDetalles({
  tx = prisma,
  empresaId,
  usuarioId = null,
  detalles = [],
  tipoDocumento = 'FACTURA',
  referencia = null,
  metadata = null,
  revertir = false,
}) {
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, tx);
  if (!config?.inventarioHabilitado) return [];

  const agregados = new Map();
  detalles.forEach((detalle) => {
    const codigo = String(detalle.codigoPrincipal || '').trim().toUpperCase();
    const cantidad = roundStock(detalle.cantidad || 0);
    if (!codigo || cantidad <= 0) return;
    agregados.set(codigo, roundStock((agregados.get(codigo) || 0) + cantidad));
  });

  const codigos = [...agregados.keys()];
  if (codigos.length === 0) return [];

  const productos = await tx.productos_servicios.findMany({
    where: {
      empresaId,
      codigoPrincipal: { in: codigos },
      inventariable: true,
    },
  });

  const tipo = revertir
    ? (tipoDocumento === 'NOTA_VENTA' ? 'ANULACION_NOTA' : 'ANULACION_FACTURA')
    : (tipoDocumento === 'NOTA_VENTA' ? 'VENTA_NOTA' : 'VENTA_FACTURA');

  const resultados = [];
  for (const producto of productos) {
    const cantidad = agregados.get(producto.codigoPrincipal);
    if (!cantidad) continue;

    const delta = revertir ? cantidad : -cantidad;
    const resultado = await aplicarMovimientoInventario({
      tx,
      empresaId,
      productoId: producto.id,
      usuarioId,
      tipo,
      deltaCantidad: delta,
      referencia,
      observacion: `${revertir ? 'Reverso' : 'Salida'} automática por ${tipoDocumento.toLowerCase()}`,
      metadata,
      costoUnitario: producto.costoUnitario,
    });

    if (resultado) resultados.push(resultado);
  }

  return resultados;
}

module.exports = {
  roundStock,
  aplicarMovimientoInventario,
  aplicarMovimientosVentaDesdeDetalles,
};
