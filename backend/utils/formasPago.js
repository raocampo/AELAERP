// Categoriza cualquier combinación {uid, formaPago} que puedan mandar los
// distintos formularios de venta (POS, FormFactura, FormNotaVenta), sin
// tocar sus vocabularios originales (algunos van tal cual al XML del SRI).
function categoriaFormaPago({ uid, formaPago } = {}) {
  const clave = String(uid ?? formaPago ?? '').trim().toLowerCase();
  if (['trf', 'transferencia'].includes(clave)) return 'TRANSFERENCIA';
  if (['16', '19', 'tarjeta débito', 'tarjeta crédito', 'tarjeta'].includes(clave)) return 'TARJETA';
  if (['app', 'app móvil', 'aplicaciones (ahorita/de una)', '17'].includes(clave)) return 'APP';
  if (['chq', 'cheque'].includes(clave)) return 'CHEQUE';
  // "Otros con utilización del sistema financiero" (código SRI 20 genérico):
  // NO es efectivo, pero es demasiado ambiguo para exigir una cuenta bancaria
  // concreta — puede ser cheque, transferencia o depósito directo. Se registra
  // como pago no-efectivo pero sin forzar cuenta ni movimiento en Bancos.
  if (['20', 'otros con utilización del sistema financiero'].includes(clave)) return 'OTRO_FINANCIERO';
  return 'EFECTIVO'; // '01', 'efectivo', y cualquier valor no reconocido caen aquí (fail-safe: no exige banco)
}

const REQUIERE_BANCO = new Set(['TRANSFERENCIA', 'TARJETA', 'APP']);

const requiereBanco = (pago) => REQUIERE_BANCO.has(categoriaFormaPago(pago));
const esEfectivo = (pago) => categoriaFormaPago(pago) === 'EFECTIVO';

// Descripción oficial del catálogo SRI de formas de pago (usada tal cual en
// el RIDE, que por norma debe mostrar "código - DESCRIPCIÓN").
const FORMA_PAGO_DESC = {
  '01': '01 - EFECTIVO', '02': '02 - CHEQUE PROPIO', '03': '03 - DÉBITO BANCARIO',
  '15': '15 - COMPENSACIÓN DE DEUDAS', '16': '16 - TARJETA DE CRÉDITO',
  '17': '17 - TARJETA DE DÉBITO', '18': '18 - DINERO ELECTRÓNICO',
  '19': '19 - TARJETA PREPAGO', '20': '20 - OTROS CON UTILIZACION DEL SISTEMA FINANCIERO',
  '21': '21 - ENDOSO DE TÍTULOS',
};

// Etiqueta corta y amigable para el recibo POS (no el RIDE formal) — usa el
// `uid` original del formulario cuando existe (el código SRI por sí solo no
// distingue transferencia de cheque: ambos se guardan como "20"), y si no,
// cae a la descripción oficial o al valor recibido tal cual (las notas de
// venta ya guardan texto plano como "Efectivo"/"Transferencia").
const ETIQUETAS_CORTAS = {
  '01': 'Efectivo', '16': 'Tarjeta débito', '19': 'Tarjeta crédito',
  '17': 'App (Ahorita/De Una)', TRF: 'Transferencia / Depósito', CHQ: 'Cheque',
  APP: 'App (Ahorita/De Una)',
};

function etiquetaPago(pago) {
  const clave = String(pago?.uid ?? pago?.formaPago ?? '').trim();
  if (!clave) return 'Efectivo';
  return ETIQUETAS_CORTAS[clave] || FORMA_PAGO_DESC[clave] || clave;
}

module.exports = { categoriaFormaPago, requiereBanco, esEfectivo, FORMA_PAGO_DESC, etiquetaPago };
