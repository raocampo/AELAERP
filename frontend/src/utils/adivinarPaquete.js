// Intenta adivinar cuántas unidades individuales trae un ítem a partir de
// marcadores comunes en el nombre que le pone el proveedor (ej. "SALCHICHA
// LONCHERA X8 EUROPEA 400GR/50" → 8, "...DPLx12/12" → 12, "...T12/15" → 12,
// "...PAQ*50U/120" → 50). Es solo una sugerencia para pre-llenar el input —
// el usuario siempre puede corregirlo antes de confirmar.
export function adivinarUnidadesDesdeNombre(nombre) {
  const texto = String(nombre || '').toUpperCase();
  const porX = texto.match(/\bX\s?(\d{1,3})\b/);
  if (porX) return Number(porX[1]);
  const porT = texto.match(/\bT(\d{1,3})\/\d+\b/);
  if (porT) return Number(porT[1]);
  const porPaq = texto.match(/\bPAQ\D{0,10}(\d{1,3})U?\b/);
  if (porPaq) return Number(porPaq[1]);
  return 1;
}
