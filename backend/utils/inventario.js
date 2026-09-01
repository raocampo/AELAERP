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

// Máximo de ítems en catálogo para el plan Lite — mismo tope que
// checkLimiteProductos (middleware/edition.js), duplicado acá porque ese
// middleware depende de `req` y esto corre dentro de una transacción sin
// acceso a la request.
const LIMITE_PRODUCTOS_LITE = 200;

// Crea en el catálogo, ANTES de aplicar los movimientos de venta, los
// productos nuevos que el usuario pidió explícitamente agregar desde una
// línea manual de POS/Factura/Nota de Venta (checkbox "Añadir al
// catálogo" — ver PuntoVenta.jsx). Idempotente: si el código ya existe
// (fue creado por otra línea de la misma venta, o ya estaba en el
// catálogo) no hace nada con él. Solo llamar en el sentido "aplicar"
// (nunca al revertir/anular — ver aplicarMovimientosVentaDesdeDetalles).
async function _asegurarProductosDesdeDetalles({ tx, empresaId, detalles }) {
  const porCodigo = new Map();
  for (const d of detalles) {
    if (!d?.crearEnCatalogo) continue;
    const codigo = String(d.codigoPrincipal || '').trim().toUpperCase();
    if (!codigo || porCodigo.has(codigo)) continue;
    porCodigo.set(codigo, d);
  }
  if (porCodigo.size === 0) return;

  const codigos = [...porCodigo.keys()];
  const existentes = await tx.productos_servicios.findMany({
    where: { empresaId, codigoPrincipal: { in: codigos } },
    select: { codigoPrincipal: true },
  });
  const yaExisten = new Set(existentes.map((p) => p.codigoPrincipal));
  const faltantes = codigos.filter((c) => !yaExisten.has(c));
  if (faltantes.length === 0) return;

  const empresa = await tx.empresas.findUnique({ where: { id: empresaId }, select: { plan: true } });
  const plan = empresa?.plan === 'full' ? 'pro' : (empresa?.plan || 'pro');
  if (plan === 'lite') {
    const total = await tx.productos_servicios.count({ where: { empresaId } });
    if (total + faltantes.length > LIMITE_PRODUCTOS_LITE) {
      throw new Error(`El plan AELA Lite permite un máximo de ${LIMITE_PRODUCTOS_LITE} productos en el catálogo. Desmarca "Añadir al catálogo" en la línea manual, o actualiza de plan.`);
    }
  }

  for (const codigo of faltantes) {
    const d = porCodigo.get(codigo);
    try {
      await tx.productos_servicios.create({
        data: {
          empresaId,
          codigoPrincipal: codigo,
          nombre: String(d.descripcion || codigo).trim().slice(0, 300) || codigo,
          precioUnitario: Number(d.precioUnitario || 0),
          tarifaIva: Number(d.ivaPorcentaje ?? d.tarifaIva ?? 15),
          inventariable: true,
          unidadMedida: 'UND',
        },
      });
    } catch (err) {
      // P2002 = ya lo creó otra línea de la misma venta con el mismo
      // código (carrera dentro de la propia transacción) — no es un error.
      if (err.code !== 'P2002') throw err;
    }
  }
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

  if (!revertir) {
    await _asegurarProductosDesdeDetalles({ tx, empresaId, detalles });
  }

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
