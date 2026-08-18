// ============================================================
//  Reglas fiscales compartidas para facturas_compra: cédula vs RUC.
//  Usado por routes/declaraciones.js (F104, F101) y routes/facturas.js
//  (reporte tributario) — un solo lugar para no repetir la regla 3 veces.
//
//  ⚠️ NO usar en routes/ats.js. condicionComprasDeducibles() responde
//  "¿esta compra da derecho a crédito tributario/deducción?" — una
//  pregunta de F104/F101. El ATS es un reporte TRANSACCIONAL (informa al
//  SRI qué compras existieron, para que cruce contra lo que cada
//  proveedor declaró vender) — ahí la pregunta correcta es simplemente
//  "¿existió la compra?", sin importar si ya es deducible o no. Se
//  intentó aplicar esta regla al ATS el 2026-08-18 por la mañana y se
//  revirtió esa misma tarde al confirmar con un reporte real que el ATS
//  estaba sub-reportando transacciones reales al SRI — un riesgo de
//  cumplimiento mayor que el que se intentaba resolver. Ver
//  docs/pendientes-2026-08-18.md para el caso completo.
// ============================================================

// A partir de esta fecha se exige que el contador revise y apruebe
// manualmente (aprobadaPorContador) una compra facturada a cédula para que
// cuente en el crédito tributario de IVA (F104) y en el F101. Las compras
// anteriores son parte de contabilidad atrasada que un cliente está poniendo
// al día — cuentan automáticamente, sin necesidad del check (pedido
// explícito del cliente, 2026-07-27).
const CUTOFF_APROBACION_CEDULA = new Date('2026-01-01T00:00:00.000Z');

// OR de inclusión para el where de facturas_compra: cuenta si...
//   1. receptorEsRuc es null (compras manuales/históricas sin XML), o
//   2. receptorEsRuc es true (facturada al RUC de la empresa), o
//   3. el contador ya la aprobó manualmente, o
//   4. es de antes del corte (contabilidad atrasada, sin check requerido).
// esGastoPersonal se filtra aparte (manda siempre, sin excepción).
function condicionComprasDeducibles() {
  return [
    { receptorEsRuc: null },
    { receptorEsRuc: true },
    { aprobadaPorContador: true },
    { fechaEmision: { lt: CUTOFF_APROBACION_CEDULA } },
  ];
}

// True si esta compra facturada a cédula todavía necesita que el contador la
// revise (es de después del corte y nadie la aprobó todavía).
function necesitaRevisionCedula(fechaEmision) {
  return new Date(fechaEmision) >= CUTOFF_APROBACION_CEDULA;
}

module.exports = { CUTOFF_APROBACION_CEDULA, condicionComprasDeducibles, necesitaRevisionCedula };
