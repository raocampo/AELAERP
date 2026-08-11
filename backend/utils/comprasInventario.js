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
const { pareceNotacionCientifica, generarCodigoDesdeTexto } = require('./importacionProductos');

function limpiarCodigo(valor) {
  return String(valor || '').trim().toUpperCase();
}

// El código de una línea de compra puede venir de un XML del proveedor
// (Buzón SRI) o de un formulario donde alguien pegó un barcode copiado de
// una hoja de Excel — si ese Excel de origen no le dio formato de Texto a la
// celda, el texto pegado ya llega truncado en notación científica (ej.
// "7.80223E+12", mismo síntoma que se corrigió en leerFilasDesdeExcel para
// la importación de productos). Acá ya no hay valor numérico crudo de
// respaldo — el texto ya llegó truncado — solo se puede detectar y evitar
// guardar un código inservible, cayendo al mismo patrón de auto-generar
// desde la descripción que ya usa esa importación.
function sanearCodigoCompra(codigo, descripcion) {
  if (!pareceNotacionCientifica(codigo)) return { codigo: codigo || null, corregido: false };
  return { codigo: generarCodigoDesdeTexto(descripcion), corregido: true };
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

// ─── Similitud de nombres (detección de posibles duplicados) ─────────────────
// El matching exacto por código no detecta el caso típico "cable #8 THHN"
// (descripción del proveedor en el XML) vs "cable # 8 color verde" (nombre
// que el usuario ya usa en su catálogo) — mismo producto, código y
// descripción distintos. Se usa una similitud por conjunto de palabras
// (Jaccard) sobre el nombre normalizado: no es perfecta, pero es suficiente
// para frenar la creación automática y pedirle al usuario que confirme.
const STOPWORDS_PRODUCTO = new Set([
  'DE', 'LA', 'EL', 'LOS', 'LAS', 'Y', 'A', 'PARA', 'CON', 'DEL', 'UND', 'UNIDAD',
  'UN', 'UNA', 'X',
]);

function normalizarNombreProducto(nombre) {
  return String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .toUpperCase()
    .replace(/[#.,:;()/\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensSignificativos(nombre) {
  return normalizarNombreProducto(nombre)
    .split(' ')
    .filter((t) => t && !STOPWORDS_PRODUCTO.has(t));
}

// Similitud Jaccard (0..1) sobre tokens significativos. Exportada para poder
// testearla de forma aislada.
function similitudNombres(nombreA, nombreB) {
  const tokensA = new Set(tokensSignificativos(nombreA));
  const tokensB = new Set(tokensSignificativos(nombreB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let interseccion = 0;
  for (const t of tokensA) if (tokensB.has(t)) interseccion += 1;
  if (interseccion < 2) return 0; // exigir al menos 2 palabras en común

  const union = new Set([...tokensA, ...tokensB]).size;
  return interseccion / union;
}

const UMBRAL_POSIBLE_DUPLICADO = 0.34;

// Busca, entre los productos activos de la empresa, el más parecido por
// nombre al de la línea de compra. Devuelve { producto, score } o null si
// nada supera el umbral. No se ejecuta si ya hubo match exacto por código.
async function buscarPosibleDuplicadoPorNombre(tx, empresaId, descripcion) {
  if (!descripcion || !descripcion.trim()) return null;

  const candidatos = await tx.productos_servicios.findMany({
    where: { empresaId, activo: true },
    select: { id: true, codigoPrincipal: true, nombre: true },
  });

  let mejor = null;
  for (const candidato of candidatos) {
    const score = similitudNombres(descripcion, candidato.nombre);
    if (score >= UMBRAL_POSIBLE_DUPLICADO && (!mejor || score > mejor.score)) {
      mejor = { producto: candidato, score };
    }
  }
  return mejor;
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
    const codigoSaneado = sanearCodigoCompra(detalle.codigoPrincipal, detalle.descripcion);
    const auxiliarSaneado = pareceNotacionCientifica(detalle.codigoAuxiliar) ? null : (detalle.codigoAuxiliar || null);
    producto = await tx.productos_servicios.create({
      data: {
        empresaId,
        codigoPrincipal: codigoSaneado.codigo,
        codigoAuxiliar: auxiliarSaneado,
        nombre: detalle.descripcion,
        precioUnitario: detalle.precioVentaReferencial,
        costoUnitario: detalle.precioUnitario,
        tarifaIva: detalle.porcentajeIva,
        unidadMedida: 'UND',
        inventariable: Boolean(detalle.inventariable),
        stockActual: 0,
        stockMinimo: 0,
        activo: true,
        infoAdicional: codigoSaneado.corregido
          ? `Creado automaticamente desde factura de compra. Código original ilegible (notación científica): "${detalle.codigoPrincipal}" — verificar el código de barras real.`
          : 'Creado automaticamente desde factura de compra',
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
    const posibleDuplicado = await buscarPosibleDuplicadoPorNombre(tx, empresaId, detalle.descripcion);
    if (posibleDuplicado) {
      return {
        producto: null, creado: false, actualizado: false, esRegaloMatcheado: false,
        pendiente: true, prefijoDetectado: null,
        motivo: 'POSIBLE_DUPLICADO', productoSugeridoId: posibleDuplicado.producto.id,
      };
    }

    const codigoSaneado = sanearCodigoCompra(detalle.codigoPrincipal, detalle.descripcion);
    const auxiliarSaneado = pareceNotacionCientifica(detalle.codigoAuxiliar) ? null : (detalle.codigoAuxiliar || null);
    const creado = await tx.productos_servicios.create({
      data: {
        empresaId,
        codigoPrincipal: codigoSaneado.codigo,
        codigoAuxiliar: auxiliarSaneado,
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
        infoAdicional: codigoSaneado.corregido
          ? `Creado automaticamente desde factura de compra. Código original ilegible (notación científica): "${detalle.codigoPrincipal}" — verificar el código de barras real.`
          : 'Creado automaticamente desde factura de compra',
      },
    });
    return { producto: creado, creado: true, actualizado: false, esRegaloMatcheado: false, pendiente: false, prefijoDetectado: null };
  }

  return { producto: null, creado: false, actualizado: false, esRegaloMatcheado: false, pendiente: false, prefijoDetectado: null };
}

async function registrarItemCompraPendiente({
  tx, empresaId, compraId, detalle, prefijoDetectado,
  motivo = 'REGALO', productoSugeridoId = null,
}) {
  return tx.items_compra_pendientes.create({
    data: {
      empresaId,
      compraId,
      codigoPrincipal: detalle.codigoPrincipal,
      codigoAuxiliar: detalle.codigoAuxiliar || null,
      descripcion: detalle.descripcion,
      cantidad: detalle.cantidad,
      prefijoDetectado: prefijoDetectado || null,
      motivo,
      productoSugeridoId,
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
  similitudNombres,
  buscarPosibleDuplicadoPorNombre,
};
