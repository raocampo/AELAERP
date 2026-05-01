const formatearPeriodo = (mes, anio) => `${String(mes).padStart(2, '0')}/${String(anio)}`;

export const normalizarPeriodoMMYYYY = (value) => {
  if (value == null) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const normalizado = raw.replaceAll('-', '/').replaceAll('.', '/').replace(/\s+/g, '');

  let match = normalizado.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) {
    const mes = Number(match[1]);
    const anio = Number(match[2]);
    return mes >= 1 && mes <= 12 ? formatearPeriodo(mes, anio) : '';
  }

  match = normalizado.match(/^(\d{4})\/(\d{1,2})$/);
  if (match) {
    const anio = Number(match[1]);
    const mes = Number(match[2]);
    return mes >= 1 && mes <= 12 ? formatearPeriodo(mes, anio) : '';
  }

  const soloDigitos = normalizado.replace(/\D/g, '');
  if (/^\d{6}$/.test(soloDigitos)) {
    const mes = Number(soloDigitos.slice(0, 2));
    const anio = Number(soloDigitos.slice(2));
    return mes >= 1 && mes <= 12 ? formatearPeriodo(mes, anio) : '';
  }

  return '';
};

export const periodoActualMMYYYY = (date = new Date()) => (
  formatearPeriodo(date.getMonth() + 1, date.getFullYear())
);
