// ====================================
// TABLA PROGRESIVA DE IMPUESTO A LA RENTA — Personas Naturales, Ecuador
// backend/utils/tablaRentaPN.js
//
// Fuente única de esta tabla — antes vivía duplicada en talentoHumano.js
// (retención mensual a empleados) y ahora también la usa declaraciones.js
// (Anticipo de Impuesto a la Renta, F101). Un solo lugar evita que quede
// una copia desactualizada cuando el SRI publique la tabla del año
// siguiente (ya pasó una vez: TABLA_LORTI_2024 quedó vigente en producción
// hasta 2026-08-21, ver memoria del proyecto).
// ====================================

// Fuente: SRI, Resolución NAC-DGERCGC25-00000043 (vigente desde 01/01/2026).
// Actualizar cada año con la resolución que publica el SRI en diciembre.
// Cada fila: [fracciónDesde, fracciónHasta, impuestoFraccionBasica, porcentajeExcedente]
const TABLA_LORTI_2026 = [
  [       0,  12_208,      0, 0.00],
  [  12_208,  15_549,      0, 0.05],
  [  15_549,  20_188,    167, 0.10],
  [  20_188,  26_700,    631, 0.12],
  [  26_700,  35_136,  1_412, 0.15],
  [  35_136,  46_575,  2_678, 0.20],
  [  46_575,  62_005,  4_965, 0.25],
  [  62_005,  82_679,  8_823, 0.30],
  [  82_679, 109_956, 15_025, 0.35],
  [ 109_956, Infinity, 24_572, 0.37],
];

/**
 * Aplica la tabla progresiva LORTI a una base imponible ANUAL y devuelve el
 * impuesto a la renta anual causado (personas naturales / RIMPE no aplica).
 * @param {number} baseImponible - base imponible anual, ya neta de deducciones.
 * @returns {number} impuesto a la renta anual, redondeado a 2 decimales.
 */
function aplicarTablaProgresivaRenta(baseImponible) {
  const base = Math.max(0, baseImponible);
  let irAnual = 0;
  for (const [desde, hasta, impFB, pctExc] of TABLA_LORTI_2026) {
    if (base > desde) {
      const excedente = Math.min(base, hasta === Infinity ? base : hasta) - desde;
      irAnual = impFB + excedente * pctExc;
    }
  }
  return Math.max(0, +irAnual.toFixed(2));
}

module.exports = { TABLA_LORTI_2026, aplicarTablaProgresivaRenta };
