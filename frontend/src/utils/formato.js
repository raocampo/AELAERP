// Redondea a 2 decimales cuando el valor "cuadra" limpio; solo usa hasta 4
// decimales cuando el precio unitario con más precisión realmente los necesita
// (evita mostrar $5.0000 cuando el total exacto es $5.00).
export function fmtLinea(valor) {
  const n  = Number(valor) || 0;
  const r2 = Math.round(n * 100) / 100;
  const r4 = Math.round(n * 10000) / 10000;
  return Math.abs(r4 - r2) < 0.00005 ? r2.toFixed(2) : r4.toFixed(4);
}
