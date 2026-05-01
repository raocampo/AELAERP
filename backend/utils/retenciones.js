function parsearImpuestos(impuestos) {
  if (!impuestos) return [];
  if (typeof impuestos === 'string') {
    try {
      return JSON.parse(impuestos);
    } catch {
      return [];
    }
  }
  return Array.isArray(impuestos) ? impuestos : [];
}

function calcularRetencionesCompra(impuestos = []) {
  return parsearImpuestos(impuestos).reduce((acc, imp) => {
    const codigo = String(imp.codigo || '');
    const valor = parseFloat(imp.valorRetenido || 0) || 0;

    if (codigo === '1') acc.retencionRenta += valor;
    if (codigo === '2') acc.retencionIVA += valor;

    return acc;
  }, { retencionIVA: 0, retencionRenta: 0 });
}

function totalRetenidoCompra(compra = {}) {
  return parseFloat((Number(compra.retencionIVA || 0) + Number(compra.retencionRenta || 0)).toFixed(2));
}

function serializarCompraPreload(compra) {
  if (!compra) return null;

  return {
    id: compra.id,
    tipoDocSustento: '01',
    numeroDocSustento: compra.numeroFactura,
    fechaEmisionDocSustento: compra.fechaEmision,
    tipoIdentificacionProveedor: compra.tipoIdentificacionProveedor,
    identificacionProveedor: compra.identificacionProveedor,
    razonSocialProveedor: compra.razonSocialProveedor,
    nombreComercialProveedor: compra.nombreComercialProveedor,
    subtotal0: compra.subtotal0,
    subtotal5: compra.subtotal5,
    subtotal15: compra.subtotal15,
    totalIva: compra.totalIva,
    importeTotal: compra.importeTotal,
    retencionIVA: compra.retencionIVA,
    retencionRenta: compra.retencionRenta,
    totalRetenidoActual: totalRetenidoCompra(compra),
    retenciones: compra.retenciones || [],
  };
}

function resumirCompraBusquedaRetencion(compra) {
  return {
    ...compra,
    totalRetenidoActual: totalRetenidoCompra(compra),
  };
}

module.exports = {
  parsearImpuestos,
  calcularRetencionesCompra,
  totalRetenidoCompra,
  serializarCompraPreload,
  resumirCompraBusquedaRetencion,
};
