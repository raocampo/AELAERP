export async function descargarCsv(apiInstance, endpoint, params = {}, filename = 'exportacion.csv') {
  const response = await apiInstance.get(endpoint, {
    params,
    responseType: 'blob',
  });

  const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function descargarExcel(apiInstance, endpoint, params = {}, filename = 'exportacion.xlsx') {
  const response = await apiInstance.get(endpoint, {
    params,
    responseType: 'blob',
  });

  const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const url  = URL.createObjectURL(new Blob([response.data], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function descargarPdf(apiInstance, endpoint, params = {}, filename = 'reporte.pdf') {
  const response = await apiInstance.get(endpoint, {
    params,
    responseType: 'blob',
  });

  const url  = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function descargarXml(apiInstance, endpoint, params = {}, filename = 'documento.xml') {
  const response = await apiInstance.get(endpoint, {
    params,
    responseType: 'blob',
  });

  const url  = URL.createObjectURL(new Blob([response.data], { type: 'application/xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Abre un blob (PDF/recibo) en una pestaña nueva en vez de forzar la descarga
// — para RIDE/recibos que el usuario quiere previsualizar, no solo guardar.
// Usa siempre el `api` axios (con Authorization + X-Tenant-Slug ya inyectados
// por el interceptor) en vez de fetch() a mano, que es lo que causaba
// TENANT_MISMATCH para empresas de un tenant multi-empresa (ver DetalleFactura,
// DetalleNotaVenta, CuentasPorCobrarHub, PuntoVenta).
export async function abrirBlobEnNuevaPestana(apiInstance, endpoint, params = {}, mimeType = 'application/pdf') {
  const response = await apiInstance.get(endpoint, {
    params,
    responseType: 'blob',
  });

  const url = URL.createObjectURL(new Blob([response.data], { type: mimeType }));
  const a   = document.createElement('a');
  a.href    = url;
  a.target  = '_blank';
  a.rel     = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
