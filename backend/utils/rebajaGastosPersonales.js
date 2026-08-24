// ====================================
// REBAJA POR GASTOS PERSONALES — Impuesto a la Renta, personas naturales
// backend/utils/rebajaGastosPersonales.js
//
// Metodología vigente desde 2022 (Ley Orgánica de Desarrollo Económico):
// la rebaja es un CRÉDITO TRIBUTARIO — se resta del impuesto YA CALCULADO
// con la tabla progresiva, NO se resta de la base imponible antes de
// aplicar la tabla (esa era la metodología pre-2022). talentoHumano.js
// tenía un parámetro `gastosPersonalesAnuales` con la metodología vieja,
// pero nadie le pasaba un valor ≠ 0 — nunca se detectó en producción
// hasta la investigación del Anexo RDEP (2026-08-20/24).
//
// Fuente: Boletín SRI NAC-COM-26-006 (6 de febrero de 2026), tabla
// oficial de topes para el ejercicio fiscal 2026, y Reglamento LRTI
// (rebaja = 18% del menor valor entre gastos declarados y el tope por
// canastas familiares básicas según cargas familiares).
// ====================================

// Canasta Familiar Básica de enero del año fiscal (actualizar cada año
// con el boletín que publica el SRI en enero/febrero).
const CFB_2026 = 821.80;
const PORCENTAJE_REBAJA = 0.18;
const CANASTAS_DISCAPACIDAD_O_ENFERMEDAD = 100;

// Número de canastas según cargas familiares (Boletín NAC-COM-26-006):
// 0→7, 1→9, 2→11, 3→14, 4→17, 5 o más→20.
const CANASTAS_POR_CARGAS = [
  { cargasMax: 0, canastas: 7 },
  { cargasMax: 1, canastas: 9 },
  { cargasMax: 2, canastas: 11 },
  { cargasMax: 3, canastas: 14 },
  { cargasMax: 4, canastas: 17 },
  { cargasMax: Infinity, canastas: 20 },
];

function _numeroCanastas(cargasFamiliares, tieneDiscapacidadOEnfermedadCatastrofica) {
  if (tieneDiscapacidadOEnfermedadCatastrofica) return CANASTAS_DISCAPACIDAD_O_ENFERMEDAD;
  const tramo = CANASTAS_POR_CARGAS.find((t) => cargasFamiliares <= t.cargasMax);
  return tramo.canastas;
}

/**
 * Calcula la rebaja de gastos personales (crédito tributario, se resta del
 * IR anual ya calculado con la tabla progresiva — no de la base imponible).
 * @param {number} gastosPersonalesProyectados - total anual proyectado/declarado.
 * @param {number} [cargasFamiliares=0]
 * @param {boolean} [tieneDiscapacidadOEnfermedadCatastrofica=false] - trabajador
 *   o alguna de sus cargas con discapacidad, enfermedad catastrófica, rara o huérfana.
 * @returns {{ canastas: number, topeGastos: number, gastosConsiderados: number, rebaja: number }}
 */
function calcularRebajaGastosPersonales({
  gastosPersonalesProyectados = 0,
  cargasFamiliares = 0,
  tieneDiscapacidadOEnfermedadCatastrofica = false,
}) {
  const canastas = _numeroCanastas(cargasFamiliares, tieneDiscapacidadOEnfermedadCatastrofica);
  const topeGastos = +(CFB_2026 * canastas).toFixed(2);
  const gastosConsiderados = Math.min(Math.max(0, gastosPersonalesProyectados), topeGastos);
  const rebaja = +(gastosConsiderados * PORCENTAJE_REBAJA).toFixed(2);
  return { canastas, topeGastos, gastosConsiderados, rebaja };
}

module.exports = { calcularRebajaGastosPersonales, CFB_2026, PORCENTAJE_REBAJA };
