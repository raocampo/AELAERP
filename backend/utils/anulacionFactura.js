// ====================================
// utils/anulacionFactura.js — Ventana libre de anulación de facturas AUTORIZADAS
// ====================================
// Regla de negocio (pedida por el usuario 2026-08-27): al anular una factura
// ya autorizada por el SRI, el emisor puede elegir entre emitir una Nota de
// Crédito o anularla directamente sin NC (avisando que debe además anularla
// manualmente en el portal del SRI) — pero solo dentro de una ventana libre.
// A partir del día 7 del mes siguiente al de la fecha de emisión, esa opción
// ya no se ofrece: se fuerza el procedimiento histórico del sistema (NC
// automática al 100%), sin importar lo que el cliente envíe en `crearNC`.
//
// Ejemplo dado por el usuario: factura del 15 de agosto, si se pide anular
// el 8 de septiembre, ya no se debe presentar la opción — se procede
// automáticamente con NC, igual que hoy.
function requiereNCAutomaticaPorVentana(fechaEmision, fechaActual = new Date()) {
  const fe = new Date(fechaEmision);
  if (Number.isNaN(fe.getTime())) return true;
  const corte = new Date(fe.getFullYear(), fe.getMonth() + 1, 7);
  return new Date(fechaActual) >= corte;
}

module.exports = { requiereNCAutomaticaPorVentana };
