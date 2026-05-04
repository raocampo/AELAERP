// ====================================
// IMPORTAR CLIENTES / PROVEEDORES DESDE EXCEL
// backend/utils/importarExcel.js
// ====================================

const XLSX = require('xlsx');

// ─── Inferir tipoIdentificacion desde el número ──────────────
function inferirTipo(id) {
  const s = String(id || '').trim().replace(/\s/g, '');
  if (!s || s.toUpperCase() === 'CF') return '07'; // Consumidor Final
  if (/^\d{13}$/.test(s)) return '04';             // RUC
  if (/^\d{10}$/.test(s)) return '05';             // Cédula
  return '08';                                      // Identificación exterior / Pasaporte
}

// ─── Limpiar string ──────────────────────────────────────────
function str(v, max) {
  const s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

// ─── Parsear buffer Excel → array de objetos planos ──────────
function parsearBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  // Fila 1 = encabezados, devuelve array de objetos
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

// ─── Normalizar encabezados (ignora mayúsculas, tildes, espacios) ──
const NORM_MAP = {
  identificacion:    ['identificacion', 'ruc', 'cedula', 'id', 'nro'],
  razonSocial:       ['razonsocial', 'nombre', 'razon social', 'razon_social'],
  nombreComercial:   ['nombrecomercial', 'nombre comercial', 'comercial', 'nombre_comercial'],
  tipoIdentificacion:['tipoidentificacion', 'tipo', 'tipo_identificacion'],
  direccion:         ['direccion', 'dirección', 'address'],
  email:             ['email', 'correo', 'mail', 'correo electronico'],
  telefono:          ['telefono', 'teléfono', 'tel', 'celular', 'phone'],
  ciudad:            ['ciudad', 'city'],
  provincia:         ['provincia', 'region'],
  contactoNombre:    ['contacto', 'contactonombre', 'contacto nombre', 'nombre contacto'],
  banco:             ['banco', 'bank'],
  cuentaBancaria:    ['cuentabancaria', 'cuenta', 'cuenta bancaria', 'cuenta_bancaria'],
  observaciones:     ['observaciones', 'notas', 'obs', 'nota'],
};

function normalizarClave(clave) {
  return String(clave)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quitar tildes
    .replace(/[^a-z0-9 _]/g, '')
    .trim();
}

function mapearCampo(columna) {
  const norm = normalizarClave(columna);
  for (const [campo, aliases] of Object.entries(NORM_MAP)) {
    if (aliases.some((a) => norm === a || norm.startsWith(a))) return campo;
  }
  return null;
}

// ─── Parsear filas → clientes ────────────────────────────────
function parsearClientes(rows) {
  const resultado = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const datos = {};
    for (const [col, val] of Object.entries(row)) {
      const campo = mapearCampo(col);
      if (campo) datos[campo] = val;
    }

    const id = str(datos.identificacion, 20).replace(/\s/g, '');
    if (!id) {
      resultado.push({ fila: i + 2, estado: 'omitido', motivo: 'Sin identificación' });
      continue;
    }

    const razonSocial = str(datos.razonSocial, 300);
    if (!razonSocial) {
      resultado.push({ fila: i + 2, estado: 'omitido', motivo: 'Sin razón social', id });
      continue;
    }

    resultado.push({
      fila: i + 2,
      estado: 'ok',
      data: {
        tipoIdentificacion: str(datos.tipoIdentificacion, 2) || inferirTipo(id),
        identificacion:     id,
        razonSocial:        razonSocial.toUpperCase(),
        nombreComercial:    str(datos.nombreComercial, 300) || null,
        direccion:          str(datos.direccion, 300) || null,
        email:              str(datos.email, 150).toLowerCase() || null,
        telefono:           str(datos.telefono, 20) || null,
      },
    });
  }

  return resultado;
}

// ─── Parsear filas → proveedores ─────────────────────────────
function parsearProveedores(rows) {
  const resultado = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const datos = {};
    for (const [col, val] of Object.entries(row)) {
      const campo = mapearCampo(col);
      if (campo) datos[campo] = val;
    }

    const id = str(datos.identificacion, 20).replace(/\s/g, '');
    if (!id) {
      resultado.push({ fila: i + 2, estado: 'omitido', motivo: 'Sin identificación' });
      continue;
    }

    const razonSocial = str(datos.razonSocial, 300);
    if (!razonSocial) {
      resultado.push({ fila: i + 2, estado: 'omitido', motivo: 'Sin razón social', id });
      continue;
    }

    resultado.push({
      fila: i + 2,
      estado: 'ok',
      data: {
        tipoIdentificacion: str(datos.tipoIdentificacion, 2) || inferirTipo(id),
        identificacion:     id,
        razonSocial:        razonSocial.toUpperCase(),
        nombreComercial:    str(datos.nombreComercial, 300) || null,
        direccion:          str(datos.direccion, 300) || null,
        ciudad:             str(datos.ciudad, 100) || null,
        provincia:          str(datos.provincia, 100) || null,
        email:              str(datos.email, 150).toLowerCase() || null,
        telefono:           str(datos.telefono, 20) || null,
        contactoNombre:     str(datos.contactoNombre, 150) || null,
        banco:              str(datos.banco, 100) || null,
        cuentaBancaria:     str(datos.cuentaBancaria, 50) || null,
        observaciones:      str(datos.observaciones) || null,
      },
    });
  }

  return resultado;
}

// ─── Generar plantilla Excel de Clientes ─────────────────────
function generarPlantillaClientes() {
  const encabezados = [
    'identificacion', 'razonSocial', 'nombreComercial',
    'email', 'telefono', 'direccion',
  ];
  const ejemplos = [
    ['0912345678001', 'EMPRESA EJEMPLO S.A.', 'EJEMPLO', 'info@ejemplo.com', '0991234567', 'Av. Principal 123'],
    ['0987654321', 'JUAN PEREZ', '', '', '0987654321', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplos]);

  // Ancho de columnas
  ws['!cols'] = [
    { wch: 16 }, { wch: 35 }, { wch: 25 },
    { wch: 28 }, { wch: 14 }, { wch: 35 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ─── Generar plantilla Excel de Proveedores ───────────────────
function generarPlantillaProveedores() {
  const encabezados = [
    'identificacion', 'razonSocial', 'nombreComercial',
    'email', 'telefono', 'direccion', 'ciudad', 'provincia',
    'contactoNombre', 'banco', 'cuentaBancaria', 'observaciones',
  ];
  const ejemplos = [
    ['0912345678001', 'PROVEEDOR EJEMPLO S.A.', 'PROVEEDOR', 'ventas@proveedor.com',
     '022345678', 'Calle 10 y Av. 5', 'Guayaquil', 'Guayas',
     'Carlos López', 'Banco Pichincha', '2200123456', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet([encabezados, ...ejemplos]);

  ws['!cols'] = [
    { wch: 16 }, { wch: 35 }, { wch: 25 }, { wch: 28 },
    { wch: 14 }, { wch: 35 }, { wch: 14 }, { wch: 14 },
    { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 25 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  parsearBuffer,
  parsearClientes,
  parsearProveedores,
  generarPlantillaClientes,
  generarPlantillaProveedores,
};
