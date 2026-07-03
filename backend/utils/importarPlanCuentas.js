// ====================================
// IMPORTAR PLAN DE CUENTAS DESDE EXCEL
// backend/utils/importarPlanCuentas.js
// ====================================

const XLSX = require('xlsx');

const TIPOS_VALIDOS = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO'];

// ─── Derivar nivel desde el código (segmentos separados por punto) ───────────
function derivarNivel(codigo) {
  if (!codigo) return 1;
  return String(codigo).trim().split('.').length;
}

// ─── Derivar código padre removiendo el último segmento ─────────────────────
function derivarPadre(codigo) {
  if (!codigo) return null;
  const partes = String(codigo).trim().split('.');
  if (partes.length <= 1) return null;
  return partes.slice(0, -1).join('.');
}

// ─── Naturaleza por defecto según el tipo ───────────────────────────────────
function derivarNaturaleza(tipo) {
  const t = String(tipo || '').toUpperCase();
  if (['PASIVO', 'PATRIMONIO', 'INGRESO'].includes(t)) return 'CREDITO';
  return 'DEBITO'; // ACTIVO, GASTO, COSTO
}

// ─── Detección y transformación de formato externo ─────────────────────────
// Detecta si el Excel viene de otro sistema (columnas Parent + Esdetalle)
function detectarFormatoExterno(rows) {
  if (!rows || rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase());
  return keys.includes('parent') && keys.includes('esdetalle');
}

const TIPO_EXTERNO_MAP = {
  'ACTIVOS':          'ACTIVO',
  'PASIVOS':          'PASIVO',
  'PATRIMONIO NETO':  'PATRIMONIO',
  'SECCION INGRESOS': 'INGRESO',
  'SECCION COSTOS':   null, // se determina por código
};

function tipoDesdeExterno(tipo, codigo) {
  const t = String(tipo || '').toUpperCase().trim();
  if (t !== 'SECCION COSTOS') return TIPO_EXTERNO_MAP[t] || '';
  // 51xxx → COSTO (Costo de Ventas), resto → GASTO
  return String(codigo).startsWith('51') ? 'COSTO' : 'GASTO';
}

// Extrae el código numérico del campo Parent: "NOMBRE CUENTA 1010101" → "1010101"
function extraerCodigoPadre(parentStr) {
  const s = String(parentStr || '').trim();
  if (!s) return null;
  const partes = s.split(' ').filter((p) => p.trim() !== '');
  if (partes.length === 0) return null;
  const ultimo = partes[partes.length - 1].trim();
  return (ultimo && !isNaN(ultimo)) ? ultimo : null;
}

function transformarDesdeExterno(rows) {
  // Índice por código para calcular nivel por recorrido ascendente
  const porCodigo = {};
  rows.forEach((r) => { porCodigo[String(r.codigo).trim()] = r; });

  const nivelCache = {};
  const computing  = new Set(); // detección de ciclos
  function calcularNivel(codigo) {
    const cod = String(codigo).trim();
    if (nivelCache[cod] !== undefined) return nivelCache[cod];
    if (computing.has(cod)) { nivelCache[cod] = 1; return 1; } // ciclo → raíz
    computing.add(cod);
    const row = porCodigo[cod];
    if (!row) { computing.delete(cod); nivelCache[cod] = 1; return 1; }
    const padreCode = extraerCodigoPadre(row.Parent);
    // auto-referencia, padre inexistente o padre vacío → raíz
    if (!padreCode || padreCode === cod || !porCodigo[padreCode]) {
      computing.delete(cod); nivelCache[cod] = 1; return 1;
    }
    const n = 1 + calcularNivel(padreCode);
    computing.delete(cod);
    nivelCache[cod] = n;
    return n;
  }

  return rows.map((r) => {
    const codigo      = String(r.codigo).trim();
    const codigoPadre = extraerCodigoPadre(r.Parent);
    const tipo        = tipoDesdeExterno(r.tipo, codigo);
    const nivel       = calcularNivel(codigo);
    const acepta      = String(r.Esdetalle || '').toLowerCase() === 'activo' ? 'SI' : 'NO';

    return {
      codigo,
      nombre:           r.nombre,
      tipo,
      codigoPadre,      // recogido por NORM_MAP → omite derivación por puntos
      nivel,            // recogido por NORM_MAP → omite derivación por puntos
      acepta_movimiento: acepta,
      activo:           'SI',
    };
  });
}

// ─── Parsear buffer Excel → filas planas ────────────────────────────────────
function parsearBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  // Auto-detectar formato externo y transformar antes del parseo estándar
  if (detectarFormatoExterno(rows)) {
    return transformarDesdeExterno(rows);
  }
  return rows;
}

// ─── Normalizar clave de encabezado ─────────────────────────────────────────
const NORM_MAP = {
  codigo:           ['codigo', 'código', 'cod', 'code', 'cuenta', 'cta'],
  nombre:           ['nombre', 'name', 'descripcion', 'descripción', 'denominacion', 'denominación'],
  tipo:             ['tipo', 'type', 'clasificacion', 'clase', 'grupo', 'naturaleza_grupo'],
  naturaleza:       ['naturaleza', 'saldo', 'debcred', 'deb_cred', 'tipo_saldo'],
  aceptaMovimiento: ['aceptamovimiento', 'acepta_movimiento', 'acepta movimiento', 'movimiento', 'mov', 'auxiliar', 'detalle'],
  activo:           ['activo', 'active', 'estado', 'habilitado', 'vigente'],
  nivel:            ['nivel', 'level'],
  codigoPadre:      ['codigopadre', 'codigo_padre', 'cuenta_padre', 'parent_code'],
};

function normalizarClave(clave) {
  return String(clave)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function mapearFila(raw) {
  const m = {};
  for (const [rawKey, rawVal] of Object.entries(raw)) {
    const norm = normalizarClave(rawKey);
    for (const [campo, aliases] of Object.entries(NORM_MAP)) {
      if (aliases.includes(norm)) {
        m[campo] = rawVal;
        break;
      }
    }
  }
  return m;
}

function parsearBool(val) {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val).trim().toLowerCase();
  if (['si', 'sí', 'yes', 'true', '1', 'x', 's'].includes(s)) return true;
  if (['no', 'false', '0'].includes(s)) return false;
  return null;
}

// ─── Parsear filas → objetos validados ──────────────────────────────────────
function parsearPlanCuentas(rows) {
  const resultados = [];

  rows.forEach((raw, idx) => {
    const fila = idx + 2; // +2 porque fila 1 son encabezados
    const m = mapearFila(raw);

    const codigo = String(m.codigo || '').trim().replace(/\s+/g, '');
    const nombre = String(m.nombre || '').trim().slice(0, 200);
    const tipo   = String(m.tipo   || '').trim().toUpperCase();

    // Saltar filas completamente vacías
    if (!codigo && !nombre && !tipo) {
      return;
    }

    const errores = [];
    if (!codigo)                         errores.push('Código requerido');
    if (!nombre)                         errores.push('Nombre requerido');
    if (!TIPOS_VALIDOS.includes(tipo))   errores.push(`Tipo inválido: "${m.tipo || ''}". Use: ${TIPOS_VALIDOS.join(' | ')}`);

    if (errores.length > 0) {
      resultados.push({ fila, estado: 'error', errores, codigo: codigo || '—', nombre: nombre || '—' });
      return;
    }

    // Derivar campos opcionales (usar valor pre-computado si viene de transformación externa)
    const nivelRaw = m.nivel !== undefined ? parseInt(String(m.nivel), 10) : null;
    const nivel = (nivelRaw && nivelRaw >= 1) ? nivelRaw : derivarNivel(codigo);
    const codigoPadre = (m.codigoPadre !== undefined) ? (m.codigoPadre || null) : derivarPadre(codigo);

    let naturaleza = String(m.naturaleza || '').trim().toUpperCase();
    if (!['DEBITO', 'CREDITO'].includes(naturaleza)) {
      naturaleza = derivarNaturaleza(tipo);
    }

    const boolMov = parsearBool(m.aceptaMovimiento);
    const aceptaMovimiento = boolMov !== null ? boolMov : (nivel >= 3);

    const boolActivo = parsearBool(m.activo);
    const activo = boolActivo !== null ? boolActivo : true;

    resultados.push({
      fila,
      estado: 'ok',
      codigo,
      nombre,
      data: { codigo, nombre, nivel, tipo, naturaleza, codigoPadre, aceptaMovimiento, activo },
    });
  });

  return resultados;
}

// ─── Generar plantilla .xlsx descargable ─────────────────────────────────────
function generarPlantillaPlanCuentas() {
  const wb = XLSX.utils.book_new();

  // Hoja 1: Plantilla con ejemplos representativos
  const filas = [
    { codigo: '1',           nombre: 'ACTIVO',                               tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.1',         nombre: 'ACTIVO CORRIENTE',                     tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.1.01',      nombre: 'EFECTIVO Y EQUIVALENTES AL EFECTIVO',  tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.1.01.001',  nombre: 'Caja General',                         tipo: 'ACTIVO',     naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '1.1.01.002',  nombre: 'Caja Chica',                           tipo: 'ACTIVO',     naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '1.1.02',      nombre: 'BANCOS',                               tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.1.02.001',  nombre: 'Banco Pichincha Cta. Cte. 3001234567', tipo: 'ACTIVO',     naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '1.1.03',      nombre: 'CUENTAS Y DOCUMENTOS POR COBRAR',      tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.1.03.001',  nombre: 'Clientes',                             tipo: 'ACTIVO',     naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '1.2',         nombre: 'ACTIVO NO CORRIENTE',                  tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.2.01',      nombre: 'PROPIEDAD, PLANTA Y EQUIPO',           tipo: 'ACTIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '1.2.01.001',  nombre: 'Muebles y Enseres',                    tipo: 'ACTIVO',     naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '2',           nombre: 'PASIVO',                               tipo: 'PASIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '2.1',         nombre: 'PASIVO CORRIENTE',                     tipo: 'PASIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '2.1.01',      nombre: 'CUENTAS Y DOCUMENTOS POR PAGAR',       tipo: 'PASIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '2.1.01.001',  nombre: 'Proveedores Nacionales',               tipo: 'PASIVO',     naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '2.1.02',      nombre: 'OBLIGACIONES TRIBUTARIAS',             tipo: 'PASIVO',     naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '2.1.02.001',  nombre: 'IVA en Ventas 15%',                   tipo: 'PASIVO',     naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '2.1.02.002',  nombre: 'Retención en la Fuente por Pagar',     tipo: 'PASIVO',     naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '3',           nombre: 'PATRIMONIO',                           tipo: 'PATRIMONIO', naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '3.1',         nombre: 'CAPITAL',                              tipo: 'PATRIMONIO', naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '3.1.01',      nombre: 'CAPITAL SUSCRITO Y PAGADO',            tipo: 'PATRIMONIO', naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '3.1.01.001',  nombre: 'Capital Social',                       tipo: 'PATRIMONIO', naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '3.2',         nombre: 'RESULTADOS',                           tipo: 'PATRIMONIO', naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '3.2.01.001',  nombre: 'Utilidad del Ejercicio',               tipo: 'PATRIMONIO', naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '4',           nombre: 'INGRESOS',                             tipo: 'INGRESO',    naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '4.1',         nombre: 'INGRESOS OPERACIONALES',               tipo: 'INGRESO',    naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '4.1.01',      nombre: 'VENTAS',                               tipo: 'INGRESO',    naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '4.1.01.001',  nombre: 'Ventas de Bienes y Servicios Tarifa 15%', tipo: 'INGRESO', naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '4.1.01.002',  nombre: 'Ventas de Bienes y Servicios Tarifa 0%',  tipo: 'INGRESO', naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '4.2',         nombre: 'OTROS INGRESOS',                       tipo: 'INGRESO',    naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '4.2.01.001',  nombre: 'Intereses Ganados',                    tipo: 'INGRESO',    naturaleza: 'CREDITO', acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5',           nombre: 'GASTOS',                               tipo: 'GASTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '5.1',         nombre: 'GASTOS OPERACIONALES',                 tipo: 'GASTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '5.1.01',      nombre: 'GASTOS DE PERSONAL',                   tipo: 'GASTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '5.1.01.001',  nombre: 'Sueldos y Salarios',                   tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.01.002',  nombre: 'Aporte Patronal IESS',                 tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.02',      nombre: 'GASTOS GENERALES',                     tipo: 'GASTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '5.1.02.001',  nombre: 'Arriendo de Local',                    tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.02.002',  nombre: 'Suministros y Materiales de Oficina',  tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.02.003',  nombre: 'Servicios Básicos',                    tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.02.004',  nombre: 'Honorarios Profesionales',             tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '5.1.03',      nombre: 'DEPRECIACIONES',                       tipo: 'GASTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '5.1.03.001',  nombre: 'Depreciación Muebles y Enseres',       tipo: 'GASTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
    { codigo: '6',           nombre: 'COSTO DE VENTAS',                      tipo: 'COSTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '6.1',         nombre: 'COSTO DE BIENES VENDIDOS',             tipo: 'COSTO',      naturaleza: '',        acepta_movimiento: 'NO', activo: 'SI' },
    { codigo: '6.1.01.001',  nombre: 'Costo de Mercaderías Vendidas',        tipo: 'COSTO',      naturaleza: 'DEBITO',  acepta_movimiento: 'SI', activo: 'SI' },
  ];

  const ws = XLSX.utils.json_to_sheet(filas, {
    header: ['codigo', 'nombre', 'tipo', 'naturaleza', 'acepta_movimiento', 'activo'],
  });

  ws['!cols'] = [
    { wch: 16 }, // codigo
    { wch: 50 }, // nombre
    { wch: 13 }, // tipo
    { wch: 12 }, // naturaleza
    { wch: 18 }, // acepta_movimiento
    { wch:  8 }, // activo
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Plan de Cuentas');

  // Hoja 2: Instrucciones
  const instrucciones = [
    { campo: 'codigo',            requerido: 'SI',  descripcion: 'Código jerárquico: 1 / 1.1 / 1.1.01 / 1.1.01.001. Nivel y código padre se calculan automáticamente.' },
    { campo: 'nombre',            requerido: 'SI',  descripcion: 'Nombre de la cuenta contable (máx. 200 caracteres).' },
    { campo: 'tipo',              requerido: 'SI',  descripcion: 'ACTIVO | PASIVO | PATRIMONIO | INGRESO | GASTO | COSTO' },
    { campo: 'naturaleza',        requerido: 'NO',  descripcion: 'DEBITO | CREDITO. Si vacío se calcula del tipo: ACTIVO/GASTO/COSTO→DEBITO, PASIVO/PATRIMONIO/INGRESO→CREDITO.' },
    { campo: 'acepta_movimiento', requerido: 'NO',  descripcion: 'SI o NO. Si vacío: SI para cuentas de 3 o más segmentos (ej. 1.1.01), NO para cuentas de grupo (1 ó 1.1).' },
    { campo: 'activo',            requerido: 'NO',  descripcion: 'SI o NO. Por defecto SI.' },
    { campo: '──────',            requerido: '',    descripcion: '────────────────────────────────────────' },
    { campo: 'NOTAS',             requerido: '',    descripcion: 'Si una cuenta con el mismo código ya existe en AELA, se actualiza (upsert). Las filas con error se omiten, el resto se importa.' },
    { campo: 'JERARQUÍA',         requerido: '',    descripcion: 'La jerarquía se infiere del código: "1.1.01.001" tiene nivel 4 y padre "1.1.01". No es necesario agregar columnas de nivel o padre.' },
    { campo: 'FORMATOS ACEPTADOS',requerido: '',    descripcion: '.xlsx, .xls. Los encabezados toleran mayúsculas, tildes y espacios: "Código", "CODIGO", "código" funcionan igual.' },
  ];

  const wsInstr = XLSX.utils.json_to_sheet(instrucciones, {
    header: ['campo', 'requerido', 'descripcion'],
  });
  wsInstr['!cols'] = [{ wch: 22 }, { wch: 12 }, { wch: 90 }];

  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parsearBuffer, parsearPlanCuentas, generarPlantillaPlanCuentas };
