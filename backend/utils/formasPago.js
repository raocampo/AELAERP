// Categoriza cualquier combinación {uid, formaPago} que puedan mandar los
// distintos formularios de venta (POS, FormFactura, FormNotaVenta), sin
// tocar sus vocabularios originales (algunos van tal cual al XML del SRI).
function categoriaFormaPago({ uid, formaPago } = {}) {
  const clave = String(uid ?? formaPago ?? '').trim().toLowerCase();
  if (['trf', 'transferencia', '20'].includes(clave)) return 'TRANSFERENCIA';
  if (['16', '19', 'tarjeta débito', 'tarjeta crédito', 'tarjeta'].includes(clave)) return 'TARJETA';
  if (['app', 'app móvil', 'aplicaciones (ahorita/de una)', '17'].includes(clave)) return 'APP';
  if (['chq', 'cheque'].includes(clave)) return 'CHEQUE';
  return 'EFECTIVO'; // '01', 'efectivo', y cualquier valor no reconocido caen aquí (fail-safe: no exige banco)
}

const REQUIERE_BANCO = new Set(['TRANSFERENCIA', 'TARJETA', 'APP']);

const requiereBanco = (pago) => REQUIERE_BANCO.has(categoriaFormaPago(pago));
const esEfectivo = (pago) => categoriaFormaPago(pago) === 'EFECTIVO';

module.exports = { categoriaFormaPago, requiereBanco, esEfectivo };
