// La tarifa histórica del 12% (código SRI 2) dejó de aplicar a facturas
// desde el 01/04/2024. No convertirla silenciosamente: cambia el impuesto
// y el importe que el comprador debe pagar. Las importaciones históricas
// y las notas de crédito de documentos anteriores conservan su tarifa.
const FIN_IVA_12 = '2024-04-01';
const TARIFAS_FACTURA = new Set([0, 5, 12, 15, 6, 7]);

function validarIvaFactura(detalles, fechaEmision) {
  // fechaEmision es un campo solo-fecha, almacenado a medianoche UTC.
  // Preservar ese día, sin desplazarlo a la zona horaria del servidor.
  const fecha = fechaEmision instanceof Date
    ? fechaEmision.toISOString().slice(0, 10)
    : String(fechaEmision).slice(0, 10);

  for (const [indice, detalle] of detalles.entries()) {
    const tarifa = Number(detalle.ivaPorcentaje ?? 0);
    const item = `El ítem ${indice + 1} (${detalle.codigoPrincipal || detalle.descripcion || 'sin código'})`;
    let mensaje;
    if (tarifa === 12 && fecha >= FIN_IVA_12) {
      mensaje = `${item} tiene IVA 12% (código SRI 2), no vigente para la fecha ${fecha}. Selecciona la tarifa que corresponde a la venta (15% si aplica la tarifa general).`;
    } else if (!TARIFAS_FACTURA.has(tarifa)) {
      mensaje = `${item} tiene una tarifa de IVA no soportada (${detalle.ivaPorcentaje}). Selecciona una tarifa válida antes de emitir.`;
    }
    if (mensaje) {
      throw Object.assign(new Error(mensaje), { status: 400, code: 'IVA_FACTURA_INVALIDO' });
    }
  }
}

module.exports = { validarIvaFactura };
