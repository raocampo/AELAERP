// Helpers puros de Proformas, compartidos entre backend/routes/proformas.js
// y backend/routes/vendedor.js (Fase 2 — Pedidos del vendedor son proformas
// creadas por un wrapper fino). Extraído de proformas.js sin cambiar lógica.

async function siguienteSecuencial(prisma, empresaId) {
  const last = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX("secuencial"), 0) + 1 AS next FROM proformas WHERE "empresaId" = $1`,
    empresaId
  );
  return parseInt(last[0]?.next || 1, 10);
}

function formatNumero(sec) {
  return `PRF-001-${String(sec).padStart(9, '0')}`;
}

function calcularTotales(detalles) {
  let sub0 = 0, sub5 = 0, sub15 = 0, totalDesc = 0, totalIva = 0;
  for (const d of detalles) {
    const cant   = parseFloat(d.cantidad)       || 0;
    const precio = parseFloat(d.precioUnitario) || 0;
    const desc   = parseFloat(d.descuento)      || 0;
    const iva    = parseInt(d.ivaPorcentaje)    || 0;
    const sub    = cant * precio - desc;
    totalDesc += desc;
    if (iva === 0 || iva === 6 || iva === 7) sub0  += sub;
    if (iva === 5)  sub5  += sub;
    if (iva === 15) sub15 += sub;
    if (iva === 5)  totalIva += sub * 0.05;
    if (iva === 15) totalIva += sub * 0.15;
  }
  return {
    subtotal0:      parseFloat(sub0.toFixed(2)),
    subtotal5:      parseFloat(sub5.toFixed(2)),
    subtotal15:     parseFloat(sub15.toFixed(2)),
    totalDescuento: parseFloat(totalDesc.toFixed(2)),
    totalIva:       parseFloat(totalIva.toFixed(2)),
    importeTotal:   parseFloat((sub0 + sub5 + sub15 + totalIva).toFixed(2)),
  };
}

module.exports = { siguienteSecuencial, formatNumero, calcularTotales };
