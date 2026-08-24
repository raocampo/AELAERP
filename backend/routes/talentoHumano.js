// ====================================
// TALENTO HUMANO — RRHH
// backend/routes/talentoHumano.js
// Cubre: departamentos, cargos, empleados, nómina, ausencias
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const {
  crearAsientoNominaPeriodo, crearAsientoPagoNominaPeriodo,
  crearAsientoPagoVacaciones, crearAsientoPagoEspecialNomina,
  round2,
} = require('../utils/contabilidad');
const { aplicarTablaProgresivaRenta } = require('../utils/tablaRentaPN');
const { calcularRebajaGastosPersonales } = require('../utils/rebajaGastosPersonales');

// Trabajador (o carga a su cargo) con discapacidad o enfermedad
// catastrófica/rara/huérfana — activa el tope especial de 100 canastas
// en la rebaja de gastos personales (ver utils/rebajaGastosPersonales.js).
function _tieneDiscapacidadOEnfermedad(emp) {
  return (emp?.condicionDiscapacidad && emp.condicionDiscapacidad !== 'NO_APLICA') || !!emp?.enfermedadCatastrofica;
}

// Normaliza los campos del Anexo RDEP (ver docs/pendientes-2026-08-24-rdep.md)
// desde el body de POST/PUT /empleados — usado por ambas rutas para no
// duplicar la lógica de valores por defecto/condicionales.
function _camposRdep(body) {
  const residenciaFiscal = body.residenciaFiscal === 'EXTERIOR' ? 'EXTERIOR' : 'LOCAL';
  const condicionDiscapacidad = ['TRABAJADOR_CON_DISCAPACIDAD', 'SUSTITUTO'].includes(body.condicionDiscapacidad)
    ? body.condicionDiscapacidad
    : 'NO_APLICA';
  return {
    beneficiarioGalapagos: !!body.beneficiarioGalapagos,
    enfermedadCatastrofica: !!body.enfermedadCatastrofica,
    condicionDiscapacidad,
    porcentajeDiscapacidad: condicionDiscapacidad !== 'NO_APLICA' && body.porcentajeDiscapacidad !== undefined && body.porcentajeDiscapacidad !== ''
      ? parseFloat(body.porcentajeDiscapacidad) : null,
    tipoIdDependienteDiscap: condicionDiscapacidad === 'SUSTITUTO' ? (body.tipoIdDependienteDiscap || null) : null,
    idDependienteDiscap: condicionDiscapacidad === 'SUSTITUTO' ? (body.idDependienteDiscap?.trim() || null) : null,
    residenciaFiscal,
    paisResidencia: residenciaFiscal === 'EXTERIOR' ? (body.paisResidencia || null) : null,
    aplicaConvenioDobleImposicion: residenciaFiscal === 'EXTERIOR' ? (body.aplicaConvenioDobleImposicion || 'NA') : null,
    gastosPersonalesProyectados: body.gastosPersonalesProyectados !== undefined
      ? parseFloat(body.gastosPersonalesProyectados) || 0 : 0,
  };
}

const verRRHH      = [proteger, autorizarPermiso('rrhh.ver')];
const gestionarRRHH = [proteger, autorizarPermiso('rrhh.gestionar')];
const nominaRRHH   = [proteger, autorizarPermiso('rrhh.nomina')];

// ─── SBU Ecuador (actualizar anualmente) ─────────────────────────────────────
const SBU_ECUADOR = 480.00; // SBU 2025
const APORTE_PERSONAL_IESS = 0.0945;
const APORTE_PATRONAL_IESS = 0.1115;

/**
 * Calcula el Impuesto a la Renta mensual a retener a un empleado.
 *
 * Proyección anual:
 *   ingresos = (salario + horasExtrasMes + otrosIngresosMes) × 12
 *              + decimoTercero (anual) + decimoCuarto (SBU)
 * Deducciones de la BASE: solo el aporte personal IESS proyectado anual.
 * Base imponible = ingresos - aporteIESSAnual
 * Aplica tabla progresiva LORTI → IR anual bruto.
 * La rebaja de gastos personales (metodología vigente desde 2022, ver
 * utils/rebajaGastosPersonales.js) es un CRÉDITO TRIBUTARIO — se resta del
 * IR anual YA CALCULADO, no de la base imponible (esa era la metodología
 * pre-2022, y es el bug que tenía este código hasta 2026-08-24: nadie le
 * pasaba nunca un valor de gastos personales, así que el bug estaba
 * dormido, pero la fórmula en sí era incorrecta).
 * IR mensual = IR anual neto / 12.
 *
 * @param {object} params
 * @param {number} params.salarioMensual
 * @param {number} params.sbu - SBU vigente (para 14to sueldo)
 * @param {number} [params.horasExtraMes=0] - valor monetario de HE del mes
 * @param {number} [params.otrosIngresosMes=0]
 * @param {boolean} [params.afiliadoIESS=true]
 * @param {number} [params.gastosPersonalesProyectados=0] - total anual proyectado por el empleado
 * @param {number} [params.cargasFamiliares=0]
 * @param {boolean} [params.tieneDiscapacidadOEnfermedadCatastrofica=false]
 * @returns {{ irMensual: number, irAnual: number, baseImponible: number, ingresoGravadoAnual: number, rebajaGastosPersonales: number }}
 */
function calcularImpuestoRentaMensual({
  salarioMensual,
  sbu,
  horasExtraMes = 0,
  otrosIngresosMes = 0,
  afiliadoIESS = true,
  gastosPersonalesProyectados = 0,
  cargasFamiliares = 0,
  tieneDiscapacidadOEnfermedadCatastrofica = false,
}) {
  const ingresosMensualesBase = salarioMensual + horasExtraMes + otrosIngresosMes;

  // Proyección anual de ingresos gravados (13o y 14o se incluyen porque son gravados)
  const ingresosAnuales =
    ingresosMensualesBase * 12 +
    salarioMensual +          // decimoTercero = salario anual / 12 × 12 ≈ salario mensual (simplificado)
    sbu;                      // decimoCuarto = SBU (anual por empleado)

  const aporteIESSAnual = afiliadoIESS ? salarioMensual * 12 * APORTE_PERSONAL_IESS : 0;
  const baseImponible = Math.max(0, ingresosAnuales - aporteIESSAnual);

  const irAnualBruto = aplicarTablaProgresivaRenta(baseImponible);
  const { rebaja: rebajaGastosPersonales } = calcularRebajaGastosPersonales({
    gastosPersonalesProyectados,
    cargasFamiliares,
    tieneDiscapacidadOEnfermedadCatastrofica,
  });
  const irAnual = Math.max(0, +(irAnualBruto - rebajaGastosPersonales).toFixed(2));
  const irMensual = +(irAnual / 12).toFixed(2);

  return {
    irMensual,
    irAnual,
    baseImponible: +baseImponible.toFixed(2),
    ingresoGravadoAnual: +ingresosAnuales.toFixed(2),
    rebajaGastosPersonales,
  };
}

// ─── Helpers de fechas para beneficios de ley ────────────────────────────────

// Enumera los pares {anio, mes} de las nóminas mensuales que caen dentro de
// [desde, hasta] — usado para sumar campos proporcionales (decimoTerceroProp,
// etc.) ya calculados mes a mes en nomina_detalles.
function _mesesEnRango(desde, hasta) {
  const metas = [];
  let d = new Date(desde.getFullYear(), desde.getMonth(), 1);
  const fin = new Date(hasta.getFullYear(), hasta.getMonth(), 1);
  while (d <= fin) {
    metas.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return metas;
}

async function _sumarProporcionalPendiente({ empresaId, empleadoId, campo, desde, hasta }) {
  const metas = _mesesEnRango(desde, hasta);
  if (metas.length === 0) return 0;
  const nominas = await prisma.nominas.findMany({ where: { empresaId, OR: metas }, select: { id: true } });
  if (nominas.length === 0) return 0;
  const detalles = await prisma.nomina_detalles.findMany({
    where: { empleadoId, nominaId: { in: nominas.map((n) => n.id) } },
  });
  return round2(detalles.reduce((s, d) => s + parseFloat(d[campo] || 0), 0));
}

// Período legal de acumulación de décimo tercero/cuarto para un año dado.
function _periodoDecimo(tipo, anio, regimenDecimoCuarto) {
  if (tipo === 'DECIMO_TERCERO') {
    return { desde: new Date(anio - 1, 11, 1), hasta: new Date(anio, 10, 30, 23, 59, 59, 999) };
  }
  if (tipo === 'DECIMO_CUARTO') {
    if (regimenDecimoCuarto === 'costa') {
      return { desde: new Date(anio - 1, 2, 1), hasta: new Date(anio, 1, 28, 23, 59, 59, 999) };
    }
    return { desde: new Date(anio - 1, 7, 1), hasta: new Date(anio, 6, 31, 23, 59, 59, 999) };
  }
  throw new Error('Tipo de décimo inválido');
}

// Año de la corrida DECIMO_TERCERO/DECIMO_CUARTO (ver _periodoDecimo) dentro
// del cual cae una fecha dada — para saber a qué período legal pertenece.
function _anioPeriodoDecimo(tipo, fecha, regimenDecimoCuarto) {
  if (tipo === 'DECIMO_TERCERO') {
    return fecha.getMonth() === 11 ? fecha.getFullYear() + 1 : fecha.getFullYear();
  }
  const mesInicio = regimenDecimoCuarto === 'costa' ? 2 : 7; // Mar=2, Ago=7 (0-indexado)
  return fecha.getMonth() >= mesInicio ? fecha.getFullYear() + 1 : fecha.getFullYear();
}

// Fecha de inicio del período pendiente de un decimo para un empleado: el mes
// siguiente al fin del último período ya PAGADO, o el inicio legal estándar
// si nunca se le ha pagado (p.ej. empleado nuevo).
async function _inicioPendienteDecimo({ empresaId, empleadoId, tipo, fechaIngreso, fallbackDesde }) {
  const ultimo = await prisma.nomina_pagos_especiales.findFirst({
    where: { empresaId, tipo, estado: 'PAGADA', detalles: { some: { empleadoId } } },
    orderBy: { periodoHasta: 'desc' },
  });
  if (ultimo) return new Date(ultimo.periodoHasta.getFullYear(), ultimo.periodoHasta.getMonth() + 1, 1);
  return fechaIngreso > fallbackDesde ? fechaIngreso : fallbackDesde;
}

function _diasEntre(desde, hasta) {
  return Math.max(0, Math.round((new Date(hasta) - new Date(desde)) / (1000 * 60 * 60 * 24)) + 1);
}

// Duración en convención laboral ecuatoriana (meses de 30 días, año de 360).
function _dias360(desde, hasta) {
  const d1 = new Date(desde);
  const d2 = new Date(hasta);
  const dias = (d2.getFullYear() - d1.getFullYear()) * 360
    + (d2.getMonth() - d1.getMonth()) * 30
    + (Math.min(d2.getDate(), 30) - Math.min(d1.getDate(), 30));
  return Math.max(0, dias);
}

// ============================================================
// DEPARTAMENTOS
// ============================================================

router.get('/departamentos', ...verRRHH, async (req, res) => {
  try {
    const { q, activo } = req.query;
    const where = {
      empresaId: req.empresa.id,
      ...(activo !== undefined ? { activo: activo === 'true' } : {}),
      ...(q ? { nombre: { contains: q, mode: 'insensitive' } } : {}),
    };
    const data = await prisma.departamentos.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: { _count: { select: { empleados: true } } },
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('Error departamentos:', err);
    res.status(500).json({ success: false, mensaje: 'Error al listar departamentos' });
  }
});

router.post('/departamentos', ...gestionarRRHH, async (req, res) => {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const dep = await prisma.departamentos.create({
      data: { empresaId: req.empresa.id, nombre: nombre.trim(), descripcion: descripcion?.trim() || null },
    });
    res.status(201).json({ success: true, data: dep });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un departamento con ese nombre' });
    res.status(500).json({ success: false, mensaje: 'Error al crear departamento' });
  }
});

router.put('/departamentos/:id', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, descripcion, activo } = req.body;
    const dep = await prisma.departamentos.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!dep) return res.status(404).json({ success: false, mensaje: 'Departamento no encontrado' });
    const updated = await prisma.departamentos.update({
      where: { id },
      data: {
        ...(nombre !== undefined ? { nombre: nombre.trim() } : {}),
        ...(descripcion !== undefined ? { descripcion: descripcion?.trim() || null } : {}),
        ...(activo !== undefined ? { activo } : {}),
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un departamento con ese nombre' });
    res.status(500).json({ success: false, mensaje: 'Error al actualizar departamento' });
  }
});

router.delete('/departamentos/:id', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const dep = await prisma.departamentos.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!dep) return res.status(404).json({ success: false, mensaje: 'Departamento no encontrado' });
    const empleados = await prisma.empleados.count({ where: { departamentoId: id, activo: true } });
    if (empleados > 0) return res.status(400).json({ success: false, mensaje: 'No se puede eliminar: tiene empleados activos asignados' });
    await prisma.departamentos.update({ where: { id }, data: { activo: false } });
    res.json({ success: true, mensaje: 'Departamento desactivado' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al eliminar departamento' });
  }
});

// ============================================================
// CARGOS
// ============================================================

router.get('/cargos', ...verRRHH, async (req, res) => {
  try {
    const { q, departamentoId, activo } = req.query;
    const where = {
      empresaId: req.empresa.id,
      ...(activo !== undefined ? { activo: activo === 'true' } : {}),
      ...(departamentoId ? { departamentoId: parseInt(departamentoId) } : {}),
      ...(q ? { nombre: { contains: q, mode: 'insensitive' } } : {}),
    };
    const data = await prisma.cargos.findMany({
      where,
      orderBy: { nombre: 'asc' },
      include: {
        departamento: { select: { id: true, nombre: true } },
        _count: { select: { empleados: true } },
      },
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al listar cargos' });
  }
});

router.post('/cargos', ...gestionarRRHH, async (req, res) => {
  try {
    const { nombre, descripcion, departamentoId } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre es requerido' });
    const cargo = await prisma.cargos.create({
      data: {
        empresaId: req.empresa.id,
        nombre: nombre.trim(),
        descripcion: descripcion?.trim() || null,
        departamentoId: departamentoId ? parseInt(departamentoId) : null,
      },
      include: { departamento: { select: { id: true, nombre: true } } },
    });
    res.status(201).json({ success: true, data: cargo });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un cargo con ese nombre' });
    res.status(500).json({ success: false, mensaje: 'Error al crear cargo' });
  }
});

router.put('/cargos/:id', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { nombre, descripcion, departamentoId, activo } = req.body;
    const cargo = await prisma.cargos.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!cargo) return res.status(404).json({ success: false, mensaje: 'Cargo no encontrado' });
    const updated = await prisma.cargos.update({
      where: { id },
      data: {
        ...(nombre !== undefined ? { nombre: nombre.trim() } : {}),
        ...(descripcion !== undefined ? { descripcion: descripcion?.trim() || null } : {}),
        ...(departamentoId !== undefined ? { departamentoId: departamentoId ? parseInt(departamentoId) : null } : {}),
        ...(activo !== undefined ? { activo } : {}),
      },
      include: { departamento: { select: { id: true, nombre: true } } },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un cargo con ese nombre' });
    res.status(500).json({ success: false, mensaje: 'Error al actualizar cargo' });
  }
});

// ============================================================
// EMPLEADOS
// ============================================================

router.get('/empleados', ...verRRHH, async (req, res) => {
  try {
    const { q, departamentoId, activo = 'true', page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {
      empresaId: req.empresa.id,
      ...(activo !== undefined ? { activo: activo === 'true' } : {}),
      ...(departamentoId ? { departamentoId: parseInt(departamentoId) } : {}),
      ...(q ? {
        OR: [
          { cedula:    { contains: q, mode: 'insensitive' } },
          { nombres:   { contains: q, mode: 'insensitive' } },
          { apellidos: { contains: q, mode: 'insensitive' } },
          { email:     { contains: q, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.empleados.findMany({
        where, skip, take: parseInt(limit),
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
        include: {
          departamento: { select: { id: true, nombre: true } },
          cargo:        { select: { id: true, nombre: true } },
        },
      }),
      prisma.empleados.count({ where }),
    ]);
    res.json({ success: true, data, total });
  } catch (err) {
    console.error('Error empleados:', err);
    res.status(500).json({ success: false, mensaje: 'Error al listar empleados' });
  }
});

router.get('/empleados/:id', ...verRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const emp = await prisma.empleados.findFirst({
      where: { id, empresaId: req.empresa.id },
      include: {
        departamento: { select: { id: true, nombre: true } },
        cargo:        { select: { id: true, nombre: true } },
        contratos:    { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!emp) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });
    res.json({ success: true, data: emp });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener empleado' });
  }
});

router.post('/empleados', ...gestionarRRHH, async (req, res) => {
  try {
    const {
      cedula, nombres, apellidos, email, telefono, direccion,
      fechaNacimiento, sexo, estadoCivil,
      tipoContrato, fechaIngreso, salarioBase,
      departamentoId, cargoId,
      afiliadoIESS, codigoIESS, tieneRenta, fondosReserva, cargasFamiliares,
      observaciones,
    } = req.body;

    if (!cedula?.trim()) return res.status(400).json({ success: false, mensaje: 'La cédula es requerida' });
    if (!nombres?.trim()) return res.status(400).json({ success: false, mensaje: 'Los nombres son requeridos' });
    if (!apellidos?.trim()) return res.status(400).json({ success: false, mensaje: 'Los apellidos son requeridos' });
    if (!fechaIngreso) return res.status(400).json({ success: false, mensaje: 'La fecha de ingreso es requerida' });
    if (!salarioBase || isNaN(parseFloat(salarioBase))) return res.status(400).json({ success: false, mensaje: 'El salario base es requerido' });

    const emp = await prisma.empleados.create({
      data: {
        empresaId:     req.empresa.id,
        cedula:        cedula.trim(),
        nombres:       nombres.trim(),
        apellidos:     apellidos.trim(),
        email:         email?.trim() || null,
        telefono:      telefono?.trim() || null,
        direccion:     direccion?.trim() || null,
        fechaNacimiento: fechaNacimiento ? new Date(fechaNacimiento) : null,
        sexo:          sexo || null,
        estadoCivil:   estadoCivil || null,
        tipoContrato:  tipoContrato || 'indefinido',
        fechaIngreso:  new Date(fechaIngreso),
        salarioBase:   parseFloat(salarioBase),
        departamentoId: departamentoId ? parseInt(departamentoId) : null,
        cargoId:        cargoId ? parseInt(cargoId) : null,
        afiliadoIESS:  afiliadoIESS !== undefined ? Boolean(afiliadoIESS) : true,
        codigoIESS:    codigoIESS?.trim() || null,
        tieneRenta:    tieneRenta !== undefined ? Boolean(tieneRenta) : false,
        fondosReserva: fondosReserva !== undefined ? Boolean(fondosReserva) : false,
        cargasFamiliares: cargasFamiliares !== undefined ? parseInt(cargasFamiliares) || 0 : 0,
        observaciones: observaciones?.trim() || null,
        ..._camposRdep(req.body),
      },
      include: {
        departamento: { select: { id: true, nombre: true } },
        cargo:        { select: { id: true, nombre: true } },
      },
    });
    res.status(201).json({ success: true, data: emp });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un empleado con esa cédula' });
    console.error('Error crear empleado:', err);
    res.status(500).json({ success: false, mensaje: 'Error al crear empleado' });
  }
});

router.put('/empleados/:id', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const emp = await prisma.empleados.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!emp) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });

    const campos = [
      'cedula','nombres','apellidos','email','telefono','direccion',
      'sexo','estadoCivil','tipoContrato','salarioBase',
      'departamentoId','cargoId',
      'afiliadoIESS','codigoIESS','tieneRenta','fondosReserva','cargasFamiliares',
      'activo','observaciones','motivoSalida',
    ];
    const data = {};
    for (const c of campos) {
      if (req.body[c] !== undefined) {
        if (c === 'salarioBase') data[c] = parseFloat(req.body[c]);
        else if (c === 'departamentoId' || c === 'cargoId') data[c] = req.body[c] ? parseInt(req.body[c]) : null;
        else if (c === 'cargasFamiliares') data[c] = parseInt(req.body[c]) || 0;
        else if (['afiliadoIESS','tieneRenta','fondosReserva','activo'].includes(c)) data[c] = Boolean(req.body[c]);
        else data[c] = req.body[c]?.trim ? req.body[c].trim() || null : req.body[c];
      }
    }
    if (req.body.fechaNacimiento !== undefined) data.fechaNacimiento = req.body.fechaNacimiento ? new Date(req.body.fechaNacimiento) : null;
    if (req.body.fechaIngreso !== undefined)    data.fechaIngreso    = new Date(req.body.fechaIngreso);
    if (req.body.fechaSalida !== undefined)     data.fechaSalida     = req.body.fechaSalida ? new Date(req.body.fechaSalida) : null;

    // Campos del Anexo RDEP — solo se tocan si el request trae al menos uno
    // (evita resetear a los valores por defecto en un PUT parcial que no
    // toca discapacidad/residencia/gastos personales).
    const CAMPOS_RDEP = [
      'beneficiarioGalapagos', 'enfermedadCatastrofica', 'condicionDiscapacidad',
      'porcentajeDiscapacidad', 'tipoIdDependienteDiscap', 'idDependienteDiscap',
      'residenciaFiscal', 'paisResidencia', 'aplicaConvenioDobleImposicion',
      'gastosPersonalesProyectados',
    ];
    if (CAMPOS_RDEP.some((c) => req.body[c] !== undefined)) {
      Object.assign(data, _camposRdep({ ...emp, ...req.body }));
    }

    const updated = await prisma.empleados.update({
      where: { id },
      data,
      include: {
        departamento: { select: { id: true, nombre: true } },
        cargo:        { select: { id: true, nombre: true } },
      },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ success: false, mensaje: 'Ya existe un empleado con esa cédula' });
    res.status(500).json({ success: false, mensaje: 'Error al actualizar empleado' });
  }
});

// ============================================================
// NÓMINA
// ============================================================

router.get('/nomina', ...verRRHH, async (req, res) => {
  try {
    const { anio } = req.query;
    const where = {
      empresaId: req.empresa.id,
      ...(anio ? { anio: parseInt(anio) } : {}),
    };
    const data = await prisma.nominas.findMany({
      where,
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
      include: { _count: { select: { detalles: true } } },
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al listar nóminas' });
  }
});

// Nota de orden de rutas: debe registrarse ANTES de '/nomina/:id' — si no,
// Express hace match de '/nomina/especiales' contra ':id' (con id="especiales")
// y nunca llega a este handler.
router.get('/nomina/especiales', ...verRRHH, async (req, res) => {
  try {
    const { tipo, anio } = req.query;
    const where = {
      empresaId: req.empresa.id,
      ...(tipo ? { tipo } : {}),
      ...(anio ? { anio: parseInt(anio) } : {}),
    };
    const data = await prisma.nomina_pagos_especiales.findMany({
      where,
      orderBy: [{ anio: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { detalles: true } } },
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al listar pagos especiales' });
  }
});

router.get('/nomina/:id', ...verRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nomina = await prisma.nominas.findFirst({
      where: { id, empresaId: req.empresa.id },
      include: {
        detalles: {
          include: {
            empleado: {
              select: { id: true, cedula: true, nombres: true, apellidos: true,
                departamento: { select: { nombre: true } },
                cargo: { select: { nombre: true } } },
            },
          },
          orderBy: [{ empleado: { apellidos: 'asc' } }],
        },
      },
    });
    if (!nomina) return res.status(404).json({ success: false, mensaje: 'Nómina no encontrada' });
    res.json({ success: true, data: nomina });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener nómina' });
  }
});

// Crear nómina y calcular automáticamente para todos los empleados activos
router.post('/nomina', ...nominaRRHH, async (req, res) => {
  try {
    const { mes, anio, observaciones } = req.body;
    if (!mes || !anio) return res.status(400).json({ success: false, mensaje: 'Mes y año son requeridos' });

    const mesInt  = parseInt(mes);
    const anioInt = parseInt(anio);

    const existe = await prisma.nominas.findFirst({
      where: { empresaId: req.empresa.id, mes: mesInt, anio: anioInt },
    });
    if (existe) return res.status(400).json({ success: false, mensaje: `Ya existe una nómina para ${mesInt}/${anioInt}` });

    // Obtener SBU desde configuración del sistema (fallback a constante si no existe)
    const config = await prisma.configuracion_sistema.findUnique({ where: { empresaId: req.empresa.id } });
    const sbu = config ? parseFloat(config.sbuEcuador) : SBU_ECUADOR;

    const empleados = await prisma.empleados.findMany({
      where: { empresaId: req.empresa.id, activo: true },
    });
    if (empleados.length === 0) return res.status(400).json({ success: false, mensaje: 'No hay empleados activos para procesar' });

    const diasDelMes = new Date(anioInt, mesInt, 0).getDate(); // eslint-disable-line no-unused-vars
    const detalles = empleados.map((emp) => {
      const salario = parseFloat(emp.salarioBase);

      const aportePersonal = emp.afiliadoIESS ? +(salario * APORTE_PERSONAL_IESS).toFixed(2) : 0;
      const aportePatronal = emp.afiliadoIESS ? +(salario * APORTE_PATRONAL_IESS).toFixed(2) : 0;

      // Proporcionales de beneficios de ley — se acumulan mes a mes en las
      // cuentas de provisión (ver crearAsientoNominaPeriodo) y se liquidan
      // realmente vía POST /nomina/especiales (décimo 3º/4º) o
      // /ausencias/:id/pagar (vacaciones); no se descuentan del sueldo mensual.
      const decimoTerceroProp = +(salario / 12).toFixed(2);
      const decimoCuartoProp  = +(sbu / 12).toFixed(2);
      const fondosReservaProp = emp.fondosReserva ? +(salario / 12).toFixed(2) : 0;
      // Vacaciones: 15 días/año ÷ 12 meses = 1.25 días/mes; valor = salario/30 × 1.25
      const vacacionesProp    = +(salario / 24).toFixed(2);

      // Impuesto a la Renta calculado con tabla LORTI
      const { irMensual } = calcularImpuestoRentaMensual({
        salarioMensual: salario,
        sbu,
        afiliadoIESS: Boolean(emp.afiliadoIESS),
        gastosPersonalesProyectados: parseFloat(emp.gastosPersonalesProyectados) || 0,
        cargasFamiliares: emp.cargasFamiliares || 0,
        tieneDiscapacidadOEnfermedadCatastrofica: _tieneDiscapacidadOEnfermedad(emp),
      });

      const totalDescuentos = +(aportePersonal + irMensual).toFixed(2);
      const totalIngresos   = +salario.toFixed(2);
      const netoApagar      = +(totalIngresos - totalDescuentos).toFixed(2);

      return {
        empleadoId:            emp.id,
        salarioBase:           salario,
        horasExtraSuplemento:  0,
        horasExtraExtraordinario: 0,
        valorHorasExtraSuplemento:     0,
        valorHorasExtraExtraordinario: 0,
        otrosIngresos:         0,
        decimoTerceroProp,
        decimoCuartoProp,
        fondosReservaProp,
        vacacionesProp,
        aportePersonalIESS:    aportePersonal,
        impuestoRenta:         irMensual,
        prestamosIESS:         0,
        anticipos:             0,
        otrosDescuentos:       0,
        aportePatronal,
        totalIngresos,
        totalDescuentos,
        netoApagar,
      };
    });

    const totalBruto       = +detalles.reduce((s, d) => s + d.totalIngresos, 0).toFixed(2);
    const totalDescuentos2 = +detalles.reduce((s, d) => s + d.totalDescuentos, 0).toFixed(2);
    const totalNeto        = +detalles.reduce((s, d) => s + d.netoApagar, 0).toFixed(2);

    const nomina = await prisma.nominas.create({
      data: {
        empresaId:    req.empresa.id,
        mes:          mesInt,
        anio:         anioInt,
        estado:       'BORRADOR',
        observaciones: observaciones?.trim() || null,
        totalBruto,
        totalDescuentos: totalDescuentos2,
        totalNeto,
        creadoPor:    req.usuario.id,
        detalles:     { createMany: { data: detalles } },
      },
      include: { _count: { select: { detalles: true } } },
    });
    res.status(201).json({ success: true, data: nomina });
  } catch (err) {
    console.error('Error crear nómina:', err);
    res.status(500).json({ success: false, mensaje: 'Error al crear nómina' });
  }
});

// Actualizar detalle individual (horas extras, otros ingresos, descuentos manuales)
router.put('/nomina/:nominaId/detalle/:empleadoId', ...nominaRRHH, async (req, res) => {
  try {
    const nominaId  = parseInt(req.params.nominaId);
    const empleadoId = parseInt(req.params.empleadoId);

    const nomina = await prisma.nominas.findFirst({ where: { id: nominaId, empresaId: req.empresa.id } });
    if (!nomina) return res.status(404).json({ success: false, mensaje: 'Nómina no encontrada' });
    if (nomina.estado === 'PAGADA') return res.status(400).json({ success: false, mensaje: 'No se puede editar una nómina pagada' });

    const detalle = await prisma.nomina_detalles.findFirst({ where: { nominaId, empleadoId } });
    if (!detalle) return res.status(404).json({ success: false, mensaje: 'Detalle no encontrado' });

    const {
      horasExtraSuplemento = 0,
      horasExtraExtraordinario = 0,
      otrosIngresos = 0,
      otrosIngresosDetalle,
      impuestoRenta,           // si viene en el body = override manual
      irManual = false,        // true = usar impuestoRenta del body tal cual
      prestamosIESS = 0,
      anticipos = 0,
      otrosDescuentos = 0,
      otrosDescuentosDetalle,
      observaciones,
    } = req.body;

    const salario = parseFloat(detalle.salarioBase);
    const valorHora = salario / 240;
    const valHS  = +(parseFloat(horasExtraSuplemento)   * valorHora * 1.25).toFixed(2);
    const valHE  = +(parseFloat(horasExtraExtraordinario) * valorHora * 1.50).toFixed(2);
    const otrosIng = parseFloat(otrosIngresos) || 0;

    // Si no es override manual, recalcular IR con tabla LORTI
    let irFinal;
    if (irManual && impuestoRenta !== undefined) {
      irFinal = parseFloat(impuestoRenta) || 0;
    } else {
      const configIR = await prisma.configuracion_sistema.findUnique({ where: { empresaId: req.empresa.id } });
      const sbuIR = configIR ? parseFloat(configIR.sbuEcuador) : SBU_ECUADOR;
      const emp = await prisma.empleados.findUnique({ where: { id: empleadoId } });
      const { irMensual } = calcularImpuestoRentaMensual({
        salarioMensual: salario,
        sbu: sbuIR,
        horasExtraMes: valHS + valHE,
        otrosIngresosMes: otrosIng,
        afiliadoIESS: Boolean(emp?.afiliadoIESS),
        gastosPersonalesProyectados: parseFloat(emp?.gastosPersonalesProyectados) || 0,
        cargasFamiliares: emp?.cargasFamiliares || 0,
        tieneDiscapacidadOEnfermedadCatastrofica: _tieneDiscapacidadOEnfermedad(emp),
      });
      irFinal = irMensual;
    }

    const totalIngresos  = +(salario + valHS + valHE + otrosIng).toFixed(2);
    const totalDescuentos = +(
      parseFloat(detalle.aportePersonalIESS) +
      irFinal +
      parseFloat(prestamosIESS) +
      parseFloat(anticipos) +
      parseFloat(otrosDescuentos)
    ).toFixed(2);
    const netoApagar = +(totalIngresos - totalDescuentos).toFixed(2);

    const updated = await prisma.nomina_detalles.update({
      where: { id: detalle.id },
      data: {
        horasExtraSuplemento:  parseFloat(horasExtraSuplemento),
        horasExtraExtraordinario: parseFloat(horasExtraExtraordinario),
        valorHorasExtraSuplemento: valHS,
        valorHorasExtraExtraordinario: valHE,
        otrosIngresos: otrosIng,
        otrosIngresosDetalle: otrosIngresosDetalle?.trim() || null,
        impuestoRenta: irFinal,
        prestamosIESS: parseFloat(prestamosIESS),
        anticipos:     parseFloat(anticipos),
        otrosDescuentos: parseFloat(otrosDescuentos),
        otrosDescuentosDetalle: otrosDescuentosDetalle?.trim() || null,
        totalIngresos,
        totalDescuentos,
        netoApagar,
        observaciones: observaciones?.trim() || null,
      },
    });

    // Recalcular totales de la nómina completa
    const detalles = await prisma.nomina_detalles.findMany({ where: { nominaId } });
    const totalBruto2       = +detalles.reduce((s, d) => s + parseFloat(d.totalIngresos), 0).toFixed(2);
    const totalDescuentos2b = +detalles.reduce((s, d) => s + parseFloat(d.totalDescuentos), 0).toFixed(2);
    const totalNeto2        = +detalles.reduce((s, d) => s + parseFloat(d.netoApagar), 0).toFixed(2);
    await prisma.nominas.update({
      where: { id: nominaId },
      data: { totalBruto: totalBruto2, totalDescuentos: totalDescuentos2b, totalNeto: totalNeto2 },
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('Error actualizar detalle nómina:', err);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar detalle de nómina' });
  }
});

// Calcular IR proyectado para un empleado (preview antes de editar)
router.get('/nomina/calcular-ir/:empleadoId', ...nominaRRHH, async (req, res) => {
  try {
    const empleadoId = parseInt(req.params.empleadoId);
    const emp = await prisma.empleados.findFirst({ where: { id: empleadoId, empresaId: req.empresa.id } });
    if (!emp) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });

    const config = await prisma.configuracion_sistema.findUnique({ where: { empresaId: req.empresa.id } });
    const sbu = config ? parseFloat(config.sbuEcuador) : SBU_ECUADOR;

    const { horasExtraMes = 0, otrosIngresosMes = 0 } = req.query;
    const resultado = calcularImpuestoRentaMensual({
      salarioMensual: parseFloat(emp.salarioBase),
      sbu,
      horasExtraMes: parseFloat(horasExtraMes) || 0,
      otrosIngresosMes: parseFloat(otrosIngresosMes) || 0,
      afiliadoIESS: Boolean(emp.afiliadoIESS),
      gastosPersonalesProyectados: parseFloat(emp.gastosPersonalesProyectados) || 0,
      cargasFamiliares: emp.cargasFamiliares || 0,
      tieneDiscapacidadOEnfermedadCatastrofica: _tieneDiscapacidadOEnfermedad(emp),
    });

    res.json({
      success: true,
      data: {
        ...resultado,
        tablaAnio: 2026,
        empleado: `${emp.nombres} ${emp.apellidos}`,
        salarioBase: parseFloat(emp.salarioBase),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al calcular IR' });
  }
});

// Cambiar estado de la nómina (BORRADOR → PROCESADA → PAGADA)
router.patch('/nomina/:id/estado', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { estado } = req.body;
    const estados = ['BORRADOR', 'PROCESADA', 'PAGADA'];
    if (!estados.includes(estado)) return res.status(400).json({ success: false, mensaje: 'Estado inválido' });
    const nomina = await prisma.nominas.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!nomina) return res.status(404).json({ success: false, mensaje: 'Nómina no encontrada' });
    const updated = await prisma.nominas.update({ where: { id }, data: { estado } });

    const periodo = `${String(nomina.mes).padStart(2, '0')}/${nomina.anio}`;
    const finDeMesPeriodo = new Date(nomina.anio, nomina.mes, 0);
    let asientoOk = null;
    let asientoError = null;
    try {
      if (estado === 'PROCESADA') {
        const r = await crearAsientoNominaPeriodo({ empresaId: req.empresa.id, periodo, usuarioId: req.usuario?.id, fecha: finDeMesPeriodo });
        asientoOk = !!r.asiento;
      } else if (estado === 'PAGADA') {
        const r = await crearAsientoPagoNominaPeriodo({ empresaId: req.empresa.id, periodo, usuarioId: req.usuario?.id });
        asientoOk = !!r.asiento;
      }
    } catch (contErr) {
      console.error(`[Nómina] Asiento contable nómina ${id} (${estado}):`, contErr.message);
      asientoError = contErr.message;
    }

    res.json({ success: true, data: updated, asientoOk, asientoError });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al cambiar estado de nómina' });
  }
});

router.delete('/nomina/:id', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nomina = await prisma.nominas.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!nomina) return res.status(404).json({ success: false, mensaje: 'Nómina no encontrada' });
    if (nomina.estado === 'PAGADA') return res.status(400).json({ success: false, mensaje: 'No se puede eliminar una nómina pagada' });
    await prisma.nominas.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Nómina eliminada' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al eliminar nómina' });
  }
});

// ============================================================
// NÓMINA — PAGOS ESPECIALES
// Décimo tercero, décimo cuarto, utilidades 15% y liquidación de haberes.
// ============================================================

router.get('/nomina/especiales/:id', ...verRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pago = await prisma.nomina_pagos_especiales.findFirst({
      where: { id, empresaId: req.empresa.id },
      include: {
        detalles: {
          include: { empleado: { select: { id: true, cedula: true, nombres: true, apellidos: true } } },
          orderBy: [{ empleado: { apellidos: 'asc' } }],
        },
      },
    });
    if (!pago) return res.status(404).json({ success: false, mensaje: 'Pago especial no encontrado' });
    res.json({ success: true, data: pago });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener pago especial' });
  }
});

// Generar corrida de pago de décimo tercero o décimo cuarto — suma la
// provisión mensual ya acumulada (decimoTerceroProp/decimoCuartoProp) en el
// período legal de acumulación del año indicado.
router.post('/nomina/especiales/generar-decimo', ...nominaRRHH, async (req, res) => {
  try {
    const { tipo, anio } = req.body;
    if (!['DECIMO_TERCERO', 'DECIMO_CUARTO'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo inválido (use DECIMO_TERCERO o DECIMO_CUARTO)' });
    }
    const anioInt = parseInt(anio);
    if (!anioInt) return res.status(400).json({ success: false, mensaje: 'El año es requerido' });

    const yaExiste = await prisma.nomina_pagos_especiales.findFirst({
      where: { empresaId: req.empresa.id, tipo, anio: anioInt },
    });
    if (yaExiste) {
      const etiqueta = tipo === 'DECIMO_TERCERO' ? 'décimo tercero' : 'décimo cuarto';
      return res.status(400).json({ success: false, mensaje: `Ya existe una corrida de ${etiqueta} para ${anioInt}` });
    }

    const config = await prisma.configuracion_sistema.findUnique({ where: { empresaId: req.empresa.id } });
    const regimen = config?.regimenDecimoCuarto || 'sierra';
    const { desde, hasta } = _periodoDecimo(tipo, anioInt, regimen);

    const campo = tipo === 'DECIMO_TERCERO' ? 'decimoTerceroProp' : 'decimoCuartoProp';
    const metas = _mesesEnRango(desde, hasta);
    const nominasPeriodo = await prisma.nominas.findMany({ where: { empresaId: req.empresa.id, OR: metas }, select: { id: true } });
    const detallesNomina = await prisma.nomina_detalles.findMany({
      where: { nominaId: { in: nominasPeriodo.map((n) => n.id) } },
    });

    const porEmpleado = new Map();
    for (const d of detallesNomina) {
      const val = parseFloat(d[campo] || 0);
      if (val <= 0) continue;
      porEmpleado.set(d.empleadoId, round2((porEmpleado.get(d.empleadoId) || 0) + val));
    }

    if (porEmpleado.size === 0) {
      const etiqueta = tipo === 'DECIMO_TERCERO' ? 'décimo tercero' : 'décimo cuarto';
      return res.status(400).json({ success: false, mensaje: `No hay provisión acumulada de ${etiqueta} en el período ${desde.toISOString().slice(0, 10)} a ${hasta.toISOString().slice(0, 10)} — procese primero las nóminas mensuales de ese rango` });
    }

    const detalles = [...porEmpleado.entries()].map(([empleadoId, valor]) => ({
      empleadoId, baseCalculo: valor, valor,
    }));
    const totalPagado = round2(detalles.reduce((s, d) => s + d.valor, 0));

    const pago = await prisma.nomina_pagos_especiales.create({
      data: {
        empresaId: req.empresa.id, tipo, anio: anioInt,
        periodoDesde: desde, periodoHasta: hasta,
        estado: 'BORRADOR', totalPagado,
        creadoPor: req.usuario.id,
        detalles: { createMany: { data: detalles } },
      },
      include: { _count: { select: { detalles: true } } },
    });
    res.status(201).json({ success: true, data: pago });
  } catch (err) {
    console.error('Error generar décimo:', err);
    res.status(500).json({ success: false, mensaje: 'Error al generar la corrida de décimo' });
  }
});

// Generar reparto de utilidades 15% — requiere que el ejercicio ya esté
// cerrado en Contabilidad (asiento CIERRE_ANUAL) para conocer la utilidad neta.
// 10% se reparte proporcional a días trabajados en el año, 5% proporcional a
// cargas familiares (o también por días si ningún empleado tiene registradas).
router.post('/nomina/especiales/generar-utilidades', ...nominaRRHH, async (req, res) => {
  try {
    const anioInt = parseInt(req.body.anio);
    if (!anioInt) return res.status(400).json({ success: false, mensaje: 'El año es requerido' });

    const yaExiste = await prisma.nomina_pagos_especiales.findFirst({
      where: { empresaId: req.empresa.id, tipo: 'UTILIDADES', anio: anioInt },
    });
    if (yaExiste) return res.status(400).json({ success: false, mensaje: `Ya existe un reparto de utilidades para ${anioInt}` });

    const inicioAnio = new Date(anioInt, 0, 1);
    const finAnio = new Date(anioInt, 11, 31, 23, 59, 59, 999);

    const cierre = await prisma.asientos_contables.findFirst({
      where: { empresaId: req.empresa.id, tipo: 'CIERRE_ANUAL', fecha: { gte: inicioAnio, lte: finAnio } },
      include: { detalles: { include: { cuenta: true } } },
    });
    if (!cierre) return res.status(400).json({ success: false, mensaje: `Primero debe cerrarse el ejercicio ${anioInt} en Contabilidad (Cierre y Estados) antes de repartir utilidades` });

    const lineaResultado = cierre.detalles.find((d) => /utilidad|resultado/i.test(d.cuenta.nombre));
    const utilidadNeta = lineaResultado ? round2(parseFloat(lineaResultado.haber) - parseFloat(lineaResultado.debe)) : 0;
    if (utilidadNeta <= 0) {
      return res.status(400).json({ success: false, mensaje: `El ejercicio ${anioInt} no registró utilidad neta positiva — no corresponde reparto a trabajadores` });
    }

    const parte10 = round2(utilidadNeta * 0.10);
    const parte5 = round2(utilidadNeta * 0.05);

    const empleados = await prisma.empleados.findMany({
      where: {
        empresaId: req.empresa.id,
        fechaIngreso: { lte: finAnio },
        OR: [{ fechaSalida: null }, { fechaSalida: { gte: inicioAnio } }],
      },
    });
    if (empleados.length === 0) return res.status(400).json({ success: false, mensaje: 'No hay empleados que hayan trabajado durante ese año' });

    const conDias = empleados.map((emp) => {
      const ini = emp.fechaIngreso > inicioAnio ? emp.fechaIngreso : inicioAnio;
      const fin = emp.fechaSalida && emp.fechaSalida < finAnio ? emp.fechaSalida : finAnio;
      return { emp, dias: _diasEntre(ini, fin) };
    });
    const totalDias = conDias.reduce((s, c) => s + c.dias, 0);
    const totalCargas = empleados.reduce((s, e) => s + (e.cargasFamiliares || 0), 0);

    const detalles = conDias.map(({ emp, dias }) => {
      const porDias = totalDias > 0 ? round2(parte10 * dias / totalDias) : 0;
      const porCargas = totalCargas > 0
        ? round2(parte5 * (emp.cargasFamiliares || 0) / totalCargas)
        : (totalDias > 0 ? round2(parte5 * dias / totalDias) : 0);
      return {
        empleadoId: emp.id,
        baseCalculo: utilidadNeta,
        diasBase: dias,
        valor: round2(porDias + porCargas),
        detalleJson: JSON.stringify({ parte10Dias: porDias, parte5Cargas: porCargas, cargasFamiliares: emp.cargasFamiliares || 0 }),
      };
    }).filter((d) => d.valor > 0);

    const totalPagado = round2(detalles.reduce((s, d) => s + d.valor, 0));
    const notaCargas = totalCargas === 0 ? ', repartido por días al no existir cargas familiares registradas' : '';

    const pago = await prisma.nomina_pagos_especiales.create({
      data: {
        empresaId: req.empresa.id, tipo: 'UTILIDADES', anio: anioInt,
        periodoDesde: inicioAnio, periodoHasta: finAnio,
        estado: 'BORRADOR', totalPagado,
        observaciones: `Utilidad neta ${anioInt}: $${utilidadNeta.toFixed(2)} — 15% = $${round2(utilidadNeta * 0.15).toFixed(2)} (10% por días trabajados + 5% por cargas familiares${notaCargas})`,
        creadoPor: req.usuario.id,
        detalles: { createMany: { data: detalles } },
      },
      include: { _count: { select: { detalles: true } } },
    });
    res.status(201).json({ success: true, data: pago });
  } catch (err) {
    console.error('Error generar utilidades:', err);
    res.status(500).json({ success: false, mensaje: 'Error al generar el reparto de utilidades' });
  }
});

// Registrar el pago de una corrida ya generada (décimo tercero/cuarto,
// utilidades o liquidación) — genera el asiento contable y la marca PAGADA.
router.patch('/nomina/especiales/:id/pagar', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pago = await prisma.nomina_pagos_especiales.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!pago) return res.status(404).json({ success: false, mensaje: 'Pago especial no encontrado' });
    if (pago.estado === 'PAGADA') return res.status(400).json({ success: false, mensaje: 'Este pago ya fue registrado como pagado' });

    const { asiento } = await crearAsientoPagoEspecialNomina({ empresaId: req.empresa.id, pagoEspecialId: id, usuarioId: req.usuario.id });
    const updated = await prisma.nomina_pagos_especiales.update({ where: { id }, data: { estado: 'PAGADA', fechaPago: new Date() } });
    res.json({ success: true, data: updated, asientoOk: !!asiento });
  } catch (err) {
    console.error('Error pagar especial:', err);
    res.status(400).json({ success: false, mensaje: err.message || 'Error al registrar el pago' });
  }
});

router.delete('/nomina/especiales/:id', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const pago = await prisma.nomina_pagos_especiales.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!pago) return res.status(404).json({ success: false, mensaje: 'Pago especial no encontrado' });
    if (pago.estado === 'PAGADA') return res.status(400).json({ success: false, mensaje: 'No se puede eliminar un pago ya registrado' });
    await prisma.nomina_pagos_especiales.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Pago especial eliminado' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al eliminar pago especial' });
  }
});

// Liquidación de haberes al terminar la relación laboral — calcula sueldo
// pendiente, vacaciones no gozadas, décimo tercero/cuarto y fondos de reserva
// proporcionales pendientes, y (según motivo) bonificación por desahucio
// (Art. 185 Código de Trabajo) o indemnización por despido intempestivo
// (Art. 188). Estos dos últimos son estimaciones legales — quedan en BORRADOR
// para revisión del área legal/contable antes de pagarse.
router.post('/empleados/:id/liquidar', ...nominaRRHH, async (req, res) => {
  try {
    const empleadoId = parseInt(req.params.id);
    const { fechaSalida, motivoSalida } = req.body;
    if (!fechaSalida) return res.status(400).json({ success: false, mensaje: 'La fecha de salida es requerida' });
    if (!motivoSalida) return res.status(400).json({ success: false, mensaje: 'El motivo de salida es requerido' });

    const emp = await prisma.empleados.findFirst({ where: { id: empleadoId, empresaId: req.empresa.id } });
    if (!emp) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });

    const yaExiste = await prisma.nomina_pagos_especiales_detalle.findFirst({
      where: { empleadoId, pago: { empresaId: req.empresa.id, tipo: 'LIQUIDACION' } },
    });
    if (yaExiste) return res.status(400).json({ success: false, mensaje: 'Este empleado ya tiene una liquidación registrada' });

    const salida = new Date(fechaSalida);
    const salario = parseFloat(emp.salarioBase);
    const config = await prisma.configuracion_sistema.findUnique({ where: { empresaId: req.empresa.id } });
    const regimen = config?.regimenDecimoCuarto || 'sierra';

    // 1. Sueldo pendiente del mes en curso
    const diasMes = _diasEntre(new Date(salida.getFullYear(), salida.getMonth(), 1), salida);
    const sueldoPendiente = round2((salario / 30) * diasMes);

    // 2. Vacaciones no gozadas: devengadas (1.25 días/mes) menos ya tomadas
    const mesesTrabajados = _dias360(emp.fechaIngreso, salida) / 30;
    const diasVacacionesDevengados = round2(mesesTrabajados * 1.25);
    const ausenciasVacacion = await prisma.ausencias.aggregate({
      where: { empleadoId, tipo: 'vacacion', aprobado: true },
      _sum: { dias: true },
    });
    const diasVacacionesTomados = ausenciasVacacion._sum.dias || 0;
    const diasVacacionesPendientes = Math.max(0, round2(diasVacacionesDevengados - diasVacacionesTomados));
    const vacacionesPendientes = round2((salario / 30) * diasVacacionesPendientes);

    // 3. Décimo tercero / décimo cuarto proporcional pendiente (desde el fin
    //    del último período ya pagado hasta la fecha de salida)
    const { desde: inicioDecimo3Legal } = _periodoDecimo('DECIMO_TERCERO', _anioPeriodoDecimo('DECIMO_TERCERO', salida, regimen), regimen);
    const { desde: inicioDecimo4Legal } = _periodoDecimo('DECIMO_CUARTO', _anioPeriodoDecimo('DECIMO_CUARTO', salida, regimen), regimen);
    const inicioDecimo3 = await _inicioPendienteDecimo({ empresaId: req.empresa.id, empleadoId, tipo: 'DECIMO_TERCERO', fechaIngreso: emp.fechaIngreso, fallbackDesde: inicioDecimo3Legal < emp.fechaIngreso ? emp.fechaIngreso : inicioDecimo3Legal });
    const inicioDecimo4 = await _inicioPendienteDecimo({ empresaId: req.empresa.id, empleadoId, tipo: 'DECIMO_CUARTO', fechaIngreso: emp.fechaIngreso, fallbackDesde: inicioDecimo4Legal < emp.fechaIngreso ? emp.fechaIngreso : inicioDecimo4Legal });
    const decimoTerceroPendiente = await _sumarProporcionalPendiente({ empresaId: req.empresa.id, empleadoId, campo: 'decimoTerceroProp', desde: inicioDecimo3, hasta: salida });
    const decimoCuartoPendiente = await _sumarProporcionalPendiente({ empresaId: req.empresa.id, empleadoId, campo: 'decimoCuartoProp', desde: inicioDecimo4, hasta: salida });

    // 4. Fondos de reserva acumulados y nunca liquidados (no existe corrida de
    //    pago propia para fondos de reserva hoy — se salda íntegro aquí)
    const fondosReservaPendiente = emp.fondosReserva
      ? await _sumarProporcionalPendiente({ empresaId: req.empresa.id, empleadoId, campo: 'fondosReservaProp', desde: emp.fechaIngreso, hasta: salida })
      : 0;

    // 5. Bonificación por desahucio (Art. 185) e indemnización por despido
    //    intempestivo (Art. 188) — estimación, sujeta a revisión legal.
    const aniosServicio = round2(_dias360(emp.fechaIngreso, salida) / 360);
    const bonifDesahucio = motivoSalida !== 'despido_causa_justa'
      ? round2(0.25 * salario * aniosServicio)
      : 0;
    let indemnizacion = 0;
    if (motivoSalida === 'despido_intempestivo') {
      indemnizacion = aniosServicio < 3
        ? round2(salario * 3)
        : round2(Math.min(salario * aniosServicio, salario * 25));
    }

    const componentes = {
      sueldoPendiente, vacacionesPendientes, diasVacacionesPendientes,
      decimoTerceroPendiente, decimoCuartoPendiente, fondosReservaPendiente,
      bonifDesahucio, indemnizacion, aniosServicio,
    };
    const valorTotal = round2(
      sueldoPendiente + vacacionesPendientes + decimoTerceroPendiente +
      decimoCuartoPendiente + fondosReservaPendiente + bonifDesahucio + indemnizacion,
    );

    const pago = await prisma.nomina_pagos_especiales.create({
      data: {
        empresaId: req.empresa.id, tipo: 'LIQUIDACION', anio: salida.getFullYear(),
        periodoDesde: emp.fechaIngreso, periodoHasta: salida,
        estado: 'BORRADOR', totalPagado: valorTotal,
        observaciones: `Liquidación de ${emp.nombres} ${emp.apellidos} — motivo: ${motivoSalida}. Bonificación por desahucio e indemnización calculadas según Art. 185/188 del Código de Trabajo — revisar con el área legal/contable antes de pagar.`,
        creadoPor: req.usuario.id,
        detalles: { create: [{ empleadoId, baseCalculo: round2(salario), valor: valorTotal, detalleJson: JSON.stringify(componentes) }] },
      },
      include: { detalles: true },
    });

    await prisma.empleados.update({ where: { id: empleadoId }, data: { activo: false, fechaSalida: salida, motivoSalida } });

    res.status(201).json({ success: true, data: pago });
  } catch (err) {
    console.error('Error liquidar empleado:', err);
    res.status(500).json({ success: false, mensaje: 'Error al calcular la liquidación de haberes' });
  }
});

// ============================================================
// AUSENCIAS / VACACIONES
// ============================================================

router.get('/ausencias', ...verRRHH, async (req, res) => {
  try {
    const { empleadoId, tipo, aprobado, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {
      empresaId: req.empresa.id,
      ...(empleadoId ? { empleadoId: parseInt(empleadoId) } : {}),
      ...(tipo ? { tipo } : {}),
      ...(aprobado !== undefined ? { aprobado: aprobado === 'true' } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.ausencias.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { fechaInicio: 'desc' },
        include: {
          empleado: { select: { id: true, cedula: true, nombres: true, apellidos: true } },
        },
      }),
      prisma.ausencias.count({ where }),
    ]);
    res.json({ success: true, data, total });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al listar ausencias' });
  }
});

router.post('/ausencias', ...gestionarRRHH, async (req, res) => {
  try {
    const { empleadoId, tipo, fechaInicio, fechaFin, observaciones } = req.body;
    if (!empleadoId) return res.status(400).json({ success: false, mensaje: 'El empleado es requerido' });
    if (!tipo)        return res.status(400).json({ success: false, mensaje: 'El tipo es requerido' });
    if (!fechaInicio || !fechaFin) return res.status(400).json({ success: false, mensaje: 'Las fechas son requeridas' });

    const fi = new Date(fechaInicio);
    const ff = new Date(fechaFin);
    if (ff < fi) return res.status(400).json({ success: false, mensaje: 'La fecha fin no puede ser anterior a la fecha inicio' });

    const dias = Math.round((ff - fi) / (1000 * 60 * 60 * 24)) + 1;
    const emp  = await prisma.empleados.findFirst({ where: { id: parseInt(empleadoId), empresaId: req.empresa.id } });
    if (!emp) return res.status(404).json({ success: false, mensaje: 'Empleado no encontrado' });

    const ausencia = await prisma.ausencias.create({
      data: {
        empresaId:  req.empresa.id,
        empleadoId: parseInt(empleadoId),
        tipo,
        fechaInicio: fi,
        fechaFin:    ff,
        dias,
        aprobado:    false,
        observaciones: observaciones?.trim() || null,
      },
      include: { empleado: { select: { id: true, cedula: true, nombres: true, apellidos: true } } },
    });
    res.status(201).json({ success: true, data: ausencia });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al registrar ausencia' });
  }
});

router.patch('/ausencias/:id/aprobar', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ausencia = await prisma.ausencias.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!ausencia) return res.status(404).json({ success: false, mensaje: 'Ausencia no encontrada' });
    const updated = await prisma.ausencias.update({
      where: { id },
      data: { aprobado: !ausencia.aprobado, aprobadoPor: req.usuario.id },
    });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al aprobar ausencia' });
  }
});

// Liquidar (pagar) una ausencia de tipo vacación ya aprobada — descarga la
// provisión mensual de vacaciones acumulada mes a mes en la nómina regular.
router.patch('/ausencias/:id/pagar', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ausencia = await prisma.ausencias.findFirst({
      where: { id, empresaId: req.empresa.id },
      include: { empleado: true },
    });
    if (!ausencia) return res.status(404).json({ success: false, mensaje: 'Ausencia no encontrada' });
    if (ausencia.tipo !== 'vacacion') return res.status(400).json({ success: false, mensaje: 'Solo se pueden liquidar ausencias de tipo vacación' });
    if (!ausencia.aprobado) return res.status(400).json({ success: false, mensaje: 'La ausencia debe estar aprobada antes de pagarla' });
    if (ausencia.pagado) return res.status(400).json({ success: false, mensaje: 'Esta vacación ya fue pagada' });

    const salario = parseFloat(ausencia.empleado.salarioBase);
    const valor = round2((salario / 30) * ausencia.dias);

    const { asiento } = await crearAsientoPagoVacaciones({
      empresaId: req.empresa.id, ausenciaId: id, valor, usuarioId: req.usuario.id,
    });

    const updated = await prisma.ausencias.update({
      where: { id },
      data: { pagado: true, valorPagado: valor, fechaPago: new Date() },
    });
    res.json({ success: true, data: updated, asientoOk: !!asiento });
  } catch (err) {
    console.error('Error pagar vacaciones:', err);
    res.status(400).json({ success: false, mensaje: err.message || 'Error al pagar vacaciones' });
  }
});

router.delete('/ausencias/:id', ...gestionarRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ausencia = await prisma.ausencias.findFirst({ where: { id, empresaId: req.empresa.id } });
    if (!ausencia) return res.status(404).json({ success: false, mensaje: 'Ausencia no encontrada' });
    await prisma.ausencias.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Ausencia eliminada' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al eliminar ausencia' });
  }
});

// ============================================================
// DASHBOARD TH (indicadores rápidos)
// ============================================================
router.get('/dashboard', ...verRRHH, async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

    const [totalEmpleados, empleadosActivos, pendientesAprobar, nominaMes] = await Promise.all([
      prisma.empleados.count({ where: { empresaId } }),
      prisma.empleados.count({ where: { empresaId, activo: true } }),
      prisma.ausencias.count({ where: { empresaId, aprobado: false } }),
      prisma.nominas.findFirst({
        where: { empresaId, mes: hoy.getMonth() + 1, anio: hoy.getFullYear() },
        select: { id: true, estado: true, totalNeto: true },
      }),
    ]);

    res.json({ success: true, data: { totalEmpleados, empleadosActivos, pendientesAprobar, nominaMes } });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al cargar dashboard TH' });
  }
});

// ============================================================
// EXPORTAR NÓMINA A CSV
// ============================================================
router.get('/nomina/:id/csv', ...nominaRRHH, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const nomina = await prisma.nominas.findFirst({
      where: { id, empresaId: req.empresa.id },
      include: {
        detalles: {
          include: {
            empleado: {
              select: { cedula: true, nombres: true, apellidos: true,
                departamento: { select: { nombre: true } },
                cargo: { select: { nombre: true } } },
            },
          },
          orderBy: [{ empleado: { apellidos: 'asc' } }],
        },
      },
    });
    if (!nomina) return res.status(404).json({ success: false, mensaje: 'Nómina no encontrada' });

    const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                   'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const periodo = `${MESES[nomina.mes - 1]} ${nomina.anio}`;

    const cols = [
      'Cédula','Apellidos','Nombres','Departamento','Cargo',
      'Salario Base',
      'H.E. Suplementarias','Valor H.E. Suplementarias',
      'H.E. Extraordinarias','Valor H.E. Extraordinarias',
      'Otros Ingresos',
      'Total Ingresos',
      'Aporte Personal IESS (9.45%)','Impuesto Renta',
      'Préstamos IESS','Anticipos','Otros Descuentos',
      'Total Descuentos',
      'Neto a Pagar',
      'Décimo Tercero Prop.','Décimo Cuarto Prop.','Fondos Reserva Prop.','Vacaciones Prop.',
      'Aporte Patronal IESS (11.15%)',
    ];

    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const n2 = (v) => parseFloat(v || 0).toFixed(2);

    const rows = nomina.detalles.map((d) => [
      d.empleado.cedula,
      d.empleado.apellidos,
      d.empleado.nombres,
      d.empleado.departamento?.nombre || '',
      d.empleado.cargo?.nombre || '',
      n2(d.salarioBase),
      n2(d.horasExtraSuplemento),
      n2(d.valorHorasExtraSuplemento),
      n2(d.horasExtraExtraordinario),
      n2(d.valorHorasExtraExtraordinario),
      n2(d.otrosIngresos),
      n2(d.totalIngresos),
      n2(d.aportePersonalIESS),
      n2(d.impuestoRenta),
      n2(d.prestamosIESS),
      n2(d.anticipos),
      n2(d.otrosDescuentos),
      n2(d.totalDescuentos),
      n2(d.netoApagar),
      n2(d.decimoTerceroProp),
      n2(d.decimoCuartoProp),
      n2(d.fondosReservaProp),
      n2(d.vacacionesProp),
      n2(d.aportePatronal),
    ].map(esc).join(','));

    // Fila de totales
    const sum = (campo) => nomina.detalles.reduce((s, d) => s + parseFloat(d[campo] || 0), 0);
    const totales = [
      '','TOTALES','','','',
      n2(sum('salarioBase')),
      '','',
      '','',
      n2(sum('otrosIngresos')),
      n2(sum('totalIngresos')),
      n2(sum('aportePersonalIESS')),
      n2(sum('impuestoRenta')),
      n2(sum('prestamosIESS')),
      n2(sum('anticipos')),
      n2(sum('otrosDescuentos')),
      n2(sum('totalDescuentos')),
      n2(sum('netoApagar')),
      n2(sum('decimoTerceroProp')),
      n2(sum('decimoCuartoProp')),
      n2(sum('fondosReservaProp')),
      n2(sum('vacacionesProp')),
      n2(sum('aportePatronal')),
    ].map(esc).join(',');

    const csv = [
      `Nómina - ${periodo}`,
      `Estado: ${nomina.estado}`,
      '',
      cols.map(esc).join(','),
      ...rows,
      totales,
    ].join('\r\n');

    const filename = `nomina_${nomina.anio}_${String(nomina.mes).padStart(2,'0')}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM para Excel
  } catch (err) {
    console.error('Error exportar nómina CSV:', err);
    res.status(500).json({ success: false, mensaje: 'Error al exportar nómina' });
  }
});

module.exports = router;
