// ====================================
// IMPORTACIÓN MASIVA DE FACTURAS DE COMPRA HISTÓRICAS
// backend/utils/importarComprasHistoricas.js
// ====================================

const XLSX = require('xlsx');
const { leerExcel } = require('./importarFacturasHistoricas');

const TIPO_ID_MAP = {
  'RUC': '04', 'CEDULA': '05', 'CÉDULA': '05', 'CEDULA DE IDENTIDAD': '05',
  'PASAPORTE': '06', 'PASSPORT': '06',
  '04': '04', '05': '05', '06': '06',
};

// Clasificación del monto "sin IVA" — tarifa 0% (default, comportamiento
// histórico) vs las 2 categorías legales distintas del SRI (tabla 17) que se
// separaron el 2026-07-21 en la captura manual: código 6 "No objeto" y
// código 7 "Exenta". Este importador histórico nunca las distinguió — se
// agrega como columna opcional para no romper plantillas ya en uso.
const TIPO_SIN_IVA_MAP = {
  '': '0', '0': '0', 'TARIFA 0': '0', 'TARIFA_0': '0', '0%': '0',
  'NO OBJETO': 'NO_OBJETO', 'NO_OBJETO': 'NO_OBJETO', 'NO OBJETO DE IVA': 'NO_OBJETO',
  'EXENTA': 'EXENTA', 'EXENTO': 'EXENTA', 'EXENTA DE IVA': 'EXENTA', 'EXENTO DE IVA': 'EXENTA',
};

const FORMA_PAGO_MAP = {
  'EFECTIVO': '01', 'CASH': '01', 'DINERO': '01', 'CONTADO': '01',
  'CHEQUE': '02',
  'TARJETA': '16', 'TARJETA DEBITO': '16', 'DEBITO': '16',
  'TARJETA CREDITO': '19', 'CREDITO': '19', 'CREDITO DIRECTO': '19',
  'TRANSFERENCIA': '20', 'DEPOSITO': '20', 'DEPOSITO BANCARIO': '20',
  'TRANSFERENCIA BANCARIA': '20',
  '01': '01', '02': '02', '16': '16', '19': '19', '20': '20',
};

function normKey(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parsearFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(valor);
      if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 12));
    } catch { /* ignore */ }
    return null;
  }
  const s = String(valor).trim();
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return new Date(`${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}T12:00:00`);
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return new Date(`${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}T12:00:00`);
  return null;
}

function parsearDecimal(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  return parseFloat(String(valor).replace(',', '.').trim()) || 0;
}

function normalizarNumeroFacturaProveedor(valor) {
  const limpio = String(valor || '').trim();
  if (!limpio) return '';
  const soloDigitos = limpio.replace(/\D/g, '');
  if (soloDigitos.length === 15) {
    return `${soloDigitos.slice(0, 3)}-${soloDigitos.slice(3, 6)}-${soloDigitos.slice(6)}`;
  }
  return limpio;
}

function validarFilaCompra(raw) {
  const fila = {};
  for (const [k, v] of Object.entries(raw)) {
    fila[normKey(k)] = v;
  }

  const errores = [];

  const get = (...keys) => {
    for (const k of keys) {
      const v = fila[k];
      if (v !== undefined && String(v).trim() !== '') return v;
    }
    return undefined;
  };

  const fechaRaw = get('fecha_emision', 'fecha', 'date', 'fecha_factura');
  const fecha = parsearFecha(fechaRaw);
  if (!fecha || isNaN(fecha.getTime())) {
    errores.push('fecha_emision inválida o ausente (use DD/MM/AAAA)');
  } else {
    const anio = fecha.getFullYear();
    if (anio < 2000 || anio > 2099) errores.push(`Año inválido: ${anio}`);
  }

  const tipoRaw = String(get('tipo_id', 'tipo_identificacion', 'tipo', 'tipo_id_proveedor') || '').trim().toUpperCase();
  const tipoId = TIPO_ID_MAP[tipoRaw];
  if (!tipoId) errores.push(`tipo_id inválido: "${tipoRaw}" — use RUC, CEDULA o PASAPORTE`);

  const identificacion = String(get('identificacion', 'identificacion_proveedor', 'ruc', 'cedula', 'ruc_proveedor') || '').trim();
  if (!identificacion) errores.push('identificacion (RUC/cédula del proveedor) es requerida');

  const razonSocial = String(get('razon_social', 'proveedor', 'nombre', 'razon_social_proveedor', 'nombre_proveedor') || '').trim();
  if (!razonSocial) errores.push('razon_social (del proveedor) es requerida');

  const numFactRaw = String(get('numero_factura', 'num_factura', 'factura', 'numero') || '').trim();
  if (!numFactRaw) errores.push('numero_factura es requerido (número de la factura del proveedor)');
  const numeroFactura = normalizarNumeroFacturaProveedor(numFactRaw);
  if (numeroFactura.length > 17) errores.push(`numero_factura demasiado largo (máx. 17 caracteres): "${numeroFactura}"`);

  const subtotalGravado = parsearDecimal(get('subtotal_con_iva', 'subtotal_15', 'subtotal15', 'base_iva', 'base_gravada', 'gravado', 'subtotal_12', 'subtotal_14'));
  const subtotalExento  = parsearDecimal(get('subtotal_sin_iva', 'subtotal_0', 'subtotal0', 'base_0', 'exento', 'sin_iva'));
  const ivaPct          = parsearDecimal(get('iva_porcentaje', 'iva_pct', 'pct_iva', 'tarifa', 'tasa_iva')) || 15;

  const tipoSinIvaRaw = String(get('tipo_sin_iva', 'clasificacion_sin_iva', 'tipo_0') || '').trim().toUpperCase();
  const tipoSinIva = TIPO_SIN_IVA_MAP[tipoSinIvaRaw];
  if (tipoSinIva === undefined) {
    errores.push(`tipo_sin_iva inválido: "${tipoSinIvaRaw}" — use vacío/0 (tarifa 0%), NO_OBJETO o EXENTA`);
  }

  let ivaTotal = parsearDecimal(get('iva_total', 'valor_iva', 'iva'));
  if (ivaTotal === 0 && subtotalGravado > 0) {
    ivaTotal = parseFloat((subtotalGravado * ivaPct / 100).toFixed(2));
  }

  const totalCalculado = parseFloat((subtotalExento + subtotalGravado + ivaTotal).toFixed(2));
  const totalProvisto  = parsearDecimal(get('total', 'importe_total', 'valor_total', 'total_factura'));

  if (totalCalculado === 0 && totalProvisto === 0) {
    errores.push('Debe proporcionar subtotal_sin_iva, subtotal_con_iva o total');
  }
  if (totalProvisto > 0 && totalCalculado > 0 && Math.abs(totalProvisto - totalCalculado) > 0.05) {
    errores.push(`Total no cuadra: calculado $${totalCalculado.toFixed(2)} vs proporcionado $${totalProvisto.toFixed(2)}`);
  }

  const importeTotal = totalCalculado > 0 ? totalCalculado : totalProvisto;

  const descripcion = String(get('descripcion', 'concepto', 'detalle', 'producto', 'servicio') || 'Compra / gasto varios').trim().substring(0, 300);

  const formaRaw = String(get('forma_pago', 'forma_de_pago', 'pago', 'medio_pago') || 'EFECTIVO').trim().toUpperCase();
  const formaPago = FORMA_PAGO_MAP[formaRaw] || '01';

  const autoRaw = String(get('numero_autorizacion', 'autorizacion', 'clave_acceso') || '').trim().replace(/\s/g, '');
  const tieneAutorizacion = autoRaw.length === 49 && /^\d{49}$/.test(autoRaw);
  if (autoRaw && !tieneAutorizacion) {
    errores.push(`numero_autorizacion debe tener exactamente 49 dígitos (tiene ${autoRaw.length})`);
  }

  const tipoGasto     = String(get('tipo_gasto', 'categoria', 'clasificacion') || '').trim().substring(0, 30) || null;
  const observaciones = String(get('observaciones', 'notas', 'nota', 'comentarios') || '').trim();

  return {
    valida: errores.length === 0,
    errores,
    datos: {
      fecha,
      tipoId: tipoId || '04',
      identificacion,
      razonSocial,
      numeroFactura,
      descripcion,
      subtotalExento,
      tipoSinIva: tipoSinIva || '0',
      subtotalGravado,
      ivaPct,
      ivaTotal,
      importeTotal,
      formaPago,
      numeroAutorizacion: tieneAutorizacion ? autoRaw : null,
      tipoGasto,
      observaciones: observaciones || null,
    },
  };
}

function construirDetallesCompra(datos) {
  const detalles = [];

  if (datos.subtotalExento > 0) {
    const sufijo = datos.tipoSinIva === 'NO_OBJETO' ? ' (no objeto de IVA)'
      : datos.tipoSinIva === 'EXENTA' ? ' (exenta de IVA)'
      : datos.subtotalGravado > 0 ? ' (sin IVA)' : '';
    detalles.push({
      codigoPrincipal: 'HIST-001',
      descripcion: datos.descripcion + sufijo,
      cantidad: 1,
      precioUnitario: datos.subtotalExento,
      descuento: 0,
      porcentajeIva: 0,
      esNoObjetoIva: datos.tipoSinIva === 'NO_OBJETO',
      esExentoIva: datos.tipoSinIva === 'EXENTA',
      inventariable: false,
    });
  }

  if (datos.subtotalGravado > 0) {
    detalles.push({
      codigoPrincipal: datos.subtotalExento > 0 ? 'HIST-002' : 'HIST-001',
      descripcion: datos.descripcion + (datos.subtotalExento > 0 ? ' (con IVA)' : ''),
      cantidad: 1,
      precioUnitario: datos.subtotalGravado,
      descuento: 0,
      porcentajeIva: datos.ivaPct,
      inventariable: false,
    });
  }

  if (detalles.length === 0) {
    detalles.push({
      codigoPrincipal: 'HIST-001',
      descripcion: datos.descripcion,
      cantidad: 1,
      precioUnitario: datos.importeTotal,
      descuento: 0,
      porcentajeIva: 0,
      inventariable: false,
    });
  }

  return detalles;
}

function generarPlantillaCompras() {
  const encabezados = [
    'fecha_emision', 'tipo_id', 'identificacion', 'razon_social', 'numero_factura',
    'descripcion', 'subtotal_sin_iva', 'tipo_sin_iva', 'subtotal_con_iva', 'iva_porcentaje', 'iva_total',
    'forma_pago', 'tipo_gasto', 'numero_autorizacion', 'observaciones',
  ];

  const ejemplos = [
    ['15/03/2022', 'RUC',    '0990012345001', 'PROVEEDOR ABC S.A.',     '001-001-000000123', 'Compra de suministros de oficina', 0,   '',         200,  15, 30,  'TRANSFERENCIA', 'GASTO_ADMINISTRATIVO', '', 'Importado de sistema anterior'],
    ['20/06/2023', 'CEDULA', '1712345678',    'JUAN PEREZ LOPEZ',       '001-001-000000045', 'Servicio de mantenimiento',        100, '',         0,    0,  0,   'EFECTIVO',      'GASTO_OPERATIVO',      '', ''],
    ['10/11/2021', 'RUC',    '1790012345001', 'DISTRIBUIDORA XYZ',      '015-002-000009876', 'Mercadería para reventa',          0,   '',         1200, 12, 144, 'CREDITO',       'COMPRA_MERCADERIA',    '2811202101179001234500110010010000000034567890121', ''],
    ['30/09/2021', 'RUC',    '0501234567001', 'CONSTRUCTORA MONCAYO',   '001-001-000000005', 'Materiales de construcción',       0,   '',         3500, 14, 490, 'CHEQUE',        'GASTO_MANTENIMIENTO',  '', ''],
    ['05/04/2023', 'RUC',    '1791234567001', 'EXPORTADORA DEL VALLE',  '001-001-000000078', 'Compra de banano para exportación',850, 'NO_OBJETO', 0,    0,  0,   'TRANSFERENCIA', 'COMPRA_MERCADERIA',    '', 'No objeto de IVA'],
    ['12/05/2023', 'RUC',    '0993012345001', 'FUNDACION SIN FINES',    '001-001-000000012', 'Donación recibida con factura',    500, 'EXENTA',    0,    0,  0,   'TRANSFERENCIA', 'GASTO_OPERATIVO',      '', 'Exenta de IVA'],
  ];

  const instrucciones = [
    ['INSTRUCCIONES — Importar Facturas de Compra Históricas en AELA'],
    [''],
    ['CAMPO', 'REQUERIDO', 'DESCRIPCIÓN', 'VALORES VÁLIDOS'],
    ['fecha_emision',        'SÍ',  'Fecha de emisión de la factura del proveedor',        'DD/MM/AAAA o AAAA-MM-DD (ej: 15/03/2022)'],
    ['tipo_id',              'SÍ',  'Tipo de identificación del proveedor',                'RUC | CEDULA | PASAPORTE'],
    ['identificacion',       'SÍ',  'RUC o cédula del proveedor',                          'Texto/número'],
    ['razon_social',         'SÍ',  'Nombre o razón social del proveedor',                 'Texto libre'],
    ['numero_factura',       'SÍ',  'Número de la factura del proveedor',                  'Formato 001-001-000000001 o el que use el proveedor (máx 17 caracteres)'],
    ['descripcion',          'NO',  'Descripción del bien o servicio comprado',            'Texto libre (default: Compra / gasto varios)'],
    ['subtotal_sin_iva',     'NO',  'Base imponible sin IVA (tarifa 0%, no objeto o exenta — ver tipo_sin_iva)', 'Número decimal (ej: 250.00)'],
    ['tipo_sin_iva',         'NO',  'Clasificación del monto de subtotal_sin_iva ante el SRI', 'vacío o 0 = tarifa 0% | NO_OBJETO | EXENTA (default: tarifa 0%)'],
    ['subtotal_con_iva',     'NO*', 'Base imponible gravada con IVA',                      '* Al menos uno de los dos subtotales es requerido'],
    ['iva_porcentaje',       'NO',  'Tasa de IVA aplicada al momento de emisión',          '0 | 5 | 12 | 14 | 15 (default: 15)'],
    ['iva_total',            'NO',  'Monto de IVA pagado (se calcula si está vacío)',       'Número decimal (ej: 30.00)'],
    ['forma_pago',           'NO',  'Medio de pago utilizado',                             'EFECTIVO | TRANSFERENCIA | TARJETA | CREDITO | CHEQUE'],
    ['tipo_gasto',           'NO',  'Categoría/clasificación interna del gasto',           'Texto libre, ej: GASTO_ADMINISTRATIVO'],
    ['numero_autorizacion',  'NO',  'Número de autorización del SRI (49 dígitos), si aplica', '49 dígitos numéricos exactos'],
    ['observaciones',        'NO',  'Notas internas del registro',                        'Texto libre'],
    [''],
    ['NOTAS IMPORTANTES:'],
    ['1. Debe proporcionar subtotal_sin_iva O subtotal_con_iva (o ambos)'],
    ['2. numero_factura es OBLIGATORIO — es el documento del proveedor, no lo asigna AELA'],
    ['3. Esta importación NO afecta el inventario ni crea productos — es solo para contabilidad'],
    ['4. Se genera automáticamente el asiento contable de la compra con la fecha histórica'],
    ['5. Para IVA histórico: use iva_porcentaje=12 para facturas 2019-2021, iva_porcentaje=14 para 2016-2019'],
    ['6. Máximo 1000 filas por importación'],
    ['7. No objeto y Exenta de IVA nunca llevan IVA — use tipo_sin_iva solo junto con subtotal_sin_iva'],
  ];

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplos]);
  ws['!cols'] = [
    { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 32 }, { wch: 20 },
    { wch: 32 }, { wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 13 }, { wch: 10 },
    { wch: 14 }, { wch: 22 }, { wch: 52 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');

  const wsI = XLSX.utils.aoa_to_sheet(instrucciones);
  wsI['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 52 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instrucciones');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  leerExcel,
  validarFilaCompra,
  construirDetallesCompra,
  generarPlantillaCompras,
};
