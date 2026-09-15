// ====================================
// DESCUENTO GENERAL (después del subtotal) — POS y Factura
// frontend/src/utils/descuentoGeneral.js
// ====================================
//
// El SRI no tiene un campo de "descuento general" en el XML de factura
// electrónica — todo descuento se reporta por línea (<detalle><descuento>).
// Para poder ofrecer un descuento general en la UI sin dejar de ser
// SRI-compliant, se reparte a prorrata (según el peso de cada línea, ya
// descontada su propia línea de descuento, en el subtotal) y se SUMA al
// `descuento` de cada línea antes de enviarla al backend — que ya sabe
// calcular impuestos y totales a partir de `detalle.descuento` (no hace
// falta ningún cambio de backend: generarXMLFactura/calcularTotalesDetalle
// ya derivan todo de ahí).
//
// Redondeo: reparto exacto en centavos por el método del mayor remanente
// (largest remainder). Antes cada línea (salvo la última) se redondeaba a 2
// decimales de forma independiente y la última recibía "lo que faltaba" —
// si el redondeo hacia arriba de las demás líneas acumulaba más de lo que
// correspondía, esa resta podía dar negativo. Pasó en producción: el SRI
// rechazó una factura por `descuento` = -0.01 (error 35,
// cvc-minInclusive-valid, 2026-09-14). El método actual reparte centavos
// enteros y nunca resta — cada línea solo puede sumar centavos, así que el
// resultado siempre es >= 0 por construcción, y la suma exacta sigue
// cuadrando con el monto general ingresado.

/**
 * Reparte `montoGeneral` entre `detalles` a prorrata de su base
 * (cantidad × precioUnitario − descuento de línea) y lo suma al
 * `descuento` de cada línea. Si `montoGeneral` es 0/vacío o la suma de
 * bases es 0, devuelve `detalles` sin modificar.
 *
 * @param {Array<{cantidad:number|string, precioUnitario:number|string, descuento?:number|string}>} detalles
 * @param {number|string} montoGeneral
 * @returns {Array} mismos objetos de `detalles`, con `descuento` ajustado
 */
export function distribuirDescuentoGeneral(detalles, montoGeneral) {
  const dg = Number(montoGeneral) || 0;
  if (!Array.isArray(detalles) || detalles.length === 0 || dg <= 0) return detalles;

  const bases = detalles.map((d) => {
    const cant = Number(d.cantidad) || 0;
    const precio = Number(d.precioUnitario) || 0;
    const descLinea = Number(d.descuento) || 0;
    return Math.max(0, cant * precio - descLinea);
  });
  const sumaBase = bases.reduce((a, b) => a + b, 0);
  if (sumaBase <= 0) return detalles;

  // Todo el reparto se hace en centavos enteros para que sea exacto y
  // nunca negativo: se reparte el "piso" de cada porción y los centavos
  // sobrantes (siempre entre 0 y detalles.length-1) van a las líneas con
  // mayor parte fraccionaria — nunca se resta, solo se suma.
  const totalCentavos = Math.round(dg * 100);
  const rawCentavos = bases.map((b) => (b / sumaBase) * totalCentavos);
  const centavosPorLinea = rawCentavos.map((v) => Math.floor(v));
  let restante = totalCentavos - centavosPorLinea.reduce((a, b) => a + b, 0);

  const ordenPorFraccion = rawCentavos
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < restante; k++) {
    centavosPorLinea[ordenPorFraccion[k % ordenPorFraccion.length].i] += 1;
  }

  return detalles.map((d, i) => {
    const porcion = centavosPorLinea[i] / 100;
    return { ...d, descuento: Number(((Number(d.descuento) || 0) + porcion).toFixed(2)) };
  });
}

/**
 * Suma de (cantidad × precioUnitario − descuento) de todas las líneas —
 * el subtotal ANTES del descuento general, usado para validar que este
 * no sea mayor a lo que hay para descontar.
 */
export function subtotalBase(detalles) {
  if (!Array.isArray(detalles)) return 0;
  return detalles.reduce((acc, d) => {
    const cant = Number(d.cantidad) || 0;
    const precio = Number(d.precioUnitario) || 0;
    const descLinea = Number(d.descuento) || 0;
    return acc + Math.max(0, cant * precio - descLinea);
  }, 0);
}
