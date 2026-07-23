// ====================================
// utils/comprasInventario.js — AELA
// Resolución de producto para líneas de detalle de compra, compartida por
// los 3 lugares que auto-crean productos: POST /compras, POST
// /compras/:id/registrar-inventario, y el import del Buzón SRI (buzon.js).
//
// Motivo: los proveedores a veces facturan ítems de regalo/combo a $0.00 con
// un código derivado del producto real mediante un prefijo (ej. "P-1043664"
// ligado al producto real "1043664"). El matching exacto por código siempre
// creaba un producto nuevo e independiente para estos ítems. Ahora, un ítem a
// $0.00 que matchea por prefijo contra un "hermano" en la misma factura suma
// su cantidad al producto real; si no matchea con nada, se registra en
// items_compra_pendientes en vez de crear un producto huérfano.
// ====================================
const { PREFIJOS_REGALO_DEFAULT } = require('./configuracionSistema');

function limpiarCodigo(valor) {
  return String(valor || '').trim().toUpperCase();
}

// Quita el primer prefijo de la lista que matchee al inicio del código
// (case-insensitive). Devuelve { codigoBase, prefijo } — prefijo es null si
// ninguno de la lista aplica.
function normalizarCodigoSinPrefijo(codigo, prefijos = PREFIJOS_REGALO_DEFAULT) {
  const c = limpiarCodigo(codigo);
  for (const p of prefijos) {
    const prefijo = limpiarCodigo(p);
    if (prefijo && c.startsWith(prefijo) && c.length > prefijo.length) {
      return { codigoBase: c.slice(prefijo.length), prefijo };
    }
  }
  return { codigoBase: c, prefijo: null };
}

// ─── Match exacto (productoId / codigoPrincipal / codigoAuxiliar) ────────────
// Comportamiento sin cambios respecto al histórico buscarProductoCoincidente.
async function buscarProductoCoincidente(tx, empresaId, detalle) {
  if (detalle.productoId) {
    const porId = await tx.productos_servicios.findFirst({
      where: { id: detalle.productoId, empresaId },
    });
    if (porId) return porId;
  }

  if (detalle.codigoPrincipal) {
    const porCodigo = await tx.productos_servicios.findFirst({
      where: { empresaId, codigoPrincipal: detalle.codigoPrincipal },
    });
    if (porCodigo) return porCodigo;
  }

  if (detalle.codigoAuxiliar) {
    return tx.productos_servicios.findFirst({
      where: { empresaId, codigoAuxiliar: detalle.codigoAuxiliar },
    });
  }

  return null;
}

// ─── Match exacto + crear/actualizar (comportamiento histórico íntegro) ──────
async function resolverProductoCompra({
  tx,
  empresaId,
  detalle,
  crearProductosFaltantes = false,
  actualizarProductosExistentes = true,
}) {
  let producto = await buscarProductoCoincidente(tx, empresaId, detalle);

  if (!producto && !crearProductosFaltantes) return null;

  if (!producto) {
    producto = await tx.productos_servicios.create({
      data: {
        empresaId,
        codigoPrincipal: detalle.codigoPrincipal,
        codigoAuxiliar: detalle.codigoAuxiliar || null,
        nombre: detalle.descripcion,
        precioUnitario: detalle.precioVentaReferencial,
        costoUnitario: detalle.precioUnitario,
        tarifaIva: detalle.porcentajeIva,
        unidadMedida: 'UND',
        inventariable: Boolean(detalle.inventariable),
        stockActual: 0,
        stockMinimo: 0,
        activo: true,
        infoAdicional: 'Creado automaticamente desde factura de compra',
      },
    });
    return { producto, creado: true, actualizado: false };
  }

  if (!actualizarProductosExistentes) {
    return { producto, creado: false, actualizado: false };
  }

  const actualizado = await tx.productos_servicios.update({
    where: { id: producto.id },
    data: {
      codigoAuxiliar: detalle.codigoAuxiliar || producto.codigoAuxiliar,
      nombre: producto.nombre || detalle.descripcion,
      costoUnitario: detalle.precioUnitario,
      tarifaIva: detalle.porcentajeIva,
      inventariable: producto.inventariable || Boolean(detalle.inventariable),
      ...(detalle.utilidadPct != null || Number(producto.precioUnitario || 0) <= 0
        ? { precioUnitario: detalle.precioVentaReferencial }
        : {}),
    },
  });

  return { producto: actualizado, creado: false, actualizado: true };
}

/**
 * Resuelve el producto para una línea de detalle de compra, con 3 niveles:
 *  1. Match exacto (productoId / codigoPrincipal / codigoAuxiliar) — SIN
 *     CAMBIOS respecto al comportamiento histórico.
 *  2. Si no hay match exacto Y el precio es $0.00: intenta match por prefijo
 *     contra las demás líneas de la MISMA compra (`detallesTodos`). Si
 *     encuentra un "hermano" cuyo producto ya existe en catálogo, retorna ese
 *     producto con `esRegaloMatcheado: true` (el caller debe sumar la
 *     cantidad SIN pasar costoUnitario, para no sobreescribir el costo real
 *     del producto con $0).
 *  3. Si no hay match en (1) ni (2):
 *       - si `crearProductosFaltantes` → comportamiento legado: crea producto.
 *       - si no y el ítem es a costo $0 → { pendiente: true }, el caller debe
 *         insertar en items_compra_pendientes en vez de crear un producto.
 *       - si no y el ítem tiene costo > 0 → { producto: null } (comportamiento
 *         legado sin cambios: se omite silenciosamente / se reporta como
 *         "no encontrado", según el caller).
 */
async function resolverOMarcarPendiente({
  tx,
  empresaId,
  detalle,
  detallesTodos = [],
  crearProductosFaltantes = false,
  actualizarProductosExistentes = true,
  prefijosRegalo = null,
}) {
  const resolucionExacta = await resolverProductoCompra({
    tx, empresaId, detalle,
    crearProductosFaltantes: false,
    actualizarProductosExistentes,
  });

  if (resolucionExacta) {
    return { ...resolucionExacta, esRegaloMatcheado: false, pendiente: false, prefijoDetectado: null };
  }

  const esCosto0 = Number(detalle.precioUnitario) <= 0;

  if (esCosto0) {
    const prefijos = Array.isArray(prefijosRegalo) && prefijosRegalo.length > 0 ? prefijosRegalo : PREFIJOS_REGALO_DEFAULT;
    const { codigoBase, prefijo } = normalizarCodigoSinPrefijo(detalle.codigoPrincipal, prefijos);

    if (prefijo) {
      const hermano = detallesTodos.find((d) => d !== detalle && limpiarCodigo(d.codigoPrincipal) === codigoBase);
      if (hermano) {
        const prodHermano = await buscarProductoCoincidente(tx, empresaId, hermano);
        if (prodHermano) {
          return {
            producto: prodHermano, creado: false, actualizado: false,
            esRegaloMatcheado: true, pendiente: false, prefijoDetectado: prefijo,
          };
        }
      }
    }

    if (!crearProductosFaltantes) {
      return { producto: null, creado: false, actualizado: false, esRegaloMatcheado: false, pendiente: true, prefijoDetectado: prefijo };
    }
  }

  if (crearProductosFaltantes) {
    const creado = await tx.productos_servicios.create({
      data: {
        empresaId,
        codigoPrincipal: detalle.codigoPrincipal,
        codigoAuxiliar: detalle.codigoAuxiliar || null,
        nombre: detalle.descripcion,
        // precioVentaReferencial no siempre viene poblado (ej. detalles parseados
        // directo de un XML del Buzón SRI) — usar el costo como fallback de PVP.
        precioUnitario: detalle.precioVentaReferencial ?? detalle.precioUnitario ?? 0,
        costoUnitario: detalle.precioUnitario ?? 0,
        tarifaIva: detalle.porcentajeIva ?? 0,
        unidadMedida: 'UND',
        inventariable: detalle.inventariable !== false,
        stockActual: 0,
        stockMinimo: 0,
        activo: true,
        infoAdicional: 'Creado automaticamente desde factura de compra',
      },
    });
    return { producto: creado, creado: true, actualizado: false, esRegaloMatcheado: false, pendiente: false, prefijoDetectado: null };
  }

  return { producto: null, creado: false, actualizado: false, esRegaloMatcheado: false, pendiente: false, prefijoDetectado: null };
}

async function registrarItemCompraPendiente({ tx, empresaId, compraId, detalle, prefijoDetectado }) {
  return tx.items_compra_pendientes.create({
    data: {
      empresaId,
      compraId,
      codigoPrincipal: detalle.codigoPrincipal,
      codigoAuxiliar: detalle.codigoAuxiliar || null,
      descripcion: detalle.descripcion,
      cantidad: detalle.cantidad,
      prefijoDetectado: prefijoDetectado || null,
      estado: 'PENDIENTE',
    },
  });
}

module.exports = {
  buscarProductoCoincidente,
  resolverProductoCompra,
  resolverOMarcarPendiente,
  registrarItemCompraPendiente,
  normalizarCodigoSinPrefijo,
};
