// ====================================
// IMPORTACIÓN MASIVA DE FACTURAS HISTÓRICAS
// backend/utils/importarFacturasHistoricas.js
// ====================================

const XLSX = require('xlsx');

const TIPO_ID_MAP = {
  'RUC': '04', 'CEDULA': '05', 'CÉDULA': '05', 'CEDULA DE IDENTIDAD': '05',
  'PASAPORTE': '06', 'PASSPORT': '06',
  'CONSUMIDOR': '07', 'CONSUMIDOR FINAL': '07', 'CF': '07', 'FINAL': '07',
  '04': '04', '05': '05', '06': '06', '07': '07',
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
    // Excel serial number
    try {
      const d = XLSX.SSF.parse_date_code(valor);
      if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 12));
    } catch { /* ignore */ }
    return null;
  }
  const s = String(valor).trim();
  // DD/MM/YYYY o DD-MM-YYYY
  const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) return new Date(`${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}T12:00:00`);
  // YYYY-MM-DD
  const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) return new Date(`${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}T12:00:00`);
  return null;
}

function parsearNumeroFactura(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const m = s.match(/^(\d{1,3})-(\d{1,3})-(\d{1,9})$/);
  if (!m) return null;
  return {
    estab:      m[1].padStart(3, '0'),
    ptoEmi:     m[2].padStart(3, '0'),
    secuencial: m[3].padStart(9, '0'),
  };
}

function parsearDecimal(valor) {
  if (valor === null || valor === undefined || valor === '') return 0;
  return parseFloat(String(valor).replace(',', '.').trim()) || 0;
}

function leerExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function validarFila(raw) {
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

  // fecha
  const fechaRaw = get('fecha_emision', 'fecha', 'date', 'fecha_factura', 'fecha_de_emision');
  const fecha = parsearFecha(fechaRaw);
  if (!fecha || isNaN(fecha.getTime())) {
    errores.push('fecha_emision inválida o ausente (use DD/MM/AAAA)');
  } else {
    const anio = fecha.getFullYear();
    if (anio < 2000 || anio > 2099) errores.push(`Año inválido: ${anio}`);
  }

  // tipo identificacion
  const tipoRaw = String(get('tipo_id', 'tipo_identificacion', 'tipo', 'tipo_id_comprador') || '').trim().toUpperCase();
  const tipoId = TIPO_ID_MAP[tipoRaw];
  if (!tipoId) errores.push(`tipo_id inválido: "${tipoRaw}" — use RUC, CEDULA, PASAPORTE o CONSUMIDOR`);

  // identificacion
  const identificacion = String(get('identificacion', 'identificacion_comprador', 'ruc', 'cedula', 'id_comprador') || '').trim();
  const esConsumidorFinal = tipoId === '07';
  if (!identificacion && !esConsumidorFinal) errores.push('identificacion es requerida');

  // razon social
  const razonSocial = String(get('razon_social', 'nombre', 'cliente', 'razon_social_comprador', 'nombre_cliente') || '').trim();
  if (!razonSocial) errores.push('razon_social es requerida');

  // subtotales
  const subtotalGravado = parsearDecimal(get('subtotal_con_iva', 'subtotal_15', 'subtotal15', 'base_iva', 'base_gravada', 'gravado', 'subtotal_12', 'subtotal_14'));
  const subtotalExento  = parsearDecimal(get('subtotal_sin_iva', 'subtotal_0', 'subtotal0', 'base_0', 'exento', 'sin_iva'));
  const ivaPct          = parsearDecimal(get('iva_porcentaje', 'iva_pct', 'pct_iva', 'tarifa', 'tasa_iva')) || 15;

  let ivaTotal = parsearDecimal(get('iva_total', 'valor_iva', 'iva'));
  if (ivaTotal === 0 && subtotalGravado > 0) {
    ivaTotal = parseFloat((subtotalGravado * ivaPct / 100).toFixed(2));
  }

  const totalCalculado  = parseFloat((subtotalExento + subtotalGravado + ivaTotal).toFixed(2));
  const totalProvisto   = parsearDecimal(get('total', 'importe_total', 'valor_total', 'total_factura', 'total_a_pagar'));

  if (totalCalculado === 0 && totalProvisto === 0) {
    errores.push('Debe proporcionar subtotal_sin_iva, subtotal_con_iva o total');
  }
  if (totalProvisto > 0 && totalCalculado > 0 && Math.abs(totalProvisto - totalCalculado) > 0.05) {
    errores.push(`Total no cuadra: calculado $${totalCalculado.toFixed(2)} vs proporcionado $${totalProvisto.toFixed(2)}`);
  }

  const importeTotal = totalCalculado > 0 ? totalCalculado : totalProvisto;

  // descripcion
  const descripcion = String(get('descripcion', 'concepto', 'detalle', 'producto', 'servicio', 'descripcion_del_bien') || 'Servicios / productos varios').trim().substring(0, 300);

  // forma de pago
  const formaRaw = String(get('forma_pago', 'forma_de_pago', 'pago', 'medio_pago', 'metodo_pago') || 'EFECTIVO').trim().toUpperCase();
  const formaPago = FORMA_PAGO_MAP[formaRaw] || '01';

  // numero factura
  const numFactRaw = get('numero_factura', 'num_factura', 'factura', 'numero', 'n_factura');
  const parsedNum  = numFactRaw ? parsearNumeroFactura(numFactRaw) : null;
  if (numFactRaw && !parsedNum) {
    errores.push(`numero_factura inválido: "${numFactRaw}" — use formato 001-001-000000001`);
  }

  // numero autorizacion
  const autoRaw = String(get('numero_autorizacion', 'autorizacion', 'clave_acceso', 'num_autorizacion', 'no_autorizacion') || '').trim().replace(/\s/g, '');
  const tieneAutorizacion = autoRaw.length === 49 && /^\d{49}$/.test(autoRaw);
  if (autoRaw && !tieneAutorizacion) {
    errores.push(`numero_autorizacion debe tener exactamente 49 dígitos (tiene ${autoRaw.length})`);
  }

  const email         = String(get('email', 'correo', 'email_comprador') || '').trim();
  const observaciones = String(get('observaciones', 'notas', 'nota', 'comentarios') || '').trim();

  return {
    valida: errores.length === 0,
    errores,
    datos: {
      fecha,
      tipoId:              tipoId || '05',
      identificacion:      identificacion || '9999999999999',
      razonSocial:         razonSocial || 'CONSUMIDOR FINAL',
      email:               email || null,
      descripcion,
      subtotalExento,
      subtotalGravado,
      ivaPct,
      ivaTotal,
      importeTotal,
      formaPago,
      parsedNum,
      numeroAutorizacion:  tieneAutorizacion ? autoRaw : null,
      observaciones:       observaciones || null,
    },
  };
}

function construirDetalles(datos) {
  const detalles = [];

  if (datos.subtotalExento > 0) {
    detalles.push({
      codigoPrincipal: 'HIST-001',
      descripcion: datos.descripcion + (datos.subtotalGravado > 0 ? ' (sin IVA)' : ''),
      cantidad: 1,
      precioUnitario: datos.subtotalExento,
      descuento: 0,
      ivaPorcentaje: 0,
    });
  }

  if (datos.subtotalGravado > 0) {
    detalles.push({
      codigoPrincipal: datos.subtotalExento > 0 ? 'HIST-002' : 'HIST-001',
      descripcion: datos.descripcion + (datos.subtotalExento > 0 ? ' (con IVA)' : ''),
      cantidad: 1,
      precioUnitario: datos.subtotalGravado,
      descuento: 0,
      ivaPorcentaje: datos.ivaPct,
    });
  }

  if (detalles.length === 0) {
    detalles.push({
      codigoPrincipal: 'HIST-001',
      descripcion: datos.descripcion,
      cantidad: 1,
      precioUnitario: datos.importeTotal,
      descuento: 0,
      ivaPorcentaje: 0,
    });
  }

  return detalles;
}

function generarPlantilla() {
  const encabezados = [
    'fecha_emision', 'tipo_id', 'identificacion', 'razon_social', 'descripcion',
    'subtotal_sin_iva', 'subtotal_con_iva', 'iva_porcentaje', 'iva_total',
    'forma_pago', 'email', 'numero_factura', 'numero_autorizacion', 'observaciones',
  ];

  const ejemplos = [
    ['15/03/2022', 'RUC',      '0990012345001', 'EMPRESA ABC S.A.',     'Servicio de consultoría anual',  0,     500,   15,  75,   'TRANSFERENCIA', 'cliente@abc.com', '001-001-000000001', '', 'Importado de sistema anterior'],
    ['20/06/2023', 'CEDULA',   '1712345678',    'JUAN PEREZ LOPEZ',     'Venta de productos varios',      100,   200,   15,  30,   'EFECTIVO',      '',               '001-001-000000002', '', ''],
    ['10/11/2021', 'RUC',      '1790012345001', 'DISTRIBUIDORA XYZ',    'Mercadería importada',           0,     1200,  12,  144,  'CREDITO',       '',               '001-001-000000003', '2811202101179001234500110010010000000034567890121', ''],
    ['05/04/2020', 'CONSUMIDOR','9999999999999','CONSUMIDOR FINAL',      'Ventas al por menor',            250,   0,     0,   0,    'EFECTIVO',      '',               '',                  '', 'Sin IVA'],
    ['30/09/2021', 'RUC',      '0501234567001', 'CONSTRUCTORA MONCAYO', 'Materiales de construcción',     0,     3500,  14,  490,  'CHEQUE',        '',               '001-001-000000005', '', ''],
  ];

  const instrucciones = [
    ['INSTRUCCIONES — Importar Facturas Históricas en AELA'],
    [''],
    ['CAMPO', 'REQUERIDO', 'DESCRIPCIÓN', 'VALORES VÁLIDOS'],
    ['fecha_emision',        'SÍ',  'Fecha de emisión de la factura',                      'DD/MM/AAAA o AAAA-MM-DD (ej: 15/03/2022)'],
    ['tipo_id',              'SÍ',  'Tipo de identificación del cliente',                  'RUC | CEDULA | PASAPORTE | CONSUMIDOR'],
    ['identificacion',       'SÍ*', 'Número de identificación del cliente',                '* Opcional si tipo_id = CONSUMIDOR'],
    ['razon_social',         'SÍ',  'Nombre o razón social del cliente',                   'Texto libre'],
    ['descripcion',          'NO',  'Descripción del bien o servicio vendido',              'Texto libre (default: Servicios / productos varios)'],
    ['subtotal_sin_iva',     'NO',  'Base imponible tarifa 0% (sin IVA)',                  'Número decimal (ej: 250.00)'],
    ['subtotal_con_iva',     'NO*', 'Base imponible gravada con IVA',                      '* Al menos uno de los dos subtotales es requerido'],
    ['iva_porcentaje',       'NO',  'Tasa de IVA aplicada al momento de emisión',          '0 | 5 | 12 | 14 | 15 (default: 15)'],
    ['iva_total',            'NO',  'Monto de IVA cobrado (se calcula si está vacío)',      'Número decimal (ej: 75.00)'],
    ['forma_pago',           'NO',  'Medio de pago utilizado',                             'EFECTIVO | TRANSFERENCIA | TARJETA | CREDITO | CHEQUE'],
    ['email',                'NO',  'Email del cliente para notificaciones',               'Dirección de correo válida'],
    ['numero_factura',       'NO',  'Número de factura original del sistema anterior',     'Formato 001-001-000000001'],
    ['numero_autorizacion',  'NO',  'Número de autorización del SRI (49 dígitos)',          '49 dígitos numéricos exactos'],
    ['observaciones',        'NO',  'Notas internas del registro',                        'Texto libre'],
    [''],
    ['NOTAS IMPORTANTES:'],
    ['1. Debe proporcionar subtotal_sin_iva O subtotal_con_iva (o ambos)'],
    ['2. Si proporciona numero_autorizacion, la factura se guardará como AUTORIZADA (no se reenvía al SRI)'],
    ['3. Si NO proporciona numero_autorizacion, se guardará como HISTORICA (solo para contabilidad)'],
    ['4. Para IVA histórico: use iva_porcentaje=12 para facturas 2019-2021, iva_porcentaje=14 para 2016-2019'],
    ['5. Si proporciona numero_factura, se respeta la numeración original de su sistema anterior'],
    ['6. Máximo 1000 filas por importación'],
  ];

  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplos]);
  ws['!cols'] = [
    { wch: 14 }, { wch: 11 }, { wch: 16 }, { wch: 32 }, { wch: 32 },
    { wch: 15 }, { wch: 15 }, { wch: 13 }, { wch: 10 }, { wch: 14 },
    { wch: 24 }, { wch: 20 }, { wch: 52 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas');

  const wsI = XLSX.utils.aoa_to_sheet(instrucciones);
  wsI['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 52 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instrucciones');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { leerExcel, validarFila, construirDetalles, generarPlantilla, parsearNumeroFactura };
