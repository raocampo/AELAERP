// Mantener la vigencia en concordancia con backend/utils/ivaFactura.js.
// Aplicar solo a facturas nuevas; no cambiar compras ni documentos históricos.
const FIN_IVA_12 = '2024-04-01';
const IVA_OPCIONES = [
  { valor: 0, label: '0%' },
  { valor: 5, label: '5%' },
  { valor: 12, label: '12%' },
  { valor: 15, label: '15%' },
  { valor: 6, label: 'No Objeto IVA' },
  { valor: 7, label: 'Exento IVA' },
];

export const opcionesIvaFactura = (fechaEmision) => IVA_OPCIONES.filter(
  (opcion) => opcion.valor !== 12 || String(fechaEmision).slice(0, 10) < FIN_IVA_12,
);

export function errorIvaFactura(detalles, fechaEmision) {
  const opciones = opcionesIvaFactura(fechaEmision);
  const indice = detalles.findIndex((detalle) => !opciones.some(
    (opcion) => opcion.valor === Number(detalle.ivaPorcentaje ?? 0),
  ));
  if (indice === -1) return '';
  const detalle = detalles[indice];
  return `El ítem ${indice + 1} (${detalle.codigoPrincipal || detalle.descripcion || 'sin código'}) tiene IVA ${detalle.ivaPorcentaje}%, no disponible para la fecha de emisión. Selecciona la tarifa que corresponde a la venta (15% si aplica la tarifa general) y revisa el total antes de emitir.`;
}
