const express = require('express');
const multer  = require('multer');
const PDFDocument = require('pdfkit');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const { crearAsientoContable, crearAsientoNominaPeriodo, round2 } = require('../utils/contabilidad');
const { CATEGORIAS: CATEGORIAS_CONFIG_REFERENCIA, obtenerCatalogoReferencias } = require('../utils/catalogosCuentasReferencia');
const { sembrarPlanCuentasBase, PLAN_CUENTAS_BASE } = require('../utils/planCuentasBase');
const { sembrarPlanSupercias }  = require('../utils/planCuentasSupercias');
const { parsearBuffer, parsearPlanCuentas, generarPlantillaPlanCuentas } = require('../utils/importarPlanCuentas');

// Multer para importación de plan de cuentas (memoria, max 10 MB)
const _uploadPC = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
function multerPlanCuentas(req, res, next) {
  _uploadPC.single('archivo')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, mensaje: err.message });
    next();
  });
}

const router = express.Router();

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('contabilidadHabilitada'));

// GET → contabilidad.ver (incluye asistente_contabilidad y secretaria)
// POST/PUT/DELETE/PATCH → contabilidad.gestionar (excluye secretaria)
router.use((req, res, next) => {
  const { tienePermiso } = require('../utils/roles');
  const rol = req.usuario?.rol || '';
  const esLectura = req.method === 'GET';
  const permiso = esLectura ? 'contabilidad.ver' : 'contabilidad.gestionar';
  if (!tienePermiso(rol, permiso)) {
    return res.status(403).json({ success: false, mensaje: 'No tiene permiso para esta acción contable' });
  }
  return next();
});

const ESTADOS_PERIODO = ['ABIERTO', 'CERRADO'];
const TIPOS_CUENTA = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESO', 'GASTO', 'COSTO'];
const NATURALEZAS = ['DEBITO', 'CREDITO'];
const TIPOS_ASIENTO_EDITABLES = ['MANUAL', 'AJUSTE'];

function parseIntSafe(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(value) {
  const date = parseDate(value);
  if (!date) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = parseDate(value);
  if (!date) return null;
  date.setHours(23, 59, 59, 999);
  return date;
}

function formatDateOnly(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function esCodigoPeriodoValido(codigo) {
  return typeof codigo === 'string' && /^\d{2}\/\d{4}$/.test(codigo);
}

function obtenerNombrePeriodo(codigo) {
  if (!esCodigoPeriodoValido(codigo)) return codigo;
  const [mm, yyyy] = codigo.split('/').map((x) => parseInt(x, 10));
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${meses[mm - 1] || mm}/${yyyy}`;
}

function obtenerEmpresaId(req) {
  return parseIntSafe(req.empresa?.id || req.usuario?.empresaId || 1) || 1;
}

function parseRango({ desde, hasta, periodo }) {
  if (periodo && esCodigoPeriodoValido(periodo)) {
    const [mm, yyyy] = periodo.split('/').map((x) => parseInt(x, 10));
    const inicio = new Date(yyyy, mm - 1, 1, 0, 0, 0, 0);
    const fin = new Date(yyyy, mm, 0, 23, 59, 59, 999);
    return { inicio, fin };
  }

  return {
    inicio: desde ? startOfDay(desde) : null,
    fin: hasta ? endOfDay(hasta) : null,
  };
}

function whereFechaDesdeFiltros({ desde, hasta, periodo }) {
  const { inicio, fin } = parseRango({ desde, hasta, periodo });
  const where = {};
  if (inicio) where.gte = inicio;
  if (fin) where.lte = fin;
  return Object.keys(where).length ? where : null;
}

function calcularSaldo(naturaleza, totalDebe, totalHaber) {
  return round2(naturaleza === 'DEBITO' ? totalDebe - totalHaber : totalHaber - totalDebe);
}

function construirArbolCuentas(cuentas) {
  const porCodigo = new Map();
  const roots = [];

  cuentas.forEach((cuenta) => porCodigo.set(cuenta.codigo, { ...cuenta, children: [] }));
  cuentas.forEach((cuenta) => {
    const node = porCodigo.get(cuenta.codigo);
    if (cuenta.codigoPadre && porCodigo.has(cuenta.codigoPadre)) {
      porCodigo.get(cuenta.codigoPadre).children.push(node);
    } else {
      roots.push(node);
    }
  });

  const sortNode = (node) => {
    node.children.sort((a, b) => a.codigo.localeCompare(b.codigo));
    node.children.forEach(sortNode);
  };

  roots.sort((a, b) => a.codigo.localeCompare(b.codigo));
  roots.forEach(sortNode);
  return roots;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ');
  if (text.includes(',') || text.includes('"') || text.includes(';')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function enviarCsv(res, filename, headers, rows) {
  const lineas = [headers.join(',')];
  rows.forEach((row) => {
    lineas.push(headers.map((header) => csvEscape(row[header])).join(','));
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${lineas.join('\n')}`);
}

function crearDocumentoPdf(res, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  doc.pipe(res);
  return doc;
}

function escribirLineaPdf(doc, texto = '', opts = {}) {
  if (doc.y > 760) doc.addPage();
  doc.text(texto, opts);
}

async function validarPeriodoAbiertoParaFecha(empresaId, fecha) {
  const totalPeriodos = await prisma.periodos_contables.count({
    where: { empresaId },
  });
  if (!totalPeriodos) return;

  const fechaInicio = startOfDay(fecha);
  const fechaFin = endOfDay(fecha);
  if (!fechaInicio || !fechaFin) {
    throw new Error('Fecha inválida para el asiento');
  }

  const periodo = await prisma.periodos_contables.findFirst({
    where: {
      empresaId,
      fechaInicio: { lte: fechaFin },
      fechaFin: { gte: fechaInicio },
    },
  });

  if (!periodo) {
    throw new Error('La fecha del asiento no pertenece a un período contable registrado');
  }

  if (periodo.estado !== 'ABIERTO') {
    throw new Error(`El período ${periodo.codigo} se encuentra cerrado`);
  }
}

async function normalizarDetallesAsiento(empresaId, detalles = []) {
  if (!Array.isArray(detalles) || detalles.length < 2) {
    throw new Error('El asiento debe contener al menos 2 líneas de detalle');
  }

  const normalizados = detalles.map((detalle) => ({
    cuentaId: parseIntSafe(detalle.cuentaId),
    centroCostoId: parseIntSafe(detalle.centroCostoId) || null,
    descripcion: detalle.descripcion || null,
    debe: round2(detalle.debe || 0),
    haber: round2(detalle.haber || 0),
  }));

  if (normalizados.some((d) => !d.cuentaId || (d.debe <= 0 && d.haber <= 0) || (d.debe > 0 && d.haber > 0))) {
    throw new Error('Cada línea debe tener cuenta válida y solo un valor positivo (debe o haber)');
  }

  const cuentaIds = [...new Set(normalizados.map((d) => d.cuentaId))];
  const cuentas = await prisma.plan_cuentas.findMany({
    where: {
      empresaId,
      id: { in: cuentaIds },
    },
  });

  if (cuentas.length !== cuentaIds.length) {
    throw new Error('Una o más cuentas del detalle no existen para la empresa actual');
  }

  const mapa = new Map(cuentas.map((cuenta) => [cuenta.id, cuenta]));
  if (normalizados.some((d) => !mapa.get(d.cuentaId)?.aceptaMovimiento || !mapa.get(d.cuentaId)?.activo)) {
    throw new Error('Solo cuentas activas y de movimiento pueden usarse en asientos');
  }

  const centroCostoIds = [...new Set(normalizados.map((d) => d.centroCostoId).filter(Boolean))];
  if (centroCostoIds.length > 0) {
    const centros = await prisma.centros_costo.findMany({
      where: { empresaId, id: { in: centroCostoIds } },
    });
    if (centros.length !== centroCostoIds.length) {
      throw new Error('Uno o más centros de costo no existen para la empresa actual');
    }
    if (centros.some((c) => !c.activo)) {
      throw new Error('Solo centros de costo activos pueden usarse en asientos');
    }
  }

  const totalDebe = round2(normalizados.reduce((acc, d) => acc + d.debe, 0));
  const totalHaber = round2(normalizados.reduce((acc, d) => acc + d.haber, 0));
  if (totalDebe !== totalHaber) {
    throw new Error(`El asiento está descuadrado: debe=${totalDebe} haber=${totalHaber}`);
  }

  return { normalizados, totalDebe, totalHaber };
}

function construirWhereAsientos(empresaId, filtros = {}) {
  const { tipo, desde, hasta, periodo, q, cerrado = 'todos' } = filtros;
  const where = { empresaId };
  if (tipo) where.tipo = String(tipo).toUpperCase();
  if (cerrado !== 'todos') where.cerrado = String(cerrado) === 'true';

  const fecha = whereFechaDesdeFiltros({ desde, hasta, periodo });
  if (fecha) where.fecha = fecha;

  if (q) {
    where.OR = [
      { numero: { contains: String(q), mode: 'insensitive' } },
      { descripcion: { contains: String(q), mode: 'insensitive' } },
      { referencia: { contains: String(q), mode: 'insensitive' } },
    ];
  }

  return where;
}

async function obtenerCuentaPorId(empresaId, id) {
  return prisma.plan_cuentas.findFirst({
    where: { empresaId, id },
  });
}

async function obtenerLibroMayor(empresaId, cuentaId, filtros = {}) {
  const cuenta = await obtenerCuentaPorId(empresaId, cuentaId);
  if (!cuenta) return null;

  const fechaWhere = whereFechaDesdeFiltros(filtros);
  const detalles = await prisma.asientos_contables_detalle.findMany({
    where: {
      cuentaId,
      asiento: {
        is: {
          empresaId,
          ...(fechaWhere ? { fecha: fechaWhere } : {}),
        },
      },
    },
    include: {
      asiento: true,
      cuenta: true,
    },
    orderBy: [{ id: 'asc' }],
  });

  detalles.sort((a, b) => {
    const fechaA = new Date(a.asiento.fecha).getTime();
    const fechaB = new Date(b.asiento.fecha).getTime();
    if (fechaA !== fechaB) return fechaA - fechaB;
    return a.id - b.id;
  });

  let saldo = 0;
  const movimientos = detalles.map((detalle) => {
    const debe = round2(detalle.debe || 0);
    const haber = round2(detalle.haber || 0);
    saldo = round2(saldo + (cuenta.naturaleza === 'DEBITO' ? (debe - haber) : (haber - debe)));
    return {
      id: detalle.id,
      fecha: detalle.asiento.fecha,
      numero: detalle.asiento.numero,
      tipo: detalle.asiento.tipo,
      referencia: detalle.asiento.referencia,
      descripcionDetalle: detalle.descripcion,
      descripcionAsiento: detalle.asiento.descripcion,
      debe,
      haber,
      saldo,
    };
  });

  return { cuenta, movimientos, saldoFinal: round2(saldo) };
}

async function obtenerMayorizacion(empresaId, filtros = {}) {
  const fechaWhere = whereFechaDesdeFiltros(filtros);
  const detalles = await prisma.asientos_contables_detalle.findMany({
    where: {
      asiento: {
        is: {
          empresaId,
          ...(fechaWhere ? { fecha: fechaWhere } : {}),
        },
      },
    },
    include: { cuenta: true },
  });

  const mapa = new Map();
  detalles.forEach((detalle) => {
    if (!mapa.has(detalle.cuentaId)) {
      mapa.set(detalle.cuentaId, {
        cuentaId: detalle.cuentaId,
        codigo: detalle.cuenta.codigo,
        nombre: detalle.cuenta.nombre,
        tipo: detalle.cuenta.tipo,
        naturaleza: detalle.cuenta.naturaleza,
        movimientos: 0,
        totalDebe: 0,
        totalHaber: 0,
      });
    }

    const item = mapa.get(detalle.cuentaId);
    item.movimientos += 1;
    item.totalDebe = round2(item.totalDebe + Number(detalle.debe || 0));
    item.totalHaber = round2(item.totalHaber + Number(detalle.haber || 0));
  });

  const tabla = [...mapa.values()]
    .map((item) => ({
      ...item,
      saldo: calcularSaldo(item.naturaleza, item.totalDebe, item.totalHaber),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  return {
    resumen: {
      cuentas: tabla.length,
      movimientos: detalles.length,
      totalDebe: round2(tabla.reduce((acc, item) => acc + item.totalDebe, 0)),
      totalHaber: round2(tabla.reduce((acc, item) => acc + item.totalHaber, 0)),
    },
    tabla,
  };
}

// Construye lista jerárquica con sumas acumuladas de hijo a padre.
// Devuelve filas ordenadas por código con nivel e indicador esGrupo.
async function construirJerarquiaContable(empresaId, tipos, filtros = {}) {
  const fechaWhere = whereFechaDesdeFiltros(filtros);
  const [cuentas, detalles] = await Promise.all([
    prisma.plan_cuentas.findMany({
      where: { empresaId, activo: true, ...(tipos ? { tipo: { in: tipos } } : {}) },
      orderBy: { codigo: 'asc' },
    }),
    prisma.asientos_contables_detalle.findMany({
      where: {
        asiento: { is: { empresaId, ...(fechaWhere ? { fecha: fechaWhere } : {}) } },
        cuenta: { is: { empresaId, ...(tipos ? { tipo: { in: tipos } } : {}) } },
      },
      select: { cuentaId: true, debe: true, haber: true },
    }),
  ]);

  // Mapa de movimientos por cuentaId
  const mapaMovs = new Map();
  for (const d of detalles) {
    if (!mapaMovs.has(d.cuentaId)) mapaMovs.set(d.cuentaId, { totalDebe: 0, totalHaber: 0 });
    const m = mapaMovs.get(d.cuentaId);
    m.totalDebe = round2(m.totalDebe + Number(d.debe || 0));
    m.totalHaber = round2(m.totalHaber + Number(d.haber || 0));
  }

  // Inicializar nodos con sus movimientos directos
  const mapaCodigo = new Map();
  for (const c of cuentas) {
    const mv = mapaMovs.get(c.id) || { totalDebe: 0, totalHaber: 0 };
    mapaCodigo.set(c.codigo, {
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      naturaleza: c.naturaleza,
      codigoPadre: c.codigoPadre || null,
      aceptaMovimiento: c.aceptaMovimiento,
      totalDebe: mv.totalDebe,
      totalHaber: mv.totalHaber,
      saldo: 0,
    });
  }

  // Burbujear de hijos a padres (orden descendente = hijos antes que padres)
  const porCodigo = [...cuentas].sort((a, b) => b.codigo.localeCompare(a.codigo));
  for (const c of porCodigo) {
    if (c.codigoPadre && mapaCodigo.has(c.codigoPadre)) {
      const hijo = mapaCodigo.get(c.codigo);
      const padre = mapaCodigo.get(c.codigoPadre);
      padre.totalDebe = round2(padre.totalDebe + hijo.totalDebe);
      padre.totalHaber = round2(padre.totalHaber + hijo.totalHaber);
    }
  }

  // Calcular saldo final para cada nodo
  for (const entry of mapaCodigo.values()) {
    entry.saldo = calcularSaldo(entry.naturaleza, entry.totalDebe, entry.totalHaber);
  }

  // Lista ordenada con nivel e indicador de grupo
  return [...mapaCodigo.values()]
    .sort((a, b) => a.codigo.localeCompare(b.codigo))
    .map((e) => ({
      ...e,
      nivel: e.codigo.split('.').length,
      esGrupo: !e.aceptaMovimiento,
    }));
}

async function obtenerBalanceComprobacion(empresaId, filtros = {}) {
  const filas = await construirJerarquiaContable(empresaId, null, filtros);
  // Solo cuentas raíz (nivel 1) para los totales del resumen
  const raices = filas.filter((f) => !f.codigoPadre);
  return {
    resumen: {
      totalCuentas: filas.length,
      totalDebe:  round2(raices.reduce((a, f) => a + f.totalDebe, 0)),
      totalHaber: round2(raices.reduce((a, f) => a + f.totalHaber, 0)),
      saldoNeto:  round2(raices.reduce((a, f) => a + f.saldo, 0)),
    },
    filas,
    // Compatibilidad con frontend antiguo
    tabla: filas,
  };
}

async function obtenerEstadoResultados(empresaId, filtros = {}) {
  const filas = await construirJerarquiaContable(empresaId, ['INGRESO', 'GASTO', 'COSTO'], filtros);

  // Raíces por tipo para los totales
  const raicesIngreso = filas.filter((f) => !f.codigoPadre && f.tipo === 'INGRESO');
  const raicesEgreso  = filas.filter((f) => !f.codigoPadre && (f.tipo === 'GASTO' || f.tipo === 'COSTO'));

  const totalIngresos = round2(raicesIngreso.reduce((a, f) => a + f.saldo, 0));
  const totalEgresos  = round2(raicesEgreso.reduce((a, f) => a + f.saldo, 0));
  const gananciaNetaPeriodo = round2(totalIngresos - totalEgresos);

  // Para compatibilidad con frontend antiguo
  const totalGastos = round2(filas.filter((f) => !f.codigoPadre && f.tipo === 'GASTO').reduce((a, f) => a + f.saldo, 0));
  const totalCostos = round2(filas.filter((f) => !f.codigoPadre && f.tipo === 'COSTO').reduce((a, f) => a + f.saldo, 0));

  return {
    totalIngresos,
    totalEgresos,
    totalGastos,
    totalCostos,
    gananciaNetaPeriodo,
    utilidad: gananciaNetaPeriodo,
    filas,
    tabla: filas,
  };
}

async function obtenerBalanceGeneral(empresaId, fechaCorte = new Date()) {
  const fecha = endOfDay(fechaCorte) || endOfDay(new Date());
  const filtrosFecha = { hasta: fecha instanceof Date ? fecha.toISOString() : fecha };

  // Jerarquías por sección
  const [filasBalance, filasResultados] = await Promise.all([
    construirJerarquiaContable(empresaId, ['ACTIVO', 'PASIVO', 'PATRIMONIO'], filtrosFecha),
    construirJerarquiaContable(empresaId, ['INGRESO', 'GASTO', 'COSTO'], filtrosFecha),
  ]);

  const activos    = filasBalance.filter((f) => f.tipo === 'ACTIVO');
  const pasivos    = filasBalance.filter((f) => f.tipo === 'PASIVO');
  const patrimonio = filasBalance.filter((f) => f.tipo === 'PATRIMONIO');

  const totalActivos    = round2(activos.filter((f) => !f.codigoPadre).reduce((a, f) => a + f.saldo, 0));
  const totalPasivos    = round2(pasivos.filter((f) => !f.codigoPadre).reduce((a, f) => a + f.saldo, 0));
  const totalPatrimonio = round2(patrimonio.filter((f) => !f.codigoPadre).reduce((a, f) => a + f.saldo, 0));

  // Resultado del ejercicio = Ingresos - (Gastos + Costos)
  const raicesIngreso = filasResultados.filter((f) => !f.codigoPadre && f.tipo === 'INGRESO');
  const raicesEgreso  = filasResultados.filter((f) => !f.codigoPadre && (f.tipo === 'GASTO' || f.tipo === 'COSTO'));
  const totalIngresos = round2(raicesIngreso.reduce((a, f) => a + f.saldo, 0));
  const totalEgresos  = round2(raicesEgreso.reduce((a, f) => a + f.saldo, 0));
  const resultadoEjercicio = round2(totalIngresos - totalEgresos);

  const totalPatrimonioNeto = round2(totalPatrimonio + resultadoEjercicio);

  return {
    fecha,
    activos,
    pasivos,
    patrimonio,
    resultadoEjercicio,
    totalActivos,
    totalPasivos,
    totalPatrimonio,
    totalPatrimonioNeto,
    balanceado: round2(totalActivos - (totalPasivos + totalPatrimonioNeto)) === 0,
  };
}

async function obtenerConsultasResumen(empresaId, filtros = {}) {
  const where = construirWhereAsientos(empresaId, filtros);
  const asientos = await prisma.asientos_contables.findMany({
    where,
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
  });

  const tiposMap = new Map();
  asientos.forEach((asiento) => {
    if (!tiposMap.has(asiento.tipo)) {
      tiposMap.set(asiento.tipo, {
        tipo: asiento.tipo,
        cantidad: 0,
        totalDebe: 0,
        totalHaber: 0,
      });
    }

    const item = tiposMap.get(asiento.tipo);
    item.cantidad += 1;
    item.totalDebe = round2(item.totalDebe + Number(asiento.totalDebe || 0));
    item.totalHaber = round2(item.totalHaber + Number(asiento.totalHaber || 0));
  });

  return {
    total: asientos.length,
    abiertos: asientos.filter((item) => !item.cerrado).length,
    cerrados: asientos.filter((item) => item.cerrado).length,
    tipos: [...tiposMap.values()].sort((a, b) => a.tipo.localeCompare(b.tipo)),
  };
}

async function listarAsientos(empresaId, filtros = {}, opciones = {}) {
  const { page = 1, limit = 50 } = filtros;
  const pageNum = Math.max(parseIntSafe(page) || 1, 1);
  const limitNum = Math.max(parseIntSafe(limit) || 50, 1);
  const includeDetails = Boolean(opciones.includeDetails);
  const ignorePagination = Boolean(opciones.ignorePagination);

  return prisma.asientos_contables.findMany({
    where: construirWhereAsientos(empresaId, filtros),
    include: includeDetails
      ? {
          detalles: {
            include: { cuenta: true },
            orderBy: { id: 'asc' },
          },
        }
      : undefined,
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    ...(ignorePagination ? {} : { skip: (pageNum - 1) * limitNum, take: limitNum }),
  });
}

// GET /api/contabilidad/periodos
router.get('/periodos', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { estado = 'todos' } = req.query;
    const where = { empresaId };
    if (estado !== 'todos') where.estado = String(estado).toUpperCase();

    const periodos = await prisma.periodos_contables.findMany({
      where,
      orderBy: [{ fechaInicio: 'desc' }, { id: 'desc' }],
    });

    const abiertos = periodos.filter((p) => p.estado === 'ABIERTO').length;
    res.json({
      success: true,
      data: {
        resumen: {
          total: periodos.length,
          abiertos,
          cerrados: periodos.length - abiertos,
        },
        items: periodos,
      },
    });
  } catch (error) {
    console.error('GET /contabilidad/periodos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar períodos contables' });
  }
});

// POST /api/contabilidad/periodos/auto-crear
// Detecta años con asientos pero sin período y los crea automáticamente.
router.post('/periodos/auto-crear', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);

    // Años distintos presentes en asientos
    const asientos = await prisma.asientos_contables.findMany({
      where: { empresaId },
      select: { fecha: true },
    });
    const añosConDatos = [...new Set(asientos.map((a) => new Date(a.fecha).getFullYear()))].sort();

    if (añosConDatos.length === 0) {
      return res.json({ success: true, data: { creados: [], mensaje: 'No hay asientos registrados.' } });
    }

    // Períodos ya existentes
    const periodosExistentes = await prisma.periodos_contables.findMany({ where: { empresaId }, select: { codigo: true } });
    const codigosExistentes = new Set(periodosExistentes.map((p) => p.codigo));

    const añoActual = new Date().getFullYear();
    const creados = [];

    for (const año of añosConDatos) {
      const codigo = `01/${año}`;
      if (codigosExistentes.has(codigo)) continue;

      const nuevo = await prisma.periodos_contables.create({
        data: {
          empresaId,
          codigo,
          nombre: `Período ${año}`,
          fechaInicio: new Date(`${año}-01-01T00:00:00.000Z`),
          fechaFin:    new Date(`${año}-12-31T23:59:59.000Z`),
          estado: 'ABIERTO',
        },
      });
      creados.push(nuevo);
    }

    return res.json({
      success: true,
      data: {
        creados,
        mensaje: creados.length > 0
          ? `Se crearon ${creados.length} período(s): ${creados.map((p) => p.codigo).join(', ')}`
          : 'Todos los períodos ya existían.',
      },
    });
  } catch (error) {
    console.error('POST /contabilidad/periodos/auto-crear:', error);
    res.status(500).json({ success: false, mensaje: 'Error al auto-crear períodos' });
  }
});

// POST /api/contabilidad/periodos/abrir-todos
router.post('/periodos/abrir-todos', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const result = await prisma.periodos_contables.updateMany({
      where: { empresaId, estado: 'CERRADO' },
      data: { estado: 'ABIERTO' },
    });
    res.json({ success: true, mensaje: `${result.count} período(s) abierto(s) correctamente` });
  } catch (error) {
    console.error('POST /contabilidad/periodos/abrir-todos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al abrir períodos' });
  }
});

// POST /api/contabilidad/periodos
router.post('/periodos', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { codigo, fechaInicio, fechaFin, estado = 'ABIERTO', observacion = null, nombre } = req.body || {};

    if (!esCodigoPeriodoValido(codigo)) {
      return res.status(400).json({ success: false, mensaje: 'El código de período debe tener formato MM/YYYY' });
    }

    const inicio = startOfDay(fechaInicio);
    const fin = endOfDay(fechaFin);
    if (!inicio || !fin) {
      return res.status(400).json({ success: false, mensaje: 'fechaInicio y fechaFin son requeridos' });
    }
    if (inicio > fin) {
      return res.status(400).json({ success: false, mensaje: 'La fecha de inicio no puede ser mayor a la fecha de fin' });
    }

    const estadoNormalizado = String(estado).toUpperCase();
    if (!ESTADOS_PERIODO.includes(estadoNormalizado)) {
      return res.status(400).json({ success: false, mensaje: 'Estado inválido. Valores permitidos: ABIERTO o CERRADO' });
    }

    const traslape = await prisma.periodos_contables.findFirst({
      where: {
        empresaId,
        fechaInicio: { lte: fin },
        fechaFin: { gte: inicio },
      },
    });
    if (traslape) {
      return res.status(400).json({ success: false, mensaje: `El período se cruza con ${traslape.codigo}` });
    }

    const creado = await prisma.$transaction(async (tx) => {
      return tx.periodos_contables.create({
        data: {
          empresaId,
          codigo,
          nombre: nombre || obtenerNombrePeriodo(codigo),
          fechaInicio: inicio,
          fechaFin: fin,
          estado: estadoNormalizado,
          observacion,
        },
      });
    });

    res.status(201).json({ success: true, data: creado });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'El código de período ya existe en esta empresa' });
    }
    console.error('POST /contabilidad/periodos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear período contable' });
  }
});

// PUT /api/contabilidad/periodos/:id
router.put('/periodos/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.periodos_contables.findFirst({
      where: { id, empresaId },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Período no encontrado' });

    const codigo = req.body?.codigo || actual.codigo;
    const inicio = startOfDay(req.body?.fechaInicio || actual.fechaInicio);
    const fin = endOfDay(req.body?.fechaFin || actual.fechaFin);
    const estadoNormalizado = String(req.body?.estado || actual.estado).toUpperCase();
    const observacion = req.body?.observacion ?? actual.observacion;
    const nombre = req.body?.nombre || actual.nombre;

    if (!esCodigoPeriodoValido(codigo)) {
      return res.status(400).json({ success: false, mensaje: 'El código de período debe tener formato MM/YYYY' });
    }
    if (!inicio || !fin) {
      return res.status(400).json({ success: false, mensaje: 'fechaInicio y fechaFin son requeridos' });
    }
    if (inicio > fin) {
      return res.status(400).json({ success: false, mensaje: 'La fecha de inicio no puede ser mayor a la fecha de fin' });
    }
    if (!ESTADOS_PERIODO.includes(estadoNormalizado)) {
      return res.status(400).json({ success: false, mensaje: 'Estado inválido. Valores permitidos: ABIERTO o CERRADO' });
    }

    const traslape = await prisma.periodos_contables.findFirst({
      where: {
        empresaId,
        id: { not: id },
        fechaInicio: { lte: fin },
        fechaFin: { gte: inicio },
      },
    });
    if (traslape) {
      return res.status(400).json({ success: false, mensaje: `El período se cruza con ${traslape.codigo}` });
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      return tx.periodos_contables.update({
        where: { id },
        data: {
          codigo,
          nombre: nombre || obtenerNombrePeriodo(codigo),
          fechaInicio: inicio,
          fechaFin: fin,
          estado: estadoNormalizado,
          observacion,
        },
      });
    });

    res.json({ success: true, data: actualizado });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'El código de período ya existe en esta empresa' });
    }
    console.error('PUT /contabilidad/periodos/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar período contable' });
  }
});

// GET /api/contabilidad/plan-cuentas
router.get('/plan-cuentas', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { activo = 'true', tipo, q, soloMovimiento = 'false' } = req.query;
    const where = { empresaId };
    if (activo !== 'todos') where.activo = String(activo) === 'true';
    // mode: 'insensitive' — cuentas importadas de fuentes externas a veces guardan
    // el tipo con otra capitalización (ej. "Activo"); una comparación exacta las
    // excluía silenciosamente de selectores como el de Bancos.
    if (tipo) where.tipo = { equals: String(tipo).toUpperCase(), mode: 'insensitive' };
    if (soloMovimiento === 'true') where.aceptaMovimiento = true;
    if (q) {
      where.OR = [
        { codigo: { contains: String(q), mode: 'insensitive' } },
        { nombre: { contains: String(q), mode: 'insensitive' } },
      ];
    }

    const cuentas = await prisma.plan_cuentas.findMany({
      where,
      orderBy: { codigo: 'asc' },
    });

    res.json({ success: true, data: { tree: construirArbolCuentas(cuentas), flat: cuentas } });
  } catch (error) {
    console.error('GET /contabilidad/plan-cuentas:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar plan de cuentas' });
  }
});

// POST /api/contabilidad/plan-cuentas
router.post('/plan-cuentas', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const {
      codigo,
      nombre,
      nivel,
      tipo,
      naturaleza,
      codigoPadre,
      aceptaMovimiento = false,
      activo = true,
    } = req.body || {};

    const nivelNum = parseIntSafe(nivel);
    if (!codigo || !nombre || !nivelNum || !tipo || !naturaleza) {
      return res.status(400).json({ success: false, mensaje: 'codigo, nombre, nivel, tipo y naturaleza son requeridos' });
    }
    if (!TIPOS_CUENTA.includes(String(tipo).toUpperCase())) {
      return res.status(400).json({ success: false, mensaje: 'Tipo de cuenta inválido' });
    }
    if (!NATURALEZAS.includes(String(naturaleza).toUpperCase())) {
      return res.status(400).json({ success: false, mensaje: 'Naturaleza inválida' });
    }

    if (codigoPadre) {
      const padre = await prisma.plan_cuentas.findFirst({
        where: { empresaId, codigo: codigoPadre },
      });
      if (!padre) return res.status(400).json({ success: false, mensaje: 'La cuenta padre no existe en esta empresa' });
    }

    const cuenta = await prisma.plan_cuentas.create({
      data: {
        empresaId,
        codigo,
        nombre,
        nivel: nivelNum,
        tipo: String(tipo).toUpperCase(),
        naturaleza: String(naturaleza).toUpperCase(),
        codigoPadre: codigoPadre || null,
        aceptaMovimiento: Boolean(aceptaMovimiento),
        activo: Boolean(activo),
      },
    });

    res.status(201).json({ success: true, data: cuenta });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Código de cuenta ya existe en esta empresa' });
    }
    console.error('POST /contabilidad/plan-cuentas:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear cuenta contable' });
  }
});

// PUT /api/contabilidad/plan-cuentas/:id
router.put('/plan-cuentas/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.plan_cuentas.findFirst({
      where: { id, empresaId },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });

    const codigo = req.body?.codigo || actual.codigo;
    const nombre = req.body?.nombre || actual.nombre;
    const nivelNum = parseIntSafe(req.body?.nivel ?? actual.nivel);
    const tipo = String(req.body?.tipo || actual.tipo).toUpperCase();
    const naturaleza = String(req.body?.naturaleza || actual.naturaleza).toUpperCase();
    const cuentaPadre = req.body?.codigoPadre === undefined ? actual.codigoPadre : (req.body.codigoPadre || null);
    const aceptaMovimiento = req.body?.aceptaMovimiento === undefined ? actual.aceptaMovimiento : Boolean(req.body.aceptaMovimiento);
    const activo = req.body?.activo === undefined ? actual.activo : Boolean(req.body.activo);

    if (!codigo || !nombre || !nivelNum || !tipo || !naturaleza) {
      return res.status(400).json({ success: false, mensaje: 'codigo, nombre, nivel, tipo y naturaleza son requeridos' });
    }
    if (!TIPOS_CUENTA.includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo de cuenta inválido' });
    }
    if (!NATURALEZAS.includes(naturaleza)) {
      return res.status(400).json({ success: false, mensaje: 'Naturaleza inválida' });
    }

    if (cuentaPadre) {
      if (cuentaPadre === codigo) {
        return res.status(400).json({ success: false, mensaje: 'Una cuenta no puede ser padre de sí misma' });
      }

      const padre = await prisma.plan_cuentas.findFirst({
        where: { empresaId, codigo: cuentaPadre },
      });
      if (!padre) return res.status(400).json({ success: false, mensaje: 'La cuenta padre no existe en esta empresa' });
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      const cuenta = await tx.plan_cuentas.update({
        where: { id },
        data: {
          codigo,
          nombre,
          nivel: nivelNum,
          tipo,
          naturaleza,
          codigoPadre: cuentaPadre,
          aceptaMovimiento,
          activo,
        },
      });

      if (actual.codigo !== codigo) {
        await tx.plan_cuentas.updateMany({
          where: {
            empresaId,
            codigoPadre: actual.codigo,
          },
          data: { codigoPadre: codigo },
        });
      }

      return cuenta;
    });

    res.json({ success: true, data: actualizado });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Código de cuenta ya existe en esta empresa' });
    }
    console.error('PUT /contabilidad/plan-cuentas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar cuenta contable' });
  }
});

// DELETE /api/contabilidad/plan-cuentas/:id
router.delete('/plan-cuentas/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.plan_cuentas.findFirst({
      where: { id, empresaId },
    });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });

    const [tieneHijas, tieneMovimientos] = await Promise.all([
      prisma.plan_cuentas.count({
        where: { empresaId, codigoPadre: cuenta.codigo },
      }),
      prisma.asientos_contables_detalle.count({
        where: { cuentaId: id },
      }),
    ]);

    if (tieneHijas > 0) {
      return res.status(400).json({ success: false, mensaje: 'No se puede eliminar una cuenta con subcuentas' });
    }
    if (tieneMovimientos > 0) {
      return res.status(400).json({ success: false, mensaje: 'No se puede eliminar una cuenta con movimientos contables' });
    }

    await prisma.plan_cuentas.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Cuenta contable eliminada' });
  } catch (error) {
    console.error('DELETE /contabilidad/plan-cuentas/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar cuenta contable' });
  }
});

// GET /api/contabilidad/centros-costo
router.get('/centros-costo', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { activo = 'true' } = req.query;
    const where = { empresaId };
    if (activo !== 'todos') where.activo = String(activo) === 'true';

    const centros = await prisma.centros_costo.findMany({
      where,
      orderBy: { codigo: 'asc' },
    });

    res.json({ success: true, data: centros });
  } catch (error) {
    console.error('GET /contabilidad/centros-costo:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar centros de costo' });
  }
});

// POST /api/contabilidad/centros-costo
router.post('/centros-costo', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { codigo, nombre, descripcion = null, activo = true } = req.body || {};

    if (!codigo || !nombre) {
      return res.status(400).json({ success: false, mensaje: 'codigo y nombre son requeridos' });
    }

    const centro = await prisma.centros_costo.create({
      data: {
        empresaId,
        codigo: String(codigo).trim(),
        nombre: String(nombre).trim(),
        descripcion: descripcion || null,
        activo: Boolean(activo),
      },
    });

    res.status(201).json({ success: true, data: centro });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Código de centro de costo ya existe en esta empresa' });
    }
    console.error('POST /contabilidad/centros-costo:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear centro de costo' });
  }
});

// PUT /api/contabilidad/centros-costo/:id
router.put('/centros-costo/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.centros_costo.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Centro de costo no encontrado' });

    const codigo = req.body?.codigo || actual.codigo;
    const nombre = req.body?.nombre || actual.nombre;
    const descripcion = req.body?.descripcion === undefined ? actual.descripcion : (req.body.descripcion || null);
    const activo = req.body?.activo === undefined ? actual.activo : Boolean(req.body.activo);

    const centro = await prisma.centros_costo.update({
      where: { id },
      data: { codigo: String(codigo).trim(), nombre: String(nombre).trim(), descripcion, activo },
    });

    res.json({ success: true, data: centro });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: 'Código de centro de costo ya existe en esta empresa' });
    }
    console.error('PUT /contabilidad/centros-costo/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar centro de costo' });
  }
});

// DELETE /api/contabilidad/centros-costo/:id
router.delete('/centros-costo/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const centro = await prisma.centros_costo.findFirst({ where: { id, empresaId } });
    if (!centro) return res.status(404).json({ success: false, mensaje: 'Centro de costo no encontrado' });

    const tieneMovimientos = await prisma.asientos_contables_detalle.count({
      where: { centroCostoId: id },
    });
    if (tieneMovimientos > 0) {
      return res.status(400).json({ success: false, mensaje: 'No se puede eliminar un centro de costo con movimientos contables. Desactívalo en su lugar.' });
    }

    await prisma.centros_costo.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Centro de costo eliminado' });
  } catch (error) {
    console.error('DELETE /contabilidad/centros-costo/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar centro de costo' });
  }
});

// POST /api/contabilidad/importar-plan
router.post('/importar-plan', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const cuentas = Array.isArray(req.body)
      ? req.body
      : (Array.isArray(req.body?.cuentas) ? req.body.cuentas : []);

    if (!cuentas.length) {
      return res.status(400).json({ success: false, mensaje: 'No se recibieron cuentas para importar' });
    }

    let creadas = 0;
    let actualizadas = 0;

    for (const cuenta of cuentas) {
      const nivelNum = parseIntSafe(cuenta.nivel);
      const tipo = String(cuenta.tipo || '').toUpperCase();
      const naturaleza = String(cuenta.naturaleza || '').toUpperCase();
      if (!cuenta.codigo || !cuenta.nombre || !nivelNum || !TIPOS_CUENTA.includes(tipo) || !NATURALEZAS.includes(naturaleza)) {
        continue;
      }

      const existente = await prisma.plan_cuentas.findFirst({
        where: { empresaId, codigo: cuenta.codigo },
      });

      const data = {
        empresaId,
        codigo: cuenta.codigo,
        nombre: cuenta.nombre,
        nivel: nivelNum,
        tipo,
        naturaleza,
        codigoPadre: cuenta.codigoPadre || null,
        aceptaMovimiento: Boolean(cuenta.aceptaMovimiento),
        activo: cuenta.activo === undefined ? true : Boolean(cuenta.activo),
      };

      if (existente) {
        await prisma.plan_cuentas.update({
          where: { id: existente.id },
          data,
        });
        actualizadas += 1;
      } else {
        await prisma.plan_cuentas.create({ data });
        creadas += 1;
      }
    }

    res.json({
      success: true,
      mensaje: 'Plan de cuentas importado',
      data: { creadas, actualizadas, total: creadas + actualizadas },
    });
  } catch (error) {
    console.error('POST /contabilidad/importar-plan:', error);
    res.status(500).json({ success: false, mensaje: 'Error al importar plan de cuentas' });
  }
});

// POST /api/contabilidad/plan-cuentas/semilla
router.post('/plan-cuentas/semilla', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const overwriteExisting = Boolean(req.body?.overwriteExisting);
    const resultado = await prisma.$transaction(async (tx) => sembrarPlanCuentasBase(tx, empresaId, { overwriteExisting }));

    res.json({
      success: true,
      data: resultado,
      mensaje: overwriteExisting
        ? 'Plan de cuentas base sincronizado para la empresa'
        : 'Plan de cuentas base instalado para la empresa',
    });
  } catch (error) {
    console.error('POST /contabilidad/plan-cuentas/semilla:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo instalar el plan de cuentas base' });
  }
});

// POST /api/contabilidad/plan-cuentas/restaurar-base
// Restaura el plan AELA: elimina cuentas sin movimientos que no están en el plan base,
// luego hace upsert del plan base completo. Deja intactas las cuentas con movimientos.
router.post('/plan-cuentas/restaurar-base', autorizarPermiso('contabilidad.gestionar'), async (req, res) => {
  try {
    const db        = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const codigosBase = new Set(PLAN_CUENTAS_BASE.map((c) => c.codigo));

    // 1. Obtener cuentas fuera del plan base
    const cuentasActuales = await db.plan_cuentas.findMany({
      where: { empresaId },
      select: { id: true, codigo: true, nombre: true },
    });
    const aEliminar = cuentasActuales
      .filter((c) => !codigosBase.has(c.codigo))
      .sort((a, b) => b.codigo.localeCompare(a.codigo)); // hijos antes que padres

    let eliminadas = 0;
    const noEliminadas = [];

    for (const cuenta of aEliminar) {
      const tieneMovimientos = await db.asientos_contables_detalle.count({
        where: { cuentaId: cuenta.id },
      });
      if (tieneMovimientos > 0) {
        noEliminadas.push({ codigo: cuenta.codigo, nombre: cuenta.nombre, razon: 'tiene movimientos contables' });
        continue;
      }
      // Verificar otras referencias (bancos, configuración, anticipos...)
      try {
        await db.plan_cuentas.delete({ where: { id: cuenta.id } });
        eliminadas++;
      } catch {
        noEliminadas.push({ codigo: cuenta.codigo, nombre: cuenta.nombre, razon: 'referenciada por otros registros' });
      }
    }

    // 2. Sembrar / actualizar plan base
    const resultado = await db.$transaction(async (tx) =>
      sembrarPlanCuentasBase(tx, empresaId, { overwriteExisting: true })
    );

    res.json({
      success: true,
      mensaje: `Plan base AELA restaurado: ${resultado.creadas} creadas, ${resultado.actualizadas} actualizadas, ${eliminadas} cuentas extra eliminadas${noEliminadas.length ? `, ${noEliminadas.length} no eliminadas (tienen movimientos)` : ''}`,
      data: { ...resultado, eliminadas, noEliminadas },
    });
  } catch (error) {
    console.error('POST /contabilidad/plan-cuentas/restaurar-base:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo restaurar el plan base' });
  }
});

// POST /api/contabilidad/plan-cuentas/semilla-supercias — instala plan NIIF Supercias
router.post('/plan-cuentas/semilla-supercias', async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const overwriteExisting = Boolean(req.body?.overwriteExisting);
    const resultado = await sembrarPlanSupercias(db, empresaId, overwriteExisting);

    res.json({
      success: true,
      data: resultado,
      mensaje: overwriteExisting
        ? `Plan NIIF Supercias sincronizado: ${resultado.creadas} creadas, ${resultado.actualizadas} actualizadas`
        : `Plan NIIF Supercias instalado: ${resultado.creadas} cuentas creadas`,
    });
  } catch (error) {
    console.error('POST /contabilidad/plan-cuentas/semilla-supercias:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo instalar el plan NIIF Supercias' });
  }
});

// GET /api/contabilidad/plan-cuentas/estado — detecta si el sistema arranca desde cero
router.get('/plan-cuentas/estado', async (req, res) => {
  try {
    const db        = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const [totalCuentas, totalAsientos] = await Promise.all([
      db.plan_cuentas.count({ where: { empresaId } }),
      db.asientos_contables.count({ where: { empresaId } }),
    ]);

    res.json({
      success: true,
      data: {
        planVacio:        totalCuentas === 0,
        tieneMovimientos: totalAsientos > 0,
        totalCuentas,
        totalAsientos,
      },
    });
  } catch (error) {
    // Si la tabla aún no existe en este tenant (BD recién migrada), retornar
    // estado "vacío" en lugar de 500 — el frontend mostrará opción de instalar plan.
    if (error?.code === 'P2021' || /does not exist/i.test(error?.message || '')) {
      return res.json({ success: true, data: { planVacio: true, tieneMovimientos: false, totalCuentas: 0, totalAsientos: 0 } });
    }
    console.error('GET /contabilidad/plan-cuentas/estado:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar estado del plan' });
  }
});

// ─── Configuración de asientos automáticos ───────────────────────────
// Permite al contador elegir, desde su propio Plan de Cuentas, a qué cuenta se
// contabilizan las compras (en vez de siempre usar las cuentas genéricas por
// defecto tipo "5.2.01.001 Compras Locales"). Ver utils/contabilidad.js
// (obtenerConfiguracionContable, _resolverCuenta).
const CAMPOS_CONFIG_CONTABLE = [
  'codigoCuentaComprasGasto',
  'codigoCuentaInventario',
  'codigoCuentaIvaCompras',
  'codigoCuentaCxP',
  'codigoCuentaCajaCompras',
  'codigoCuentaCostoVentas',
];

// GET /api/contabilidad/configuracion-asientos
router.get('/configuracion-asientos', async (req, res) => {
  try {
    const db        = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const config = await db.configuracion_contable.findUnique({ where: { empresaId } });

    res.json({ success: true, data: config || {} });
  } catch (error) {
    if (error?.code === 'P2021' || /does not exist/i.test(error?.message || '')) {
      return res.json({ success: true, data: {} });
    }
    console.error('GET /contabilidad/configuracion-asientos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener la configuración contable' });
  }
});

// PUT /api/contabilidad/configuracion-asientos
router.put('/configuracion-asientos', async (req, res) => {
  try {
    const db        = req.prisma;
    const empresaId = obtenerEmpresaId(req);

    const data = {};
    for (const campo of CAMPOS_CONFIG_CONTABLE) {
      if (req.body?.[campo] !== undefined) {
        const valor = String(req.body[campo] || '').trim();
        data[campo] = valor || null;
      }
    }

    // Validar que cada código configurado exista realmente en el plan de cuentas
    // de la empresa y acepte movimiento — evita guardar una referencia rota.
    const codigos = Object.values(data).filter(Boolean);
    if (codigos.length > 0) {
      const cuentas = await db.plan_cuentas.findMany({
        where: { empresaId, codigo: { in: codigos } },
        select: { codigo: true, aceptaMovimiento: true, activo: true },
      });
      const porCodigo = new Map(cuentas.map((c) => [c.codigo, c]));
      for (const codigo of codigos) {
        const cuenta = porCodigo.get(codigo);
        if (!cuenta) {
          return res.status(400).json({ success: false, mensaje: `La cuenta "${codigo}" no existe en el Plan de Cuentas de la empresa` });
        }
        if (!cuenta.aceptaMovimiento || !cuenta.activo) {
          return res.status(400).json({ success: false, mensaje: `La cuenta "${codigo}" no está activa o no acepta movimientos directos` });
        }
      }
    }

    const config = await db.configuracion_contable.upsert({
      where: { empresaId },
      update: data,
      create: { empresaId, ...data },
    });

    res.json({ success: true, data: config });
  } catch (error) {
    console.error('PUT /contabilidad/configuracion-asientos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al guardar la configuración contable' });
  }
});

// ─── Configuración de cuentas por referencia — catálogos largos ─────
// Complementa a configuracion-asientos (6 campos fijos, solo Compras). Para
// listas largas que crecen (retenciones por código SRI, conceptos de nómina,
// cuentas generales) sin seguir agregando columnas. Ver
// utils/catalogosCuentasReferencia.js (catálogo fijo) y
// utils/contabilidad.js (obtenerCuentasReferenciaConfiguradas, resolución).
// GET /api/contabilidad/configuracion-referencias/:categoria
router.get('/configuracion-referencias/:categoria', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = obtenerEmpresaId(req);
    const { categoria } = req.params;
    if (!CATEGORIAS_CONFIG_REFERENCIA.includes(categoria)) {
      return res.status(400).json({ success: false, mensaje: 'Categoría inválida' });
    }

    const catalogo = obtenerCatalogoReferencias(categoria);
    const filas = await db.configuracion_cuentas_referencia.findMany({
      where: { empresaId, categoria },
      include: { cuenta: { select: { id: true, codigo: true, nombre: true } } },
    });
    const porCodigo = new Map(filas.map((f) => [f.codigoReferencia, f.cuenta]));

    const data = catalogo.map((item) => ({
      codigoReferencia: item.codigoReferencia,
      etiqueta: item.etiqueta,
      cuenta: porCodigo.get(item.codigoReferencia) || null,
    }));

    res.json({ success: true, data });
  } catch (error) {
    // Tabla aún no existe en este tenant — retornar catálogo sin cuentas asignadas
    if (error?.code === 'P2021' || /does not exist/i.test(error?.message || '')) {
      const catalogo = obtenerCatalogoReferencias(req.params.categoria || '').map((item) => ({
        codigoReferencia: item.codigoReferencia,
        etiqueta: item.etiqueta,
        cuenta: null,
      }));
      return res.json({ success: true, data: catalogo });
    }
    console.error('GET /contabilidad/configuracion-referencias/:categoria:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener la configuración de referencias' });
  }
});

// La tabla se crea vía migración + applySchemaFixes.js, pero tenants que no
// hayan recibido ese fix todavía (deploy parcial, orden de ejecución, etc.)
// se quedan sin ella. GET ya lo tolera devolviendo el catálogo vacío; PUT no
// tenía el mismo respaldo y el usuario solo veía "Error al guardar la
// configuración de referencias" sin más contexto. Auto-reparable: crea la
// tabla si falta (idempotente, mismo SQL que scripts/applySchemaFixes.js)
// antes de intentar guardar, en vez de esperar al próximo deploy.
async function asegurarTablaConfiguracionReferencia(db) {
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "configuracion_cuentas_referencia" (
      "id"               SERIAL PRIMARY KEY,
      "empresaId"        INTEGER NOT NULL,
      "categoria"        VARCHAR(30) NOT NULL,
      "codigoReferencia" VARCHAR(50) NOT NULL,
      "cuentaId"         INTEGER NOT NULL,
      "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.$executeRawUnsafe(`
    ALTER TABLE "configuracion_cuentas_referencia" ALTER COLUMN "codigoReferencia" TYPE VARCHAR(50)
  `);
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "config_cuentas_ref_empresa_cat_cod_key"
      ON "configuracion_cuentas_referencia"("empresaId", "categoria", "codigoReferencia")
  `);
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "config_cuentas_ref_empresaId_idx" ON "configuracion_cuentas_referencia"("empresaId")
  `);
  await db.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "config_cuentas_ref_cuentaId_idx" ON "configuracion_cuentas_referencia"("cuentaId")
  `);
}

// PUT /api/contabilidad/configuracion-referencias/:categoria
router.put('/configuracion-referencias/:categoria', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = obtenerEmpresaId(req);
    const { categoria } = req.params;
    if (!CATEGORIAS_CONFIG_REFERENCIA.includes(categoria)) {
      return res.status(400).json({ success: false, mensaje: 'Categoría inválida' });
    }

    await asegurarTablaConfiguracionReferencia(db);

    const catalogo = obtenerCatalogoReferencias(categoria);
    const codigosValidos = new Set(catalogo.map((c) => c.codigoReferencia));
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    for (const it of items) {
      if (!codigosValidos.has(String(it.codigoReferencia))) {
        return res.status(400).json({ success: false, mensaje: `Referencia "${it.codigoReferencia}" no pertenece a ${categoria}` });
      }
    }

    const cuentaIds = [...new Set(items.filter((i) => i.cuentaId).map((i) => Number(i.cuentaId)))];
    if (cuentaIds.length > 0) {
      const cuentas = await db.plan_cuentas.findMany({
        where: { empresaId, id: { in: cuentaIds }, activo: true, aceptaMovimiento: true },
        select: { id: true },
      });
      if (cuentas.length !== cuentaIds.length) {
        return res.status(400).json({ success: false, mensaje: 'Una o más cuentas no existen, no están activas o no aceptan movimiento' });
      }
    }

    await db.$transaction(items.map((it) => (
      it.cuentaId
        ? db.configuracion_cuentas_referencia.upsert({
            where: { empresaId_categoria_codigoReferencia: { empresaId, categoria, codigoReferencia: String(it.codigoReferencia) } },
            update: { cuentaId: Number(it.cuentaId) },
            create: { empresaId, categoria, codigoReferencia: String(it.codigoReferencia), cuentaId: Number(it.cuentaId) },
          })
        : db.configuracion_cuentas_referencia.deleteMany({
            where: { empresaId, categoria, codigoReferencia: String(it.codigoReferencia) },
          })
    )));

    res.json({ success: true });
  } catch (error) {
    console.error('PUT /contabilidad/configuracion-referencias/:categoria:', {
      empresaId: obtenerEmpresaId(req), categoria: req.params.categoria,
      code: error.code, meta: error.meta, message: error.message,
    });
    if (error.code === 'P2003') {
      return res.status(400).json({ success: false, mensaje: 'Una de las cuentas seleccionadas no es válida para esta empresa' });
    }
    res.status(500).json({ success: false, mensaje: 'Error al guardar la configuración de referencias', codigo: error.code || null });
  }
});

// GET /api/contabilidad/plan-cuentas/plantilla — descarga Excel de ejemplo
router.get('/plan-cuentas/plantilla', async (req, res) => {
  try {
    const buffer = generarPlantillaPlanCuentas();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-plan-cuentas.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('GET /contabilidad/plan-cuentas/plantilla:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar la plantilla' });
  }
});

// POST /api/contabilidad/plan-cuentas/importar/preview — valida sin guardar
router.post('/plan-cuentas/importar/preview', multerPlanCuentas, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });

    let rows, columnas;
    try {
      ({ rows, columnas } = parsearBuffer(req.file.buffer));
    } catch {
      return res.status(400).json({ success: false, mensaje: 'El archivo no es un Excel válido (.xlsx o .xls)' });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El archivo está vacío o no contiene filas de datos' });
    }

    const resultados = parsearPlanCuentas(rows);
    const validos    = resultados.filter((r) => r.estado === 'ok');
    const errores    = resultados.filter((r) => r.estado === 'error');

    res.json({
      success: true,
      data: { total: resultados.length, validos: validos.length, errores: errores.length, filas: resultados, columnas },
    });
  } catch (error) {
    console.error('POST /contabilidad/plan-cuentas/importar/preview:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el archivo' });
  }
});

// POST /api/contabilidad/plan-cuentas/importar/ejecutar — upsert en BD
// Form-data: archivo (xlsx), reemplazar ('true'|'false')
router.post('/plan-cuentas/importar/ejecutar', multerPlanCuentas, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, mensaje: 'No se recibió ningún archivo' });

    const db         = req.prisma;
    const empresaId  = obtenerEmpresaId(req);
    const reemplazar = String(req.body?.reemplazar || '').toLowerCase() === 'true';

    let rows;
    try {
      ({ rows } = parsearBuffer(req.file.buffer));
    } catch {
      return res.status(400).json({ success: false, mensaje: 'El archivo no es un Excel válido (.xlsx o .xls)' });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'El archivo está vacío' });
    }

    const resultados = parsearPlanCuentas(rows);
    const validos    = resultados.filter((r) => r.estado === 'ok');

    if (validos.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'No hay filas válidas para importar' });
    }

    // Ordenar por código (ascendente) → padres antes que hijos
    validos.sort((a, b) => a.data.codigo.localeCompare(b.data.codigo));

    let eliminadas   = 0;
    const noEliminadas = []; // cuentas que no se pudieron borrar (tienen movimientos)

    // ── Modo reemplazar: borrar cuentas que no están en el Excel ─────────────
    if (reemplazar) {
      const codigosExcel    = new Set(validos.map((v) => v.data.codigo));
      const cuentasActuales = await db.plan_cuentas.findMany({
        where: { empresaId },
        select: { id: true, codigo: true, nombre: true },
      });

      // Eliminar en orden inverso (hijos antes que padres) para no violar jerarquía
      const aEliminar = cuentasActuales
        .filter((c) => !codigosExcel.has(c.codigo))
        .sort((a, b) => b.codigo.localeCompare(a.codigo));

      for (const cuenta of aEliminar) {
        const tieneMovimientos = await db.asientos_contables_detalle.count({
          where: { cuentaId: cuenta.id },
        });

        if (tieneMovimientos > 0) {
          noEliminadas.push({ codigo: cuenta.codigo, nombre: cuenta.nombre, razon: 'tiene movimientos contables' });
          continue;
        }

        try {
          await db.plan_cuentas.delete({ where: { id: cuenta.id } });
          eliminadas++;
        } catch {
          noEliminadas.push({ codigo: cuenta.codigo, nombre: cuenta.nombre, razon: 'referenciada por otros registros' });
        }
      }
    }

    // ── Upsert de cuentas del Excel ───────────────────────────────────────────
    let creadas    = 0;
    let actualizadas = 0;
    const erroresImport = [];

    for (const item of validos) {
      try {
        const existente = await db.plan_cuentas.findFirst({
          where: { empresaId, codigo: item.data.codigo },
        });

        const data = { empresaId, ...item.data };

        if (existente) {
          await db.plan_cuentas.update({ where: { id: existente.id }, data });
          actualizadas++;
        } else {
          await db.plan_cuentas.create({ data });
          creadas++;
        }
      } catch (err) {
        erroresImport.push({ fila: item.fila, codigo: item.data.codigo, error: err.message });
      }
    }

    // ── Mensaje final ─────────────────────────────────────────────────────────
    const partes = [
      `${creadas} cuentas creadas`,
      actualizadas ? `${actualizadas} actualizadas` : null,
      reemplazar && eliminadas ? `${eliminadas} eliminadas` : null,
      reemplazar && noEliminadas.length ? `${noEliminadas.length} no eliminadas (tienen movimientos)` : null,
      erroresImport.length ? `${erroresImport.length} con error` : null,
    ].filter(Boolean);

    res.json({
      success: true,
      mensaje: `Importación completada: ${partes.join(', ')}`,
      data: {
        creadas,
        actualizadas,
        eliminadas,
        noEliminadas,
        errores: erroresImport.length,
        erroresDetalle: erroresImport,
      },
    });
  } catch (error) {
    console.error('POST /contabilidad/plan-cuentas/importar/ejecutar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al importar plan de cuentas' });
  }
});

// GET /api/contabilidad/asientos
router.get('/asientos', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const asientos = await listarAsientos(empresaId, req.query);
    res.json({ success: true, data: asientos });
  } catch (error) {
    console.error('GET /contabilidad/asientos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar asientos contables' });
  }
});

// POST /api/contabilidad/asiento-inicial
router.post('/asiento-inicial', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { periodo, fecha = new Date(), descripcion, detalles } = req.body || {};

    if (periodo && !esCodigoPeriodoValido(periodo)) {
      return res.status(400).json({ success: false, mensaje: 'El período debe tener formato MM/YYYY' });
    }

    if (periodo) {
      const periodoExistente = await prisma.periodos_contables.findFirst({
        where: { empresaId, codigo: periodo },
      });
      if (!periodoExistente) {
        return res.status(400).json({ success: false, mensaje: 'El período indicado no existe para la empresa actual' });
      }
    }

    await validarPeriodoAbiertoParaFecha(empresaId, fecha);
    const asiento = await crearAsientoContable({
      empresaId,
      fecha,
      descripcion: descripcion || `Asiento inicial${periodo ? ` ${periodo}` : ''}`,
      tipo: 'INICIAL',
      referencia: periodo ? `APERTURA-${periodo}` : 'APERTURA',
      usuarioId: req.usuario?.id,
      detalles,
    });

    res.status(201).json({ success: true, data: asiento });
  } catch (error) {
    console.error('POST /contabilidad/asiento-inicial:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo registrar el asiento inicial' });
  }
});

// POST /api/contabilidad/asientos
router.post('/asientos', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { fecha = new Date(), descripcion, tipo = 'MANUAL', referencia = null, detalles } = req.body || {};

    if (!TIPOS_ASIENTO_EDITABLES.includes(String(tipo).toUpperCase())) {
      return res.status(400).json({ success: false, mensaje: 'Solo se permiten asientos MANUAL o AJUSTE desde este formulario' });
    }

    await validarPeriodoAbiertoParaFecha(empresaId, fecha);
    const asiento = await crearAsientoContable({
      empresaId,
      fecha,
      descripcion,
      tipo: String(tipo).toUpperCase(),
      referencia,
      usuarioId: req.usuario?.id,
      detalles,
    });

    res.status(201).json({ success: true, data: asiento });
  } catch (error) {
    console.error('POST /contabilidad/asientos:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo crear el asiento contable' });
  }
});

// GET /api/contabilidad/asientos/:id
router.get('/asientos/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const asiento = await prisma.asientos_contables.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: { cuenta: true, centroCosto: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!asiento) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    res.json({ success: true, data: asiento });
  } catch (error) {
    console.error('GET /contabilidad/asientos/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener asiento contable' });
  }
});

// PUT /api/contabilidad/asientos/:id
router.put('/asientos/:id', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.asientos_contables.findFirst({
      where: { id, empresaId },
      include: { detalles: true },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    if (actual.cerrado) {
      return res.status(400).json({ success: false, mensaje: 'El asiento está cerrado y no puede modificarse' });
    }
    if (actual.bloqueado) {
      const { tienePermiso } = require('../utils/roles');
      if (!tienePermiso(req.usuario?.rol, 'contabilidad.bloquear')) {
        return res.status(403).json({ success: false, mensaje: 'El asiento está bloqueado. Solo el Contador o Administrador puede modificarlo.' });
      }
    }

    const fecha = req.body?.fecha || actual.fecha;
    const tipo = String(req.body?.tipo || actual.tipo).toUpperCase();
    const descripcion = req.body?.descripcion || actual.descripcion;
    const referencia = req.body?.referencia === undefined ? actual.referencia : (req.body.referencia || null);
    const detalles = req.body?.detalles || actual.detalles;

    await validarPeriodoAbiertoParaFecha(empresaId, fecha);
    const { normalizados, totalDebe, totalHaber } = await normalizarDetallesAsiento(empresaId, detalles);

    const actualizado = await prisma.$transaction(async (tx) => {
      await tx.asientos_contables_detalle.deleteMany({
        where: { asientoId: id },
      });

      return tx.asientos_contables.update({
        where: { id },
        data: {
          fecha: new Date(fecha),
          descripcion,
          tipo,
          referencia,
          totalDebe,
          totalHaber,
          detalles: { create: normalizados },
        },
        include: {
          detalles: {
            include: { cuenta: true, centroCosto: true },
            orderBy: { id: 'asc' },
          },
        },
      });
    });

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('PUT /contabilidad/asientos/:id:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo actualizar el asiento' });
  }
});

// POST /api/contabilidad/asientos/:id/cerrar
router.post('/asientos/:id/cerrar', async (req, res) => {  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.asientos_contables.findFirst({
      where: { id, empresaId },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    if (actual.cerrado) return res.json({ success: true, data: actual });

    const actualizado = await prisma.asientos_contables.update({
      where: { id },
      data: { cerrado: true },
    });

    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('POST /contabilidad/asientos/:id/cerrar:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cerrar el asiento' });
  }
});

// POST /api/contabilidad/asientos/:id/bloquear
router.post('/asientos/:id/bloquear', async (req, res) => {
  try {
    const { tienePermiso } = require('../utils/roles');
    if (!tienePermiso(req.usuario?.rol, 'contabilidad.bloquear')) {
      return res.status(403).json({ success: false, mensaje: 'Solo el Contador o Administrador puede bloquear asientos' });
    }
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.asientos_contables.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    if (actual.bloqueado) return res.json({ success: true, data: actual });

    const actualizado = await prisma.asientos_contables.update({
      where: { id },
      data: { bloqueado: true, bloqueadoPor: req.usuario.id },
    });
    res.json({ success: true, data: actualizado, mensaje: 'Asiento bloqueado' });
  } catch (error) {
    console.error('POST /contabilidad/asientos/:id/bloquear:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo bloquear el asiento' });
  }
});

// POST /api/contabilidad/asientos/:id/desbloquear
router.post('/asientos/:id/desbloquear', async (req, res) => {
  try {
    const { tienePermiso } = require('../utils/roles');
    if (!tienePermiso(req.usuario?.rol, 'contabilidad.bloquear')) {
      return res.status(403).json({ success: false, mensaje: 'Solo el Contador o Administrador puede desbloquear asientos' });
    }
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.asientos_contables.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });

    const actualizado = await prisma.asientos_contables.update({
      where: { id },
      data: { bloqueado: false, bloqueadoPor: null },
    });
    res.json({ success: true, data: actualizado, mensaje: 'Asiento desbloqueado' });
  } catch (error) {
    console.error('POST /contabilidad/asientos/:id/desbloquear:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo desbloquear el asiento' });
  }
});

// POST /api/contabilidad/asientos/:id/anular
router.post('/asientos/:id/anular', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    const fecha = req.body?.fecha || new Date();
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.asientos_contables.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });
    if (actual.tipo === 'ANULACION') {
      return res.status(400).json({ success: false, mensaje: 'No se puede anular un asiento de anulación' });
    }

    const referencia = `REV-ASI-${actual.id}`;
    const existente = await prisma.asientos_contables.findFirst({
      where: {
        empresaId,
        tipo: 'ANULACION',
        referencia,
      },
      include: {
        detalles: {
          include: { cuenta: true },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (existente) {
      return res.json({ success: true, data: existente, mensaje: 'El asiento ya tenía reverso registrado' });
    }

    await validarPeriodoAbiertoParaFecha(empresaId, fecha);
    const reverso = await crearAsientoContable({
      empresaId,
      fecha,
      descripcion: `Reverso de asiento ${actual.numero}: ${actual.descripcion}`,
      tipo: 'ANULACION',
      referencia,
      usuarioId: req.usuario?.id,
      detalles: actual.detalles.map((detalle) => ({
        cuentaId: detalle.cuentaId,
        descripcion: detalle.descripcion || `Reverso asiento ${actual.numero}`,
        debe: round2(detalle.haber || 0),
        haber: round2(detalle.debe || 0),
      })),
    });

    await prisma.asientos_contables.update({
      where: { id },
      data: { cerrado: true },
    });

    res.json({ success: true, data: reverso });
  } catch (error) {
    console.error('POST /contabilidad/asientos/:id/anular:', error);
    res.status(400).json({ success: false, mensaje: error.message || 'No se pudo anular el asiento' });
  }
});

// POST /api/contabilidad/asientos/auto/nomina/:periodo
router.post('/asientos/auto/nomina/:periodo', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const periodo = req.params.periodo;
    if (!esCodigoPeriodoValido(periodo)) {
      return res.status(400).json({ success: false, mensaje: 'El período debe tener formato MM/YYYY' });
    }

    const resultado = await crearAsientoNominaPeriodo({
      empresaId,
      periodo,
      usuarioId: req.usuario?.id,
      fecha: req.body?.fecha || new Date(),
    });

    res.json({ success: true, data: resultado });
  } catch (error) {
    const status = error.message?.includes('no está implementado') ? 501 : 400;
    console.error('POST /contabilidad/asientos/auto/nomina/:periodo:', error);
    res.status(status).json({ success: false, mensaje: error.message || 'No se pudo generar el asiento de nómina' });
  }
});

// GET /api/contabilidad/mayor/:cuentaId
router.get('/mayor/:cuentaId', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const cuentaId = parseIntSafe(req.params.cuentaId);
    if (!cuentaId) return res.status(400).json({ success: false, mensaje: 'Cuenta inválida' });

    const data = await obtenerLibroMayor(empresaId, cuentaId, req.query);
    if (!data) return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada' });

    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/mayor/:cuentaId:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar libro mayor' });
  }
});

// GET /api/contabilidad/mayorizacion
router.get('/mayorizacion', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const data = await obtenerMayorizacion(empresaId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/mayorizacion:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar mayorización' });
  }
});

// GET /api/contabilidad/consultas/resumen
router.get('/consultas/resumen', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const data = await obtenerConsultasResumen(empresaId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/consultas/resumen:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar consulta de resumen contable' });
  }
});

// GET /api/contabilidad/reportes/diario?formato=csv|pdf
router.get('/reportes/diario', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const formato = String(req.query.formato || 'csv').toLowerCase();
    if (!['csv', 'pdf'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv o pdf' });
    }

    const asientos = await listarAsientos(empresaId, req.query, { includeDetails: true, ignorePagination: true });

    if (formato === 'csv') {
      const rows = [];
      asientos.forEach((asiento) => {
        if (!asiento.detalles?.length) {
          rows.push({
            numero: asiento.numero,
            fecha: formatDateOnly(asiento.fecha),
            tipo: asiento.tipo,
            referencia: asiento.referencia || '',
            descripcion: asiento.descripcion,
            cuenta: '',
            detalle: '',
            debe: round2(asiento.totalDebe),
            haber: round2(asiento.totalHaber),
            estado: asiento.cerrado ? 'CERRADO' : 'ABIERTO',
          });
          return;
        }

        asiento.detalles.forEach((detalle) => {
          rows.push({
            numero: asiento.numero,
            fecha: formatDateOnly(asiento.fecha),
            tipo: asiento.tipo,
            referencia: asiento.referencia || '',
            descripcion: asiento.descripcion,
            cuenta: `${detalle.cuenta.codigo} - ${detalle.cuenta.nombre}`,
            detalle: detalle.descripcion || '',
            debe: round2(detalle.debe || 0),
            haber: round2(detalle.haber || 0),
            estado: asiento.cerrado ? 'CERRADO' : 'ABIERTO',
          });
        });
      });

      return enviarCsv(
        res,
        `libro_diario_${formatDateOnly(new Date())}.csv`,
        ['numero', 'fecha', 'tipo', 'referencia', 'descripcion', 'cuenta', 'detalle', 'debe', 'haber', 'estado'],
        rows,
      );
    }

    const doc = crearDocumentoPdf(res, `libro_diario_${formatDateOnly(new Date())}.pdf`);
    doc.fontSize(14).text('Libro Diario', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`);
    doc.text(`Filtros: periodo=${req.query.periodo || '-'} desde=${req.query.desde || '-'} hasta=${req.query.hasta || '-'} tipo=${req.query.tipo || '-'}`);
    doc.moveDown(0.5);

    asientos.forEach((asiento) => {
      escribirLineaPdf(doc, `Asiento ${asiento.numero} | ${formatDateOnly(asiento.fecha)} | ${asiento.tipo} | ${asiento.descripcion}`);
      (asiento.detalles || []).forEach((detalle) => {
        escribirLineaPdf(
          doc,
          `  ${detalle.cuenta.codigo} ${detalle.cuenta.nombre} | Debe ${round2(detalle.debe || 0)} | Haber ${round2(detalle.haber || 0)} | ${detalle.descripcion || ''}`,
        );
      });
      doc.moveDown(0.2);
    });

    doc.end();
  } catch (error) {
    console.error('GET /contabilidad/reportes/diario:', error);
    res.status(500).json({ success: false, mensaje: 'Error al exportar libro diario' });
  }
});

// GET /api/contabilidad/reportes/mayor?formato=csv|pdf
router.get('/reportes/mayor', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const formato = String(req.query.formato || 'csv').toLowerCase();
    const cuentaId = parseIntSafe(req.query.cuentaId);
    if (!['csv', 'pdf'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv o pdf' });
    }

    const mayor = cuentaId ? await obtenerLibroMayor(empresaId, cuentaId, req.query) : null;
    const mayorizacion = await obtenerMayorizacion(empresaId, req.query);

    if (cuentaId && !mayor) {
      return res.status(404).json({ success: false, mensaje: 'Cuenta no encontrada para reporte de mayor' });
    }

    if (formato === 'csv') {
      const rows = [];
      if (mayor) {
        mayor.movimientos.forEach((movimiento) => {
          rows.push({
            seccion: 'MAYOR',
            codigo: mayor.cuenta.codigo,
            cuenta: mayor.cuenta.nombre,
            fecha: formatDateOnly(movimiento.fecha),
            asientoNumero: movimiento.numero,
            tipo: movimiento.tipo,
            detalle: movimiento.descripcionDetalle || movimiento.descripcionAsiento || '',
            debe: movimiento.debe,
            haber: movimiento.haber,
            saldo: movimiento.saldo,
          });
        });
      }

      mayorizacion.tabla.forEach((fila) => {
        rows.push({
          seccion: 'MAYORIZACION',
          codigo: fila.codigo,
          cuenta: fila.nombre,
          fecha: '',
          asientoNumero: '',
          tipo: fila.tipo,
          detalle: `Movimientos: ${fila.movimientos}`,
          debe: fila.totalDebe,
          haber: fila.totalHaber,
          saldo: fila.saldo,
        });
      });

      return enviarCsv(
        res,
        `libro_mayor_${formatDateOnly(new Date())}.csv`,
        ['seccion', 'codigo', 'cuenta', 'fecha', 'asientoNumero', 'tipo', 'detalle', 'debe', 'haber', 'saldo'],
        rows,
      );
    }

    const doc = crearDocumentoPdf(res, `libro_mayor_${formatDateOnly(new Date())}.pdf`);
    doc.fontSize(14).text('Libro Mayor', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`);
    doc.text(`Filtros: cuentaId=${cuentaId || 'todas'} desde=${req.query.desde || '-'} hasta=${req.query.hasta || '-'} periodo=${req.query.periodo || '-'}`);
    doc.moveDown(0.5);

    if (mayor) {
      doc.fontSize(11).text(`Cuenta: ${mayor.cuenta.codigo} - ${mayor.cuenta.nombre} | Saldo final: ${mayor.saldoFinal}`);
      doc.moveDown(0.2);
      mayor.movimientos.forEach((movimiento) => {
        escribirLineaPdf(
          doc,
          `${formatDateOnly(movimiento.fecha)} | As. ${movimiento.numero} | ${movimiento.tipo} | Debe ${movimiento.debe} | Haber ${movimiento.haber} | Saldo ${movimiento.saldo}`,
        );
      });
      doc.moveDown(0.5);
    }

    doc.fontSize(11).text('Mayorización por lote');
    mayorizacion.tabla.forEach((fila) => {
      escribirLineaPdf(
        doc,
        `${fila.codigo} ${fila.nombre} | Mov: ${fila.movimientos} | Debe ${fila.totalDebe} | Haber ${fila.totalHaber} | Saldo ${fila.saldo}`,
      );
    });
    doc.end();
  } catch (error) {
    console.error('GET /contabilidad/reportes/mayor:', error);
    res.status(500).json({ success: false, mensaje: 'Error al exportar reporte de libro mayor' });
  }
});

// GET /api/contabilidad/reportes/estados?formato=csv|pdf
router.get('/reportes/estados', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const formato = String(req.query.formato || 'csv').toLowerCase();
    if (!['csv', 'pdf'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv o pdf' });
    }

    const filtros = {
      periodo: req.query.periodo,
      desde: req.query.desde,
      hasta: req.query.hasta,
    };

    const [balance, resultados, consultas] = await Promise.all([
      obtenerBalanceComprobacion(empresaId, filtros),
      obtenerEstadoResultados(empresaId, filtros),
      obtenerConsultasResumen(empresaId, filtros),
    ]);
    const balanceGeneral = await obtenerBalanceGeneral(empresaId, req.query.fechaBalance || req.query.hasta || new Date());

    if (formato === 'csv') {
      const rows = [
        {
          seccion: 'BALANCE_COMPROBACION',
          metrica: 'Totales',
          valor1: balance.resumen.totalDebe,
          valor2: balance.resumen.totalHaber,
          valor3: balance.resumen.saldoNeto,
        },
        {
          seccion: 'ESTADO_RESULTADOS',
          metrica: 'Totales',
          valor1: resultados.totalIngresos,
          valor2: round2(resultados.totalGastos + resultados.totalCostos),
          valor3: resultados.utilidad,
        },
        {
          seccion: 'BALANCE_GENERAL',
          metrica: 'Totales',
          valor1: balanceGeneral.totalActivos,
          valor2: round2(balanceGeneral.totalPasivos + balanceGeneral.totalPatrimonio),
          valor3: balanceGeneral.balanceado ? 'SI' : 'NO',
        },
        {
          seccion: 'CONSULTAS',
          metrica: 'Asientos',
          valor1: consultas.total,
          valor2: consultas.abiertos,
          valor3: consultas.cerrados,
        },
      ];

      consultas.tipos.forEach((tipo) => rows.push({
        seccion: 'CONSULTAS_POR_TIPO',
        metrica: tipo.tipo,
        valor1: tipo.cantidad,
        valor2: tipo.totalDebe,
        valor3: tipo.totalHaber,
      }));

      return enviarCsv(
        res,
        `estados_financieros_${formatDateOnly(new Date())}.csv`,
        ['seccion', 'metrica', 'valor1', 'valor2', 'valor3'],
        rows,
      );
    }

    const doc = crearDocumentoPdf(res, `estados_financieros_${formatDateOnly(new Date())}.pdf`);
    doc.fontSize(14).text('Estados Financieros', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(9).text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`);
    doc.text(`Filtros: periodo=${req.query.periodo || '-'} desde=${req.query.desde || '-'} hasta=${req.query.hasta || '-'} fechaBalance=${req.query.fechaBalance || '-'}`);
    doc.moveDown(0.5);

    doc.fontSize(11).text('Balance de Comprobación');
    escribirLineaPdf(doc, `Debe: ${balance.resumen.totalDebe} | Haber: ${balance.resumen.totalHaber} | Saldo neto: ${balance.resumen.saldoNeto}`);
    doc.moveDown(0.2);
    doc.fontSize(11).text('Estado de Resultados');
    escribirLineaPdf(doc, `Ingresos: ${resultados.totalIngresos} | Gastos: ${resultados.totalGastos} | Costos: ${resultados.totalCostos} | Utilidad: ${resultados.utilidad}`);
    doc.moveDown(0.2);
    doc.fontSize(11).text('Balance General');
    escribirLineaPdf(doc, `Activos: ${balanceGeneral.totalActivos} | Pasivos + Patrimonio: ${round2(balanceGeneral.totalPasivos + balanceGeneral.totalPatrimonio)} | Balanceado: ${balanceGeneral.balanceado ? 'Sí' : 'No'}`);
    doc.moveDown(0.2);
    doc.fontSize(11).text('Consultas de Asientos');
    escribirLineaPdf(doc, `Total: ${consultas.total} | Abiertos: ${consultas.abiertos} | Cerrados: ${consultas.cerrados}`);
    consultas.tipos.forEach((tipo) => {
      escribirLineaPdf(doc, ` - ${tipo.tipo}: Cant ${tipo.cantidad}, Debe ${tipo.totalDebe}, Haber ${tipo.totalHaber}`);
    });
    doc.end();
  } catch (error) {
    console.error('GET /contabilidad/reportes/estados:', error);
    res.status(500).json({ success: false, mensaje: 'Error al exportar reporte de estados financieros' });
  }
});

// GET /api/contabilidad/balance-comprobacion
router.get('/balance-comprobacion', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const data = await obtenerBalanceComprobacion(empresaId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/balance-comprobacion:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar balance de comprobación' });
  }
});

// GET /api/contabilidad/estado-resultados
router.get('/estado-resultados', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const data = await obtenerEstadoResultados(empresaId, req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/estado-resultados:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar estado de resultados' });
  }
});

// GET /api/contabilidad/balance-general
router.get('/balance-general', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const data = await obtenerBalanceGeneral(empresaId, req.query.fecha || new Date());
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/balance-general:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar balance general' });
  }
});

module.exports = router;
