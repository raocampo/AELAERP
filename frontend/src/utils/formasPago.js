// Espejo de backend/utils/formasPago.js — solo se usa para decidir cuándo
// mostrar el selector de banco en la UI; la validación real vive en el backend.
export function categoriaFormaPago({ uid, formaPago } = {}) {
  const clave = String(uid ?? formaPago ?? '').trim().toLowerCase();
  if (['trf', 'transferencia'].includes(clave)) return 'TRANSFERENCIA';
  if (['16', '19', 'tarjeta débito', 'tarjeta crédito', 'tarjeta'].includes(clave)) return 'TARJETA';
  if (['app', 'app móvil', 'aplicaciones (ahorita/de una)', '17'].includes(clave)) return 'APP';
  if (['chq', 'cheque'].includes(clave)) return 'CHEQUE';
  // "Otros con utilización del sistema financiero" (SRI 20 genérico): no es
  // efectivo pero es ambiguo — no se fuerza cuenta bancaria ni movimiento en
  // Bancos (puede ser cheque, transferencia o depósito directo).
  if (['20', 'otros con utilización del sistema financiero'].includes(clave)) return 'OTRO_FINANCIERO';
  return 'EFECTIVO';
}

const REQUIERE_BANCO = new Set(['TRANSFERENCIA', 'TARJETA', 'APP']);

export const requiereBanco = (pago) => REQUIERE_BANCO.has(categoriaFormaPago(pago));
export const esEfectivo = (pago) => categoriaFormaPago(pago) === 'EFECTIVO';
