/**
 * Descarga un CSV desde un endpoint autenticado.
 * @param {import('axios').AxiosInstance} apiInstance - instancia de axios con token
 * @param {string} endpoint - ruta relativa, ej: '/compras/exportar/csv'
 * @param {object} params - query params (filtros activos)
 * @param {string} filename - nombre sugerido del archivo
 */
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
