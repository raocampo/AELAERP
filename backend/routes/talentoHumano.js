// ====================================
// TALENTO HUMANO — RRHH
// backend/routes/talentoHumano.js
// Cubre: departamentos, cargos, empleados, nómina, ausencias
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');

const verRRHH      = [proteger, autorizarPermiso('rrhh.ver')];
const gestionarRRHH = [proteger, autorizarPermiso('rrhh.gestionar')];
const nominaRRHH   = [proteger, autorizarPermiso('rrhh.nomina')];

// ─── SBU Ecuador (actualizar anualmente) ─────────────────────────────────────
const SBU_ECUADOR = 480.00; // SBU 2025
const APORTE_PERSONAL_IESS = 0.0945;
const APORTE_PATRONAL_IESS = 0.1115;

// ─── Tabla LORTI Impuesto a la Renta — Ecuador 2024 ──────────────────────────
// Fuente: SRI Ecuador, resolución anual. Actualizar cada año.
// Cada fila: [fracciónDesde, fracciónHasta, impuestoFraccionBasica, porcentajeExcedente]
const TABLA_LORTI_2024 = [
  [       0,  11_902,     0, 0.00],
  [  11_902,  15_159,     0, 0.05],
  [  15_159,  19_682,   163, 0.10],
  [  19_682,  26_031,   615, 0.12],
  [  26_031,  34_255, 1_377, 0.15],
  [  34_255,  45_407, 2_611, 0.20],
  [  45_407,  60_450, 4_841, 0.25],
  [  60_450,  80_605, 8_602, 0.30],
  [  80_605, Infinity, 14_648, 0.35],
];

/**
 * Calcula el Impuesto a la Renta mensual a retener a un empleado.
 *
 * Proyección anual:
 *   ingresos = (salario + horasExtrasMes + otrosIngresosMes) × 12
 *              + decimoTercero (anual) + decimoCuarto (SBU)
 * Deducciones:
 *   - aporte personal IESS proyectado anual
 *   - gastoPersonalesAnuales (0 por defecto, empleado puede presentar formulario)
 * Base imponible = ingresos - deducciones
 * Aplica tabla progresiva LORTI → IR anual → IR mensual = IR anual / 12
 *
 * @param {object} params
 * @param {number} params.salarioMensual
 * @param {number} params.sbu - SBU vigente (para 14to sueldo)
 * @param {number} [params.horasExtraMes=0] - valor monetario de HE del mes
 * @param {number} [params.otrosIngresosMes=0]
 * @param {boolean} [params.afiliadoIESS=true]
 * @param {boolean} [params.fondosReserva=false]
 * @param {number} [params.gastosPersonalesAnuales=0] - deducción por gastos personales
 * @returns {{ irMensual: number, irAnual: number, baseImponible: number, ingresoGravadoAnual: number }}
 */
function calcularImpuestoRentaMensual({
  salarioMensual,
  sbu,
  horasExtraMes = 0,
  otrosIngresosMes = 0,
  afiliadoIESS = true,
  gastosPersonalesAnuales = 0,
}) {
  const ingresosMensualesBase = salarioMensual + horasExtraMes + otrosIngresosMes;

  // Proyección anual de ingresos gravados (13o y 14o se incluyen porque son gravados)
  const ingresosAnuales =
    ingresosMensualesBase * 12 +
    salarioMensual +          // decimoTercero = salario anual / 12 × 12 ≈ salario mensual (simplificado)
    sbu;                      // decimoCuarto = SBU (anual por empleado)

  // Deducciones
  const aporteIESSAnual = afiliadoIESS ? salarioMensual * 12 * APORTE_PERSONAL_IESS : 0;
  const deducciones = aporteIESSAnual + gastosPersonalesAnuales;

  const baseImponible = Math.max(0, ingresosAnuales - deducciones);

  // Tabla progresiva
  let irAnual = 0;
  for (const [desde, hasta, impFB, pctExc] of TABLA_LORTI_2024) {
    if (baseImponible > desde) {
      const excedente = Math.min(baseImponible, hasta === Infinity ? baseImponible : hasta) - desde;
      irAnual = impFB + excedente * pctExc;
    }
  }

  irAnual = Math.max(0, +irAnual.toFixed(2));
  const irMensual = +(irAnual / 12).toFixed(2);

  return {
    irMensual,
    irAnual,
    baseImponible: +baseImponible.toFixed(2),
    ingresoGravadoAnual: +ingresosAnuales.toFixed(2),
  };
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
      afiliadoIESS, codigoIESS, tieneRenta, fondosReserva,
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
        observaciones: observaciones?.trim() || null,
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
      'afiliadoIESS','codigoIESS','tieneRenta','fondosReserva',
      'activo','observaciones','motivoSalida',
    ];
    const data = {};
    for (const c of campos) {
      if (req.body[c] !== undefined) {
        if (c === 'salarioBase') data[c] = parseFloat(req.body[c]);
        else if (c === 'departamentoId' || c === 'cargoId') data[c] = req.body[c] ? parseInt(req.body[c]) : null;
        else if (['afiliadoIESS','tieneRenta','fondosReserva','activo'].includes(c)) data[c] = Boolean(req.body[c]);
        else data[c] = req.body[c]?.trim ? req.body[c].trim() || null : req.body[c];
      }
    }
    if (req.body.fechaNacimiento !== undefined) data.fechaNacimiento = req.body.fechaNacimiento ? new Date(req.body.fechaNacimiento) : null;
    if (req.body.fechaIngreso !== undefined)    data.fechaIngreso    = new Date(req.body.fechaIngreso);
    if (req.body.fechaSalida !== undefined)     data.fechaSalida     = req.body.fechaSalida ? new Date(req.body.fechaSalida) : null;

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

      // Proporcionales informativos (no se descuentan del sueldo mensual)
      const decimoTerceroProp = +(salario / 12).toFixed(2);
      const decimoCuartoProp  = +(sbu / 12).toFixed(2);
      const fondosReservaProp = emp.fondosReserva ? +(salario / 12).toFixed(2) : 0;

      // Impuesto a la Renta calculado con tabla LORTI
      const { irMensual } = calcularImpuestoRentaMensual({
        salarioMensual: salario,
        sbu,
        afiliadoIESS: Boolean(emp.afiliadoIESS),
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
    });

    res.json({
      success: true,
      data: {
        ...resultado,
        tablaAnio: 2024,
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
    res.json({ success: true, data: updated });
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
      'Décimo Tercero Prop.','Décimo Cuarto Prop.','Fondos Reserva Prop.',
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
