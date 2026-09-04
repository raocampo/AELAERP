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
// Redondeo: cada línea (salvo la última) se redondea a 2 decimales; la
// última línea recibe el remanente exacto — así la suma de las porciones
// siempre cuadra exactamente con el monto general ingresado, sin
// diferencias de centavos por acumulación de redondeos.

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

  let acumulado = 0;
  return detalles.map((d, i) => {
    const esUltimo = i === detalles.length - 1;
    const porcion = esUltimo
      ? Number((dg - acumulado).toFixed(2))
      : Number(((bases[i] / sumaBase) * dg).toFixed(2));
    if (!esUltimo) acumulado += porcion;
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
