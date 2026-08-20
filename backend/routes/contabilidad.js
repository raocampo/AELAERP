const express = require('express');
const multer  = require('multer');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs   = require('fs');
const path = require('path');
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

// Resuelve el logo de configuracion_sri para PDFKit — soporta data URI
// base64 (formato actual) y ruta de archivo legado. Mismo helper que ya usa
// utils/sri.js (_resolverLogo) para el RIDE de factura, copiado localmente
// porque allá está sin exportar.
function _resolverLogoContable(logoUrl) {
  if (!logoUrl) return { logoData: null, tieneLogo: false };
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return { logoData: Buffer.from(b64, 'base64'), tieneLogo: true };
    } catch { return { logoData: null, tieneLogo: false }; }
  }
  const logoPath = path.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  const existe = fs.existsSync(logoPath);
  return { logoData: existe ? logoPath : null, tieneLogo: existe };
}

// Encabezado corporativo reutilizable para los PDFs de contabilidad — logo
// (si la empresa tiene uno cargado en Configuración SRI) a la izquierda,
// razón social/RUC/dirección centrados, título del reporte debajo. Mismo
// dato que ya usa el recibo POS (config.razonSocial/ruc/dirMatriz).
function dibujarEncabezadoContable(doc, config, titulo) {
  const ML = doc.page.margins.left;
  const W  = doc.page.width - ML - doc.page.margins.right;
  const { logoData, tieneLogo } = _resolverLogoContable(config?.logoUrl);
  let y = doc.y;

  if (tieneLogo) {
    try { doc.image(logoData, ML, y, { fit: [70, 45] }); } catch { /* logo corrupto → omitir */ }
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
    .text((config?.razonSocial || 'Empresa').toUpperCase(), ML, y, { width: W, align: 'center' });
  doc.fontSize(8).font('Helvetica').fillColor('#475569')
    .text([config?.ruc, config?.dirMatriz, config?.telefono].filter(Boolean).join('  ·  '), { width: W, align: 'center' });
  doc.moveDown(0.4);

  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
    .text(titulo, { width: W, align: 'center' });
  doc.font('Helvetica').fillColor('#000000');
  doc.moveDown(0.3);

  const lineY = doc.y;
  doc.moveTo(ML, lineY).lineTo(ML + W, lineY).lineWidth(1).stroke('#7C3AED');
  doc.moveDown(0.4);
}

function escribirLineaPdf(doc, texto = '', opts = {}) {
  if (doc.y > 760) doc.addPage();
  doc.text(texto, opts);
}

// Tabla real para PDFs de contabilidad (reemplaza el volcado de texto plano
// separado por "|" que tenía el Libro Mayor) — mismo lenguaje visual que ya
// usa el talón resumen del ATS (routes/ats.js): encabezado con fondo,
// filas con banda alterna, salto de página repitiendo el encabezado.
//
// @param columnas [{ header, key, width, align?, formato? }]
// @param filas    array de objetos con las claves de `columnas`
// @param startY   y donde empezar a dibujar
// @returns y final, para poder seguir escribiendo después de la tabla
function dibujarTablaPdf(doc, columnas, filas, startY) {
  const ML = doc.page.margins.left;
  const LIMITE_Y = doc.page.height - doc.page.margins.bottom;
  const ROW_H_MIN = 16;
  const anchoTotal = columnas.reduce((s, c) => s + c.width, 0);
  let y = startY;

  const dibujarEncabezado = () => {
    doc.rect(ML, y, anchoTotal, ROW_H_MIN).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8);
    let x = ML;
    columnas.forEach((c) => {
      doc.text(c.header, x + 3, y + 4, { width: c.width - 6, align: c.align || 'left' });
      x += c.width;
    });
    doc.font('Helvetica').fillColor('#000000');
    y += ROW_H_MIN;
  };

  dibujarEncabezado();
  doc.fontSize(8);

  filas.forEach((fila, i) => {
    const valores = columnas.map((c) => (c.formato ? c.formato(fila[c.key], fila) : String(fila[c.key] ?? '')));
    // Alto dinámico: se mide el texto más alto de la fila (ej. "Detalle" con
    // varias líneas) en vez de usar un alto fijo con ellipsis — así un
    // detalle largo se ve completo, envuelto en varias líneas, en vez de
    // recortado con "…" (PDFKit no calcula esto solo: hay que medir con
    // heightOfString ANTES de dibujar el rect() de fondo de la fila).
    const altoFila = Math.max(ROW_H_MIN, ...columnas.map((c, idx) =>
      doc.heightOfString(valores[idx], { width: c.width - 6, align: c.align || 'left' }) + 8));

    if (y + altoFila > LIMITE_Y) {
      doc.addPage();
      y = doc.page.margins.top;
      dibujarEncabezado();
      doc.fontSize(8);
    }
    if (i % 2 === 1) doc.rect(ML, y, anchoTotal, altoFila).fill('#f8fafc').fillColor('#000000');
    let x = ML;
    columnas.forEach((c, idx) => {
      doc.text(valores[idx], x + 3, y + 4, { width: c.width - 6, align: c.align || 'left' });
      x += c.width;
    });
    y += altoFila;
  });

  // Sincronizar el cursor real de PDFKit con el "y" calculado — cada
  // doc.text(valor, x, y) de las celdas deja doc.x/doc.y donde terminó la
  // ÚLTIMA celda dibujada (dentro de la fila, no debajo de la tabla), así
  // que sin esto lo que se dibuje después de la tabla (totales, notas)
  // queda montado sobre la última fila en vez de debajo.
  doc.x = ML;
  doc.y = y + 6;
  return doc.y;
}

// Dibuja el detalle movimiento-por-movimiento de una cuenta (mismo bloque
// que usa el reporte de "una cuenta" y, ahora, cada cuenta del libro mayor
// general — antes el general solo mostraba el resumen de mayorización, sin
// este detalle).
function dibujarDetalleMayorCuentaPdf(doc, mayor, money) {
  doc.fontSize(11).font('Helvetica-Bold').text(`Cuenta: `, { continued: true })
    .font('Helvetica').text(`${mayor.cuenta.codigo} - ${mayor.cuenta.nombre}`);
  doc.fontSize(10).font('Helvetica-Bold').text('Saldo final: ', { continued: true })
    .font('Helvetica').text(`${money(mayor.saldoFinal)}  ·  ${mayor.movimientos.length} movimiento(s)`);
  doc.moveDown(0.3);

  dibujarTablaPdf(doc, [
    { header: 'Fecha',     key: 'fecha',      width: 55, formato: formatDateOnly },
    { header: 'Asiento',   key: 'numero',     width: 75 },
    { header: 'Tipo',      key: 'tipo',       width: 65 },
    { header: 'Detalle',   key: 'detalle',    width: 158 },
    { header: 'Debe',      key: 'debe',       width: 55, align: 'right', formato: money },
    { header: 'Haber',     key: 'haber',      width: 55, align: 'right', formato: money },
    { header: 'Saldo',     key: 'saldo',      width: 60, align: 'right', formato: money },
  ], mayor.movimientos.map((m) => ({
    ...m,
    detalle: m.descripcionDetalle || m.descripcionAsiento || '',
  })), doc.y);
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

  // Salvaguarda: una misma cuenta (por id) no debe aparecer 2 veces en la
  // misma sección del balance. plan_cuentas tiene @@unique([empresaId,
  // codigo]) así que en teoría no puede pasar, pero se filtra igual antes
  // de calcular totales/imprimir — es más barato deduplicar que dejar que
  // un dato corrupto duplique un saldo en el reporte que firma gerencia.
  const sinDuplicados = (filas) => [...new Map(filas.map((f) => [f.id, f])).values()];

  const activos    = sinDuplicados(filasBalance.filter((f) => f.tipo === 'ACTIVO'));
  const pasivos    = sinDuplicados(filasBalance.filter((f) => f.tipo === 'PASIVO'));
  const patrimonio = sinDuplicados(filasBalance.filter((f) => f.tipo === 'PATRIMONIO'));

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

// ─── Estado de Flujo de Efectivo (método indirecto) ──────────────────────────
//
// No existe un campo explícito "operación/inversión/financiamiento" por
// cuenta en el plan de cuentas, y AELA admite 2 esquemas de códigos con
// prefijos distintos (base: "1.1"/"1.2"/"2.1"/"2.2"/"3.1" con puntos;
// Supercías/NIIF: "101"/"102"/"201"/"202"/"30" sin puntos) — un prefijo fijo
// solo funcionaría para uno de los dos. Ambos esquemas sí usan los mismos
// NOMBRES de grupo estándar de contabilidad ("ACTIVO CORRIENTE"/"ACTIVO NO
// CORRIENTE"/etc.), así que la clasificación se hace por nombre, no por
// código — robusta ante cualquiera de los 2 planes semillados.
const _RX_NO_CORRIENTE = /no\s+corriente/i;
const _RX_CORRIENTE    = /corriente/i;
const _RX_EFECTIVO     = /efectivo\s+y\s+equivalentes/i;

function _buscarGrupoContable(filas, tipo, { corriente, noCorriente, patron } = {}) {
  const candidatos = filas.filter((f) => {
    if (f.tipo !== tipo) return false;
    if (patron) return patron.test(f.nombre);
    const esNoCorriente = _RX_NO_CORRIENTE.test(f.nombre);
    const esCorriente = _RX_CORRIENTE.test(f.nombre) && !esNoCorriente;
    return noCorriente ? esNoCorriente : corriente ? esCorriente : false;
  });
  // Si hay varios candidatos (no debería, con los 2 planes soportados), el
  // más cercano a la raíz del plan es el código más corto.
  candidatos.sort((a, b) => a.codigo.length - b.codigo.length);
  return candidatos[0]?.saldo ?? 0;
}

async function obtenerFlujoEfectivo(empresaId, fechaDesde, fechaHasta) {
  const inicio = fechaDesde ? new Date(fechaDesde) : new Date(new Date().getFullYear(), 0, 1);
  const fin = endOfDay(fechaHasta) || endOfDay(new Date());
  const finAnterior = endOfDay(new Date(inicio.getTime() - 24 * 60 * 60 * 1000));

  const [balInicial, balFinal, resultadosPeriodo] = await Promise.all([
    construirJerarquiaContable(empresaId, ['ACTIVO', 'PASIVO', 'PATRIMONIO'], { hasta: finAnterior.toISOString() }),
    construirJerarquiaContable(empresaId, ['ACTIVO', 'PASIVO', 'PATRIMONIO'], { hasta: fin.toISOString() }),
    construirJerarquiaContable(empresaId, ['INGRESO', 'GASTO', 'COSTO'], { desde: inicio.toISOString(), hasta: fin.toISOString() }),
  ]);

  const ingresosPeriodo = round2(resultadosPeriodo.filter((f) => !f.codigoPadre && f.tipo === 'INGRESO').reduce((a, f) => a + f.saldo, 0));
  const egresosPeriodo  = round2(resultadosPeriodo.filter((f) => !f.codigoPadre && (f.tipo === 'GASTO' || f.tipo === 'COSTO')).reduce((a, f) => a + f.saldo, 0));
  const utilidadNeta = round2(ingresosPeriodo - egresosPeriodo);

  const efectivoInicial = _buscarGrupoContable(balInicial, 'ACTIVO', { patron: _RX_EFECTIVO });
  const efectivoFinal   = _buscarGrupoContable(balFinal,   'ACTIVO', { patron: _RX_EFECTIVO });
  const variacionEfectivoReal = round2(efectivoFinal - efectivoInicial);

  const variacionGrupo = (tipo, opts) =>
    round2(_buscarGrupoContable(balFinal, tipo, opts) - _buscarGrupoContable(balInicial, tipo, opts));

  // Operación: utilidad neta ajustada por cambios en capital de trabajo.
  // Un aumento de activo corriente operativo (CxC, inventario) CONSUME
  // efectivo (signo negativo); un aumento de pasivo corriente (CxP) LIBERA
  // efectivo (signo positivo).
  const varActivoCorriente = variacionGrupo('ACTIVO', { corriente: true });
  const varEfectivo = round2(efectivoFinal - efectivoInicial);
  const varActivoCorrienteOperativo = round2(varActivoCorriente - varEfectivo);
  const varPasivoCorriente = variacionGrupo('PASIVO', { corriente: true });
  const flujoOperacion = round2(utilidadNeta - varActivoCorrienteOperativo + varPasivoCorriente);

  // Inversión: un aumento de activo no corriente (compra de PPE) CONSUME efectivo.
  const varActivoNoCorriente = variacionGrupo('ACTIVO', { noCorriente: true });
  const flujoInversion = round2(-varActivoNoCorriente);

  // Financiamiento: aumento de deuda LP o aportes de capital LIBERAN/aportan efectivo.
  const varPasivoNoCorriente = variacionGrupo('PASIVO', { noCorriente: true });
  const varPatrimonio = round2(
    balFinal.filter((f) => !f.codigoPadre && f.tipo === 'PATRIMONIO').reduce((a, f) => a + f.saldo, 0) -
    balInicial.filter((f) => !f.codigoPadre && f.tipo === 'PATRIMONIO').reduce((a, f) => a + f.saldo, 0)
  );
  const flujoFinanciamiento = round2(varPasivoNoCorriente + varPatrimonio);

  const flujoNetoCalculado = round2(flujoOperacion + flujoInversion + flujoFinanciamiento);

  return {
    fechaDesde: inicio,
    fechaHasta: fin,
    operacion: {
      utilidadNeta,
      variacionCuentasPorCobrarEInventario: round2(-varActivoCorrienteOperativo),
      variacionCuentasPorPagar: varPasivoCorriente,
      total: flujoOperacion,
    },
    inversion: {
      variacionActivoFijo: round2(-varActivoNoCorriente),
      total: flujoInversion,
    },
    financiamiento: {
      variacionDeudaLargoPlazo: varPasivoNoCorriente,
      variacionPatrimonio: varPatrimonio,
      total: flujoFinanciamiento,
    },
    flujoNetoCalculado,
    efectivoInicial,
    efectivoFinal,
    variacionEfectivoReal,
    cuadra: Math.abs(round2(flujoNetoCalculado - variacionEfectivoReal)) < 0.01,
  };
}

// ─── Estado de Cambios en el Patrimonio ──────────────────────────────────────
//
// Data-driven: no asume nombres/profundidad de subgrupos (Capital/Reservas/
// Resultados varían de estructura entre el plan base y el NIIF Supercías) —
// muestra una fila por cada cuenta de patrimonio que acepta movimiento
// (aceptaMovimiento=true), con su saldo al inicio y fin del período. Es el
// mismo nivel de detalle que cualquier plan de cuentas expone de por sí.
async function obtenerCambiosPatrimonio(empresaId, fechaDesde, fechaHasta) {
  const inicio = fechaDesde ? new Date(fechaDesde) : new Date(new Date().getFullYear(), 0, 1);
  const fin = endOfDay(fechaHasta) || endOfDay(new Date());
  const finAnterior = endOfDay(new Date(inicio.getTime() - 24 * 60 * 60 * 1000));

  const [patInicial, patFinal, resultadosPeriodo] = await Promise.all([
    construirJerarquiaContable(empresaId, ['PATRIMONIO'], { hasta: finAnterior.toISOString() }),
    construirJerarquiaContable(empresaId, ['PATRIMONIO'], { hasta: fin.toISOString() }),
    construirJerarquiaContable(empresaId, ['INGRESO', 'GASTO', 'COSTO'], { desde: inicio.toISOString(), hasta: fin.toISOString() }),
  ]);

  const ingresosPeriodo = round2(resultadosPeriodo.filter((f) => !f.codigoPadre && f.tipo === 'INGRESO').reduce((a, f) => a + f.saldo, 0));
  const egresosPeriodo  = round2(resultadosPeriodo.filter((f) => !f.codigoPadre && (f.tipo === 'GASTO' || f.tipo === 'COSTO')).reduce((a, f) => a + f.saldo, 0));
  const utilidadNetaPeriodo = round2(ingresosPeriodo - egresosPeriodo);

  const mapaInicial = new Map(patInicial.map((f) => [f.codigo, f.saldo]));
  const componentes = patFinal
    .filter((f) => f.aceptaMovimiento)
    .map((f) => {
      const saldoInicial = mapaInicial.get(f.codigo) ?? 0;
      const saldoFinal = f.saldo;
      return { codigo: f.codigo, nombre: f.nombre, saldoInicial, movimientoPeriodo: round2(saldoFinal - saldoInicial), saldoFinal };
    })
    .filter((c) => c.saldoInicial !== 0 || c.saldoFinal !== 0);

  const totalInicial = round2(componentes.reduce((a, c) => a + c.saldoInicial, 0));
  const totalFinal = round2(componentes.reduce((a, c) => a + c.saldoFinal, 0));
  const totalMovimiento = round2(totalFinal - totalInicial);

  return { fechaDesde: inicio, fechaHasta: fin, utilidadNetaPeriodo, componentes, totalInicial, totalMovimiento, totalFinal };
}

// ─── Cierre de ejercicio anual ────────────────────────────────────────────────
//
// Genera el asiento de cierre formal: debita cada cuenta de INGRESO con
// saldo (naturaleza CREDITO) y acredita cada cuenta de GASTO/COSTO con saldo
// (naturaleza DEBITO), dejándolas en cero para el año cerrado, y traslada el
// neto (utilidad o pérdida) a la cuenta de patrimonio "Utilidad del
// Ejercicio". No se genera un asiento de "apertura" aparte: a diferencia de
// un libro físico, las cuentas de Balance (Activo/Pasivo/Patrimonio) en AELA
// ya son acumulativas desde el origen — su "saldo inicial" del año siguiente
// es automáticamente el saldo con el que quedó el cierre, sin necesidad de
// repetirlo en un asiento nuevo.
async function cerrarEjercicioAnual(empresaId, anio, usuarioId) {
  const inicio = new Date(anio, 0, 1);
  const fin = endOfDay(new Date(anio, 11, 31));

  const yaExiste = await prisma.asientos_contables.findFirst({
    where: { empresaId, tipo: 'CIERRE_ANUAL', fecha: { gte: inicio, lte: fin } },
  });
  if (yaExiste) {
    const err = new Error(`El ejercicio ${anio} ya fue cerrado (asiento ${yaExiste.numero}).`);
    err.status = 400;
    throw err;
  }

  const filasResultados = await construirJerarquiaContable(empresaId, ['INGRESO', 'GASTO', 'COSTO'], {
    desde: inicio.toISOString(), hasta: fin.toISOString(),
  });
  const cuentasHoja = filasResultados.filter((f) => f.aceptaMovimiento && round2(f.saldo) !== 0);
  if (!cuentasHoja.length) {
    const err = new Error(`No hay movimientos de ingresos, gastos o costos en ${anio} para cerrar.`);
    err.status = 400;
    throw err;
  }

  const filasPatrimonio = await construirJerarquiaContable(empresaId, ['PATRIMONIO'], { hasta: fin.toISOString() });
  const cuentaResultado = filasPatrimonio.find((f) => f.aceptaMovimiento && /utilidad|resultado/i.test(f.nombre));
  if (!cuentaResultado) {
    const err = new Error('No se encontró una cuenta de patrimonio para el resultado del ejercicio (ej. "Utilidad del Ejercicio") que acepte movimiento. Créala en el Plan de Cuentas antes de cerrar.');
    err.status = 400;
    throw err;
  }

  const detalles = [];
  let totalIngresos = 0;
  let totalEgresos = 0;
  for (const c of cuentasHoja) {
    const monto = Math.abs(round2(c.saldo));
    if (c.naturaleza === 'CREDITO') {
      detalles.push({ cuentaId: c.id, debe: monto, haber: 0, descripcion: `Cierre ${anio} — ${c.nombre}` });
      totalIngresos = round2(totalIngresos + c.saldo);
    } else {
      detalles.push({ cuentaId: c.id, debe: 0, haber: monto, descripcion: `Cierre ${anio} — ${c.nombre}` });
      totalEgresos = round2(totalEgresos + c.saldo);
    }
  }
  const utilidadNeta = round2(totalIngresos - totalEgresos);
  if (utilidadNeta >= 0) {
    detalles.push({ cuentaId: cuentaResultado.id, debe: 0, haber: utilidadNeta, descripcion: `Utilidad del ejercicio ${anio}` });
  } else {
    detalles.push({ cuentaId: cuentaResultado.id, debe: -utilidadNeta, haber: 0, descripcion: `Pérdida del ejercicio ${anio}` });
  }

  const asiento = await crearAsientoContable({
    empresaId,
    fecha: fin,
    descripcion: `Cierre de ejercicio ${anio}`,
    tipo: 'CIERRE_ANUAL',
    referencia: `CIERRE-${anio}`,
    usuarioId,
    detalles,
    cerrado: true,
  });

  return { asiento, utilidadNeta, cuentasCerradas: cuentasHoja.length, cuentaResultado: { id: cuentaResultado.id, codigo: cuentaResultado.codigo, nombre: cuentaResultado.nombre } };
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
    const db        = req.prisma || prisma;
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
    const db = req.prisma || prisma;
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
    const db        = req.prisma || prisma;
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
    const db        = req.prisma || prisma;
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
    const db        = req.prisma || prisma;
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

    const db         = req.prisma || prisma;
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

// GET /api/contabilidad/asientos/:id/pdf — comprobante contable imprimible
// con todos los datos del asiento (cabecera, detalle completo, totales).
router.get('/asientos/:id/pdf', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const asiento = await prisma.asientos_contables.findFirst({
      where: { id, empresaId },
      include: {
        detalles: { include: { cuenta: true, centroCosto: true }, orderBy: { id: 'asc' } },
        usuario: { select: { nombre: true } },
      },
    });
    if (!asiento) return res.status(404).json({ success: false, mensaje: 'Asiento no encontrado' });

    const config = await prisma.configuracion_sri.findFirst({ where: { empresaId } });
    const money = (v) => `$${Number(v || 0).toFixed(2)}`;

    const doc = crearDocumentoPdf(res, `asiento_${asiento.numero}.pdf`);
    dibujarEncabezadoContable(doc, config, `Comprobante Contable ${asiento.numero}`);

    doc.fontSize(9);
    doc.font('Helvetica-Bold').text('Fecha: ', { continued: true }).font('Helvetica').text(formatDateOnly(asiento.fecha));
    doc.font('Helvetica-Bold').text('Tipo: ', { continued: true }).font('Helvetica').text(asiento.tipo);
    if (asiento.referencia) {
      doc.font('Helvetica-Bold').text('Referencia: ', { continued: true }).font('Helvetica').text(asiento.referencia);
    }
    doc.font('Helvetica-Bold').text('Descripción: ', { continued: true }).font('Helvetica').text(asiento.descripcion);
    doc.font('Helvetica-Bold').text('Estado: ', { continued: true }).font('Helvetica').text(
      [asiento.cerrado ? 'Cerrado' : 'Abierto', asiento.bloqueado ? 'Bloqueado' : null].filter(Boolean).join(' · ')
    );
    doc.moveDown(0.5);

    const anchoTablaAsiento = 195 + 65 + 115 + 65 + 65;
    const mlAsiento = doc.page.margins.left;

    dibujarTablaPdf(doc, [
      { header: 'Cuenta',    key: 'cuenta',      width: 195 },
      { header: 'C. Costo',  key: 'centroCosto', width: 65 },
      { header: 'Detalle',   key: 'detalle',     width: 115 },
      { header: 'Debe',      key: 'debe',        width: 65, align: 'right', formato: money },
      { header: 'Haber',     key: 'haber',       width: 65, align: 'right', formato: money },
    ], asiento.detalles.map((d) => ({
      cuenta: `${d.cuenta.codigo} ${d.cuenta.nombre}`,
      centroCosto: d.centroCosto?.nombre || '',
      detalle: d.descripcion || '',
      debe: d.debe,
      haber: d.haber,
    })), doc.y);

    // Línea separadora + totales alineados al ancho real de la tabla (antes
    // el texto de totales heredaba el x/y donde había quedado la última
    // celda dibujada, así que se montaba sobre la última fila).
    doc.moveTo(mlAsiento, doc.y).lineTo(mlAsiento + anchoTablaAsiento, doc.y).lineWidth(0.5).stroke('#cbd5e1');
    doc.moveDown(0.35);
    doc.fontSize(9).font('Helvetica-Bold')
      .text(`Total Debe: ${money(asiento.totalDebe)}    Total Haber: ${money(asiento.totalHaber)}`,
        mlAsiento, doc.y, { width: anchoTablaAsiento, align: 'right' });
    doc.font('Helvetica').fillColor('#000000');
    doc.moveDown(0.8);

    doc.fontSize(7).font('Helvetica').fillColor('#94a3b8').text(
      `Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}` +
      (asiento.usuario?.nombre ? `  ·  Elaborado por: ${asiento.usuario.nombre}` : '') +
      `  ·  Creado: ${formatDateOnly(asiento.createdAt)}`
    ).fillColor('#000000');

    doc.end();
  } catch (error) {
    console.error('GET /contabilidad/asientos/:id/pdf:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el PDF del asiento' });
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
    if (!['csv', 'xlsx', 'pdf'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv, xlsx o pdf' });
    }

    const asientos = await listarAsientos(empresaId, req.query, { includeDetails: true, ignorePagination: true });

    if (formato === 'csv' || formato === 'xlsx') {
      const rows = [];
      asientos.forEach((asiento) => {
        if (!asiento.detalles?.length) {
          rows.push({
            numero: asiento.numero,
            fecha: asiento.fecha,
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
            fecha: asiento.fecha,
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

      if (formato === 'csv') {
        return enviarCsv(
          res,
          `libro_diario_${formatDateOnly(new Date())}.csv`,
          ['numero', 'fecha', 'tipo', 'referencia', 'descripcion', 'cuenta', 'detalle', 'debe', 'haber', 'estado'],
          rows.map((r) => ({ ...r, fecha: formatDateOnly(r.fecha) })),
        );
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'AELA ERP';
      workbook.created = new Date();
      const ws = workbook.addWorksheet('Libro Diario');
      ws.columns = [
        { header: '#',            key: 'numero',      width: 14 },
        { header: 'Fecha',        key: 'fecha',        width: 12 },
        { header: 'Tipo',         key: 'tipo',          width: 12 },
        { header: 'Referencia',   key: 'referencia',    width: 16 },
        { header: 'Descripción',  key: 'descripcion',   width: 35 },
        { header: 'Cuenta',       key: 'cuenta',        width: 35 },
        { header: 'Detalle',      key: 'detalle',       width: 35 },
        { header: 'Debe',         key: 'debe',          width: 14 },
        { header: 'Haber',        key: 'haber',         width: 14 },
        { header: 'Estado',       key: 'estado',        width: 12 },
      ];
      ws.getRow(1).eachCell((cell) => Object.assign(cell, ESTILO_ENCABEZADO_XLSX));
      rows.forEach((r) => {
        const fila = ws.addRow({ ...r, fecha: new Date(r.fecha) });
        fila.getCell('fecha').numFmt = 'dd/mm/yyyy';
        fila.getCell('debe').numFmt = FORMATO_MONEDA_XLSX;
        fila.getCell('haber').numFmt = FORMATO_MONEDA_XLSX;
      });
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="libro_diario_${formatDateOnly(new Date())}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
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
// El CSV del libro mayor es texto plano sin formato — para uso contable
// real (revisar en Excel, resaltar, filtrar) hace falta un .xlsx con
// encabezados en negrita, columnas de moneda con formato numérico real
// (no texto) y ancho de columna razonable. xlsx (SheetJS) ya se usa en
// otras partes del sistema para leer/generar plantillas, pero su edición
// community NO escribe estilos de celda de forma confiable (probado: bold
// y fill quedan sin aplicar al reabrir el archivo) — solo persiste el
// formato numérico. exceljs sí escribe estilos reales, por eso se usa acá.
const FORMATO_MONEDA_XLSX = '"$"#,##0.00';
const ESTILO_ENCABEZADO_XLSX = {
  font: { bold: true, color: { argb: 'FF1E293B' } },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } },
  border: { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } },
};

// Nombre de hoja válido para Excel (máx 31 caracteres, sin : \ / ? * [ ]) y
// único dentro del libro — Excel no permite 2 hojas con el mismo nombre.
function nombreHojaExcel(base, usados) {
  let limpio = String(base || 'Hoja').replace(/[:\\/?*[\]]/g, '-').slice(0, 31).trim();
  if (!limpio) limpio = 'Hoja';
  let nombre = limpio;
  let i = 2;
  while (usados.has(nombre)) {
    const sufijo = ` (${i})`;
    nombre = `${limpio.slice(0, 31 - sufijo.length)}${sufijo}`;
    i += 1;
  }
  usados.add(nombre);
  return nombre;
}

// Nombre del archivo descargado del reporte de mayor — sin la cuenta filtrada
// es "reportemayorgeneral"; filtrado por cuenta es "reportemayor<Cuenta>"
// (nombre de cuenta sin tildes/espacios/símbolos) para que se identifique de
// un vistazo en la carpeta de descargas.
function nombreArchivoMayor(mayor) {
  if (!mayor) return 'reportemayorgeneral';
  const limpio = String(mayor.cuenta?.nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '');
  return `reportemayor${limpio || mayor.cuenta?.codigo || 'cuenta'}`;
}

function agregarHojaMayorCuentaXlsx(workbook, nombreHoja, mayor) {
  const ws = workbook.addWorksheet(nombreHoja);
  ws.columns = [{ width: 12 }, { width: 16 }, { width: 14 }, { width: 45 }, { width: 14 }, { width: 14 }, { width: 14 }];

  const filaTitulo = ws.addRow([`Cuenta: ${mayor.cuenta.codigo} - ${mayor.cuenta.nombre}`]);
  ws.mergeCells(filaTitulo.number, 1, filaTitulo.number, 7);
  filaTitulo.getCell(1).font = { bold: true, size: 12 };

  const filaSaldo = ws.addRow([`Saldo final: $${Number(mayor.saldoFinal).toFixed(2)}  ·  ${mayor.movimientos.length} movimiento(s)`]);
  ws.mergeCells(filaSaldo.number, 1, filaSaldo.number, 7);
  filaSaldo.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };

  ws.addRow([]);

  const filaEncabezado = ws.addRow(['Fecha', 'Asiento', 'Tipo', 'Detalle', 'Debe', 'Haber', 'Saldo']);
  filaEncabezado.eachCell((cell) => Object.assign(cell, ESTILO_ENCABEZADO_XLSX));

  mayor.movimientos.forEach((m) => {
    const fila = ws.addRow([
      new Date(m.fecha),
      m.numero,
      m.tipo,
      m.descripcionDetalle || m.descripcionAsiento || '',
      Number(m.debe || 0),
      Number(m.haber || 0),
      Number(m.saldo || 0),
    ]);
    fila.getCell(1).numFmt = 'dd/mm/yyyy';
    fila.getCell(5).numFmt = FORMATO_MONEDA_XLSX;
    fila.getCell(6).numFmt = FORMATO_MONEDA_XLSX;
    fila.getCell(7).numFmt = FORMATO_MONEDA_XLSX;
  });

  ws.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];
  return ws;
}

function agregarHojaResumenMayorXlsx(workbook, mayorizacion) {
  const ws = workbook.addWorksheet('Resumen');
  ws.columns = [{ width: 14 }, { width: 40 }, { width: 12 }, { width: 14 }, { width: 14 }, { width: 14 }];

  const filaTitulo = ws.addRow(['Mayorización por lote']);
  ws.mergeCells(filaTitulo.number, 1, filaTitulo.number, 6);
  filaTitulo.getCell(1).font = { bold: true, size: 12 };

  const filaResumen = ws.addRow([
    `${mayorizacion.resumen.cuentas} cuenta(s)  ·  ${mayorizacion.resumen.movimientos} movimiento(s)  ·  ` +
    `Debe $${mayorizacion.resumen.totalDebe.toFixed(2)}  ·  Haber $${mayorizacion.resumen.totalHaber.toFixed(2)}`,
  ]);
  ws.mergeCells(filaResumen.number, 1, filaResumen.number, 6);
  filaResumen.getCell(1).font = { italic: true, color: { argb: 'FF64748B' } };

  ws.addRow([]);

  const filaEncabezado = ws.addRow(['Código', 'Cuenta', 'Movimientos', 'Debe', 'Haber', 'Saldo']);
  filaEncabezado.eachCell((cell) => Object.assign(cell, ESTILO_ENCABEZADO_XLSX));

  mayorizacion.tabla.forEach((fila) => {
    const r = ws.addRow([fila.codigo, fila.nombre, fila.movimientos, Number(fila.totalDebe), Number(fila.totalHaber), Number(fila.saldo)]);
    r.getCell(4).numFmt = FORMATO_MONEDA_XLSX;
    r.getCell(5).numFmt = FORMATO_MONEDA_XLSX;
    r.getCell(6).numFmt = FORMATO_MONEDA_XLSX;
  });

  ws.views = [{ state: 'frozen', ySplit: filaEncabezado.number }];
  return ws;
}

router.get('/reportes/mayor', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const formato = String(req.query.formato || 'csv').toLowerCase();
    const cuentaId = parseIntSafe(req.query.cuentaId);
    if (!['csv', 'pdf', 'xlsx'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv, pdf o xlsx' });
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
        `${nombreArchivoMayor(mayor)}.csv`,
        ['seccion', 'codigo', 'cuenta', 'fecha', 'asientoNumero', 'tipo', 'detalle', 'debe', 'haber', 'saldo'],
        rows,
      );
    }

    if (formato === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'AELA ERP';
      workbook.created = new Date();

      if (mayor) {
        agregarHojaMayorCuentaXlsx(workbook, 'Mayor', mayor);
      } else {
        agregarHojaResumenMayorXlsx(workbook, mayorizacion);
        const nombresUsados = new Set(['Resumen']);
        for (const fila of mayorizacion.tabla) {
          const detalleCuenta = await obtenerLibroMayor(empresaId, fila.cuentaId, req.query);
          if (!detalleCuenta || detalleCuenta.movimientos.length === 0) continue;
          const nombreHoja = nombreHojaExcel(`${fila.codigo} ${fila.nombre}`, nombresUsados);
          agregarHojaMayorCuentaXlsx(workbook, nombreHoja, detalleCuenta);
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivoMayor(mayor)}.xlsx"`);
      await workbook.xlsx.write(res);
      return res.end();
    }

    const config = await prisma.configuracion_sri.findFirst({ where: { empresaId } });

    const doc = crearDocumentoPdf(res, `${nombreArchivoMayor(mayor)}.pdf`);
    dibujarEncabezadoContable(doc, config, mayor ? 'Mayor de una cuenta contable' : 'Mayorización por lote');

    const money = (v) => `$${Number(v || 0).toFixed(2)}`;
    const desde = req.query.desde ? formatDateOnly(req.query.desde) : null;
    const hasta = req.query.hasta ? formatDateOnly(req.query.hasta) : null;

    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}` +
        (desde || hasta ? `  ·  Período: ${desde || '...'} a ${hasta || '...'}` : ''))
      .fillColor('#000000');
    doc.moveDown(0.4);

    if (mayor) {
      // Se filtró UNA cuenta — el PDF trae solo su detalle, sin la
      // mayorización de las demás cuentas (antes se anexaba siempre,
      // ruido innecesario cuando lo que se pidió fue una cuenta puntual).
      dibujarDetalleMayorCuentaPdf(doc, mayor, money);
    } else {
      // Sin cuenta filtrada — libro mayor general: primero el resumen de
      // mayorización (índice/totales), y luego el detalle completo
      // movimiento por movimiento de CADA cuenta, una página por cuenta —
      // igual al reporte de una cuenta individual, en vez de quedarse solo
      // en el resumen como antes.
      doc.fontSize(9).font('Helvetica').text(
        `${mayorizacion.resumen.cuentas} cuenta(s) · ${mayorizacion.resumen.movimientos} movimiento(s) · ` +
        `Debe ${money(mayorizacion.resumen.totalDebe)} · Haber ${money(mayorizacion.resumen.totalHaber)}`,
      );
      doc.moveDown(0.3);

      dibujarTablaPdf(doc, [
        { header: 'Código',      key: 'codigo',      width: 70 },
        { header: 'Cuenta',      key: 'nombre',      width: 220 },
        { header: 'Mov.',        key: 'movimientos', width: 40, align: 'right' },
        { header: 'Debe',        key: 'totalDebe',   width: 60, align: 'right', formato: money },
        { header: 'Haber',       key: 'totalHaber',  width: 60, align: 'right', formato: money },
        { header: 'Saldo',       key: 'saldo',        width: 63, align: 'right', formato: money },
      ], mayorizacion.tabla, doc.y);

      // Las cuentas ya NO se separan una por página — fluyen con un espacio
      // prudencial entre ellas y solo saltan de página cuando el bloque de
      // la siguiente cuenta (título + saldo + encabezado de tabla + al
      // menos 1 fila) no entra en lo que queda de la hoja actual, para no
      // dejar el título de la cuenta huérfano al pie de página.
      const limiteYMayor = doc.page.height - doc.page.margins.bottom;
      const altoMinCuenta = 80;
      for (const fila of mayorizacion.tabla) {
        const detalleCuenta = await obtenerLibroMayor(empresaId, fila.cuentaId, req.query);
        if (!detalleCuenta || detalleCuenta.movimientos.length === 0) continue;
        if (doc.y + altoMinCuenta > limiteYMayor) {
          doc.addPage();
        } else {
          doc.moveDown(1.2);
        }
        dibujarDetalleMayorCuentaPdf(doc, detalleCuenta, money);
      }
    }

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

// GET /api/contabilidad/reportes/balance-general?formato=csv|pdf — versión
// imprimible del Estado de Situación Financiera, con línea de firma para
// Gerente y Contador al final del documento (documento oficial que se
// entrega firmado, a diferencia de la tabla en pantalla).
router.get('/reportes/balance-general', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const formato = String(req.query.formato || 'pdf').toLowerCase();
    if (!['csv', 'pdf'].includes(formato)) {
      return res.status(400).json({ success: false, mensaje: 'Formato inválido. Use csv o pdf' });
    }

    const data = await obtenerBalanceGeneral(empresaId, req.query.fecha || new Date());
    const money = (v) => `$${Number(v || 0).toFixed(2)}`;

    if (formato === 'csv') {
      const rows = [];
      const agregarSeccion = (seccion, filas) => filas.forEach((f) => rows.push({
        seccion, codigo: f.codigo, cuenta: f.nombre, debe: f.totalDebe, haber: f.totalHaber, saldo: f.saldo,
      }));
      agregarSeccion('ACTIVO', data.activos);
      agregarSeccion('PASIVO', data.pasivos);
      agregarSeccion('PATRIMONIO', data.patrimonio);
      rows.push({ seccion: 'RESULTADO', codigo: '', cuenta: 'Resultado del ejercicio', debe: '', haber: '', saldo: data.resultadoEjercicio });
      rows.push({ seccion: 'TOTAL', codigo: '', cuenta: 'Total Activos', debe: '', haber: '', saldo: data.totalActivos });
      rows.push({ seccion: 'TOTAL', codigo: '', cuenta: 'Total Pasivo + Patrimonio', debe: '', haber: '', saldo: round2(data.totalPasivos + data.totalPatrimonioNeto) });

      return enviarCsv(
        res,
        `balance_general_${formatDateOnly(new Date())}.csv`,
        ['seccion', 'codigo', 'cuenta', 'debe', 'haber', 'saldo'],
        rows,
      );
    }

    const config = await prisma.configuracion_sri.findFirst({ where: { empresaId } });
    const doc = crearDocumentoPdf(res, `balance_general_${formatDateOnly(new Date())}.pdf`);
    dibujarEncabezadoContable(doc, config, 'Estado de Situación Financiera');

    doc.fontSize(8).fillColor('#94a3b8')
      .text(`Corte al: ${formatDateOnly(data.fecha)}  ·  Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`)
      .fillColor('#000000');
    doc.moveDown(0.4);

    const columnas = [
      { header: 'Cuenta', key: 'cuenta',     width: 260 },
      { header: 'Debe',   key: 'totalDebe',  width: 85, align: 'right', formato: (v) => (v ? money(v) : '') },
      { header: 'Haber',  key: 'totalHaber', width: 85, align: 'right', formato: (v) => (v ? money(v) : '') },
      { header: 'Saldo',  key: 'saldo',      width: 88, align: 'right', formato: money },
    ];
    const filaDe = (f) => ({
      cuenta: `${'  '.repeat(Math.max(0, f.nivel - 1))}${f.codigo} ${f.nombre}`,
      totalDebe: f.totalDebe,
      totalHaber: f.totalHaber,
      saldo: f.saldo,
    });

    doc.fontSize(10).font('Helvetica-Bold').text('ACTIVO');
    dibujarTablaPdf(doc, columnas, data.activos.map(filaDe), doc.y);
    doc.font('Helvetica-Bold').fontSize(9).text(`TOTAL ACTIVOS: ${money(data.totalActivos)}`, { align: 'right' });
    doc.moveDown(0.4);

    doc.fontSize(10).font('Helvetica-Bold').text('PASIVO');
    dibujarTablaPdf(doc, columnas, data.pasivos.map(filaDe), doc.y);
    doc.font('Helvetica-Bold').fontSize(9).text(`TOTAL PASIVOS: ${money(data.totalPasivos)}`, { align: 'right' });
    doc.moveDown(0.4);

    doc.fontSize(10).font('Helvetica-Bold').text('PATRIMONIO');
    dibujarTablaPdf(doc, columnas, data.patrimonio.map(filaDe), doc.y);
    doc.fontSize(9).font('Helvetica').text(`Resultado del ejercicio: ${money(data.resultadoEjercicio)}`, { align: 'right' });
    doc.font('Helvetica-Bold').text(`TOTAL PASIVO + PATRIMONIO: ${money(round2(data.totalPasivos + data.totalPatrimonioNeto))}`, { align: 'right' });
    doc.moveDown(0.3);
    // Sin símbolos Unicode (✓/⚠): la fuente base Helvetica de PDFKit usa
    // WinAnsiEncoding y no los tiene — salían como un glifo roto en el PDF.
    doc.fontSize(9).fillColor(data.balanceado ? '#16a34a' : '#dc2626')
      .text(data.balanceado ? 'Balance cuadrado' : 'ATENCIÓN: el balance NO cuadra — revisar antes de firmar', { align: 'right' })
      .fillColor('#000000');

    // Firmas al final del documento — si no queda espacio suficiente en la
    // página actual, arranca una página nueva en vez de apretarlas al pie.
    const ML = doc.page.margins.left;
    const anchoFirma = 180;
    if (doc.y > doc.page.height - 150) doc.addPage();
    doc.moveDown(3);
    const yFirma = doc.y;
    doc.moveTo(ML, yFirma).lineTo(ML + anchoFirma, yFirma).lineWidth(1).stroke('#000000');
    doc.moveTo(ML + 260, yFirma).lineTo(ML + 260 + anchoFirma, yFirma).stroke('#000000');
    doc.fontSize(9).font('Helvetica')
      .text('Gerente General', ML, yFirma + 4, { width: anchoFirma, align: 'center' })
      .text('Contador', ML + 260, yFirma + 4, { width: anchoFirma, align: 'center' });

    doc.end();
  } catch (error) {
    console.error('GET /contabilidad/reportes/balance-general:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo generar el reporte de balance general' });
  }
});

// GET /api/contabilidad/flujo-efectivo
router.get('/flujo-efectivo', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { desde, hasta } = req.query;
    const data = await obtenerFlujoEfectivo(empresaId, desde, hasta);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/flujo-efectivo:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar el estado de flujo de efectivo' });
  }
});

// GET /api/contabilidad/cambios-patrimonio
router.get('/cambios-patrimonio', async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { desde, hasta } = req.query;
    const data = await obtenerCambiosPatrimonio(empresaId, desde, hasta);
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /contabilidad/cambios-patrimonio:', error);
    res.status(500).json({ success: false, mensaje: 'Error al generar el estado de cambios en el patrimonio' });
  }
});

// POST /api/contabilidad/cierre-ejercicio
router.post('/cierre-ejercicio', autorizarPermiso('contabilidad.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const anio = parseInt(req.body?.anio, 10) || new Date().getFullYear();
    const data = await cerrarEjercicioAnual(empresaId, anio, req.usuario?.id);
    res.json({ success: true, data, mensaje: `Ejercicio ${anio} cerrado — ${data.utilidadNeta >= 0 ? 'utilidad' : 'pérdida'} de $${Math.abs(data.utilidadNeta).toFixed(2)} trasladada a ${data.cuentaResultado.nombre}.` });
  } catch (error) {
    console.error('POST /contabilidad/cierre-ejercicio:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'Error al cerrar el ejercicio anual' });
  }
});

// obtenerBalanceGeneral se reutiliza desde routes/declaraciones.js (F101 —
// totales de Activo/Pasivo/Patrimonio, casilleros 499/599/698 del formulario
// real) — se cuelga como propiedad del router en vez de mover la función a
// utils/contabilidad.js para no arriesgar tocar el resto de este archivo.
router.obtenerBalanceGeneral = obtenerBalanceGeneral;

module.exports = router;
