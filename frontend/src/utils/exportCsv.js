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
