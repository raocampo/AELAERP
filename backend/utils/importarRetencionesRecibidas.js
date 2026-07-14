// ====================================
// IMPORTACIÓN MASIVA DE RETENCIONES RECIBIDAS DESDE EXCEL
// backend/utils/importarRetencionesRecibidas.js
//
// Acepta el "LISTADO DE RETENCIONES" tal como lo exporta el SRI
// (srienlinea.sri.gob.ec → Comprobantes recibidos) o cualquier sistema
// contable que replique esas columnas — una fila = un comprobante real,
// con clave de acceso, documento sustento y montos ya calculados por el SRI.
// Mismo criterio de creación que utils/buzon.js#parsearRetencionRecibida:
// codigo '1' = Renta, codigo '2' = IVA (ver crearAsientoRetencionRecibida).
// ====================================

const XLSX = require('xlsx');

function parsearFecha(valor) {
  if (!valor) return null;
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d, 12)) : null;
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return null;
}

function parsearDecimal(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(',', '.').trim()) || 0;
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function leerExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

function validarFila(raw) {
  const errores = [];
  const clave = String(raw['Autorización'] || raw['autorizacion'] || raw['claveAcceso'] || '').replace(/\s/g, '');
  if (!/^\d{49}$/.test(clave)) errores.push(`Autorización inválida (debe tener 49 dígitos): "${clave}"`);

  const rucAgente = String(raw['No. Id Age. Ret.'] || raw['rucAgente'] || '').trim();
  if (!rucAgente) errores.push('No. Id Age. Ret. (RUC del agente de retención) es requerido');

  const razonSocialAgente = String(raw['Raz. Social Ag. Retención'] || raw['razonSocialAgente'] || '').trim();
  if (!razonSocialAgente) errores.push('Raz. Social Ag. Retención es requerida');

  const fechaEmision = parsearFecha(raw['Fecha Emisión'] || raw['fechaEmision']);
  if (!fechaEmision) errores.push(`Fecha Emisión inválida: "${raw['Fecha Emisión']}"`);

  const fechaAutorizacion = parsearFecha(raw['Fecha Autorización'] || raw['fechaAutorizacion']) || fechaEmision;

  const baseRenta  = parsearDecimal(raw['Base Ret. Renta #1']);
  const pctRenta    = parsearDecimal(raw['Porcentaje Ret. Renta #1']);
  const valorRenta = parsearDecimal(raw['Valor Ret. Renta #1']);
  const baseIva    = parsearDecimal(raw['Base Ret. IVA #1']);
  const pctIva      = parsearDecimal(raw['Porcentaje Ret. IVA #1']);
  const valorIva   = parsearDecimal(raw['Valor Ret. IVA #1']);

  if (valorRenta === 0 && valorIva === 0) {
    errores.push('No tiene ni Valor Ret. Renta #1 ni Valor Ret. IVA #1 (fila sin monto)');
  }

  const numDocSustento = String(raw['Documento Sustento'] || '').trim() || null;
  const fechaDocSustento = parsearFecha(raw['Fecha Emi. Sustento']);

  const detalles = [];
  if (valorRenta !== 0 || baseRenta !== 0) {
    detalles.push({
      codigo: '1', codigoRetencion: String(raw['Cod. Ret. Renta #1'] || '').trim() || null,
      porcentajeRetener: pctRenta, valorRetener: valorRenta, baseImponible: baseRenta,
      numDocSustento, fechaEmisionDocSustento: fechaDocSustento,
    });
  }
  if (valorIva !== 0 || baseIva !== 0) {
    detalles.push({
      codigo: '2', codigoRetencion: null,
      porcentajeRetener: pctIva, valorRetener: valorIva, baseImponible: baseIva,
      numDocSustento, fechaEmisionDocSustento: fechaDocSustento,
    });
  }

  return {
    valida: errores.length === 0,
    errores,
    datos: {
      claveAcceso: clave,
      numeroAutorizacion: clave,
      fechaAutorizacion,
      rucAgente,
      razonSocialAgente,
      fechaEmision,
      numDocSustento,
      totalRetencionIva: round2(valorIva),
      totalRetencionRenta: round2(valorRenta),
      detalles,
    },
  };
}

function generarPlantilla() {
  const encabezados = [
    'No. Id Age. Ret.', 'Tipo Id Age. Ret.', 'Raz. Social Ag. Retención',
    'No. Id. Suj. Ret', 'Tipo Id Suj. Ret.', 'Raz. Social Sujeto Retenido',
    'Tipo de Comprobante', 'Establecimiento', 'Punto Emisión', 'Secuencial', 'Autorización',
    'Fecha Emisión', 'Fecha Autorización', 'Tipo Comp. Sustento', 'Documento Sustento',
    'Fecha Emi. Sustento', 'Aut. Doc. Sustento',
    'Cod. Ret. Renta #1', 'Base Ret. Renta #1', 'Porcentaje Ret. Renta #1', 'Valor Ret. Renta #1',
    'Base Ret. IVA #1', 'Porcentaje Ret. IVA #1', 'Valor Ret. IVA #1',
  ];
  const ejemplo = [
    '1190002213001', '01-Ruc', 'BANCO DE LOJA S.A.',
    '1104196546', '05-CÉDULA', 'PUCHAICELA ABENDANO, DANIEL RAMIRO',
    '07-Comprobante de Retención', '001', '035', '000644324', '0611202407119000221300120010350006443241663760017',
    '06/11/2024', '2024-11-07T01:29:34-05:00', '12-Documentos emitidos por instituciones financieras', '000-000-849319433',
    '06/11/2024', '',
    '', '', '', '',
    '1.5', '100', '1.5',
  ];
  const instrucciones = [
    ['INSTRUCCIONES — Importar Retenciones Recibidas en AELA'],
    [''],
    ['Este archivo debe tener las MISMAS columnas que exporta el SRI en'],
    ['srienlinea.sri.gob.ec → Comprobantes recibidos → Retenciones (o tu sistema'],
    ['contable anterior, si replica ese mismo formato). Una fila = un comprobante.'],
    [''],
    ['CAMPO', 'REQUERIDO', 'DESCRIPCIÓN'],
    ['Autorización', 'SÍ', 'Clave de acceso del comprobante — 49 dígitos exactos'],
    ['No. Id Age. Ret.', 'SÍ', 'RUC de quien te hizo la retención'],
    ['Raz. Social Ag. Retención', 'SÍ', 'Nombre de quien te hizo la retención'],
    ['Fecha Emisión', 'SÍ', 'DD/MM/AAAA'],
    ['Documento Sustento', 'NO', 'Número de la factura/comprobante sobre el que se retuvo'],
    ['Valor Ret. Renta #1 / Valor Ret. IVA #1', 'NO*', '* Al menos uno de los dos debe tener un valor mayor a 0'],
    [''],
    ['NOTAS:'],
    ['1. Máximo 1000 filas por importación.'],
    ['2. Si la clave de acceso ya existe, esa fila se omite (no duplica).'],
    ['3. Se genera automáticamente el asiento contable con la fecha histórica real.'],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([encabezados, ejemplo]);
  ws['!cols'] = encabezados.map(() => ({ wch: 20 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Retenciones');
  const wsI = XLSX.utils.aoa_to_sheet(instrucciones);
  wsI['!cols'] = [{ wch: 40 }, { wch: 12 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instrucciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { leerExcel, validarFila, generarPlantilla, round2 };
