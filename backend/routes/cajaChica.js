/**
 * AELA — Caja Chica
 * Fondos de caja chica por empresa. Saldo disponible calculado al vuelo.
 * Asientos contables automáticos en: apertura, reposición, incremento,
 * disminución y cierre. Los vales individuales de gasto NO generan asiento.
 */
const express = require('express');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const {
  crearAsientoAperturaCajaChica,
  crearAsientoReposicionCajaChica,
  crearAsientoIncrementoCajaChica,
  crearAsientoDisminucionCajaChica,
  crearAsientoCierreCajaChica,
  siguienteNumeroGenerico,
  registrarMovimientoBancarioLigado,
  round2,
} = require('../utils/contabilidad');
const { calcularSaldoCajaChica, gastosPendientesReponerCajaChica } = require('../utils/cajaChicaSaldo');

const router = express.Router();
router.use(proteger);
// req.prisma solo se setea cuando resolverTenant resuelve un tenant por
// subdominio (SaaS) — en monoinstancia/cliente directo queda undefined.
router.use((req, _res, next) => { req.prisma = req.prisma || prisma; next(); });
router.use(soloMediumOPro);
router.use(requiereModulo('contabilidadHabilitada'));

function obtenerEmpresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

function parseIntSafe(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Pago con banco para apertura/incremento/reposición (Fase 3) ─────────────
const METODOS_PAGO_FONDO = ['efectivo', 'transferencia', 'cheque'];

// Valida metodoPago y, si no es efectivo, resuelve el banco elegido — la
// cuenta contable de contrapartida pasa a ser la del banco (si tiene una
// vinculada), no la genérica que ya tenía el fondo, para que el asiento
// acredite la cuenta correcta y el movimiento se pueda ligar a Libro de
// Bancos después de crear el asiento.
async function resolverPagoFondo(tx, { metodoPago, bancoId, chequeId, cuentaContrapartidaFondo, empresaId }) {
  const metodo = metodoPago ? String(metodoPago).toLowerCase() : 'efectivo';
  if (!METODOS_PAGO_FONDO.includes(metodo)) {
    throw Object.assign(new Error(`metodoPago debe ser uno de: ${METODOS_PAGO_FONDO.join(', ')}`), { status: 400 });
  }
  if (metodo === 'efectivo') {
    return { metodoPago: 'efectivo', bancoId: null, chequeId: null, cuentaContrapartidaId: cuentaContrapartidaFondo };
  }
  const bancoIdNum = parseIntSafe(bancoId);
  if (!bancoIdNum) throw Object.assign(new Error('Selecciona el banco'), { status: 400 });
  const banco = await tx.bancos.findFirst({ where: { id: bancoIdNum, empresaId } });
  if (!banco) throw Object.assign(new Error('Banco no encontrado'), { status: 404 });
  return {
    metodoPago: metodo,
    bancoId: bancoIdNum,
    chequeId: parseIntSafe(chequeId) || null,
    cuentaContrapartidaId: banco.cuentaContableId || cuentaContrapartidaFondo,
  };
}

// Crea la fila en Libro de Bancos ligada al asiento que ya generó la
// operación (apertura/incremento/reposición) — el dinero SALE del banco
// hacia el fondo, por eso siempre es egreso (TRANSFERENCIA_OUT/CHEQUE).
async function ligarMovimientoBancarioFondo(tx, { pago, empresaId, fecha, monto, concepto, referencia, asientoId }) {
  if (!pago.bancoId) return null;
  const mov = await registrarMovimientoBancarioLigado({
    bancoId: pago.bancoId,
    empresaId, fecha,
    tipo: pago.metodoPago === 'cheque' ? 'CHEQUE' : 'TRANSFERENCIA_OUT',
    concepto, referencia,
    monto, esIngreso: false,
    asientoId, chequeId: pago.chequeId,
    db: tx,
  });
  return mov.id;
}

// Saldo disponible / pendientes de reponer — lógica compartida con
// routes/cxp.js (pagar una compra con caja chica también respeta el saldo
// del fondo), ver utils/cajaChicaSaldo.js.
const calcularSaldo = calcularSaldoCajaChica;
const gastosPendientesReponer = gastosPendientesReponerCajaChica;

// ─── Tipo de gasto de caja chica — catálogo simple (mismo shape que
// centros_costo en contabilidad.js) — declarado ANTES de GET/:id para que
// Express no confunda "/tipos-gasto" con un :id. ────────────────────────
const TIPOS_GASTO_DEFAULT = [
  { codigo: 'ALIMENTACION', nombre: 'Alimentación' },
  { codigo: 'TRANSPORTE', nombre: 'Transporte' },
  { codigo: 'LIMPIEZA', nombre: 'Limpieza' },
  { codigo: 'PAPELERIA', nombre: 'Papelería' },
  { codigo: 'MANTENIMIENTO', nombre: 'Mantenimiento' },
  { codigo: 'OTROS', nombre: 'Otros' },
];

router.get('/tipos-gasto', autorizarPermiso('cajaChica.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { activo = 'true' } = req.query;

    // Primera vez que la empresa usa el catálogo: sembrar las categorías
    // comunes para no arrancar de una lista vacía — el usuario las puede
    // editar/desactivar/agregar más después vía el CRUD normal.
    const total = await db.tipo_gasto_caja_chica.count({ where: { empresaId } });
    if (total === 0) {
      await db.tipo_gasto_caja_chica.createMany({
        data: TIPOS_GASTO_DEFAULT.map((t) => ({ ...t, empresaId })),
        skipDuplicates: true,
      });
    }

    const where = { empresaId };
    if (activo !== 'todos') where.activo = String(activo) === 'true';

    const tipos = await db.tipo_gasto_caja_chica.findMany({ where, orderBy: { codigo: 'asc' } });
    res.json({ success: true, data: tipos });
  } catch (error) {
    console.error('GET /caja-chica/tipos-gasto:', error);
    res.status(500).json({ success: false, mensaje: 'Error al listar tipos de gasto' });
  }
});

router.post('/tipos-gasto', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { codigo, nombre, descripcion = null, activo = true } = req.body || {};
    if (!codigo?.trim() || !nombre?.trim()) {
      return res.status(400).json({ success: false, mensaje: 'codigo y nombre son requeridos' });
    }

    const tipo = await db.tipo_gasto_caja_chica.create({
      data: { empresaId, codigo: codigo.trim().toUpperCase(), nombre: nombre.trim(), descripcion: descripcion || null, activo: Boolean(activo) },
    });
    res.status(201).json({ success: true, data: tipo });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: `El código ${req.body?.codigo} ya existe` });
    }
    console.error('POST /caja-chica/tipos-gasto:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear el tipo de gasto' });
  }
});

router.put('/tipos-gasto/:id', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await db.tipo_gasto_caja_chica.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Tipo de gasto no encontrado' });

    const codigo = req.body?.codigo || actual.codigo;
    const nombre = req.body?.nombre || actual.nombre;
    const descripcion = req.body?.descripcion === undefined ? actual.descripcion : (req.body.descripcion || null);
    const activo = req.body?.activo === undefined ? actual.activo : Boolean(req.body.activo);

    const tipo = await db.tipo_gasto_caja_chica.update({
      where: { id },
      data: { codigo: String(codigo).trim().toUpperCase(), nombre: String(nombre).trim(), descripcion, activo },
    });
    res.json({ success: true, data: tipo });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, mensaje: `El código ${req.body?.codigo} ya existe` });
    }
    console.error('PUT /caja-chica/tipos-gasto/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar el tipo de gasto' });
  }
});

router.delete('/tipos-gasto/:id', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const tipo = await db.tipo_gasto_caja_chica.findFirst({ where: { id, empresaId } });
    if (!tipo) return res.status(404).json({ success: false, mensaje: 'Tipo de gasto no encontrado' });

    const enUso = await db.movimientos_caja_chica.count({ where: { tipoGastoCajaChicaId: id } });
    if (enUso > 0) {
      return res.status(400).json({ success: false, mensaje: 'Hay vales con este tipo de gasto — desactívalo en su lugar' });
    }

    await db.tipo_gasto_caja_chica.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Tipo de gasto eliminado' });
  } catch (error) {
    console.error('DELETE /caja-chica/tipos-gasto/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar el tipo de gasto' });
  }
});

// GET /api/caja-chica — lista de fondos de la empresa
router.get('/', autorizarPermiso('cajaChica.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const { estado } = req.query;

    const fondos = await db.cajas_chicas.findMany({
      where: { empresaId, ...(estado ? { estado } : {}) },
      include: {
        responsable: { select: { id: true, nombre: true, username: true } },
        movimientos: { where: { anulado: false }, select: { tipo: true, monto: true, anulado: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = fondos.map((f) => ({
      ...f,
      saldoDisponible: calcularSaldo(f.movimientos),
      movimientos: undefined,
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /caja-chica:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener fondos de caja chica' });
  }
});

// GET /api/caja-chica/:id — fondo con movimientos y saldo
router.get('/:id', autorizarPermiso('cajaChica.ver'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const fondo = await db.cajas_chicas.findFirst({
      where: { id, empresaId },
      include: {
        responsable: { select: { id: true, nombre: true, username: true } },
        movimientos: {
          include: {
            centroCosto: { select: { id: true, nombre: true } },
            tipoGasto: { select: { id: true, codigo: true, nombre: true } },
            asiento: { select: { id: true, numero: true, tipo: true } },
            usuario: { select: { id: true, nombre: true } },
          },
          orderBy: { fecha: 'desc' },
        },
      },
    });

    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });

    const saldoDisponible = calcularSaldo(fondo.movimientos);
    const pendientes = gastosPendientesReponer(fondo.movimientos);
    const totalPendienteReponer = round2(pendientes.reduce((a, m) => a + Number(m.monto), 0));
    // Para el checklist de selección manual de reposición (Fase 3) — mismos
    // objetos que ya calcula gastosPendientesReponer, sin duplicar el cálculo
    // del lado frontend.
    const pendientesReponer = pendientes.map((p) => ({
      id: p.id, tipo: p.tipo, fecha: p.fecha, concepto: p.concepto,
      monto: p.monto, nroComprobante: p.nroComprobante, proveedor: p.proveedor,
    }));

    res.json({ success: true, data: { ...fondo, saldoDisponible, totalPendienteReponer, pendientesReponer } });
  } catch (error) {
    console.error('GET /caja-chica/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener el fondo' });
  }
});

// POST /api/caja-chica — crear fondo + apertura automática
router.post('/', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;

    const {
      codigo, nombre, responsableId, montoFondo, cuentaFondoId, cuentaContrapartidaId, observaciones,
      metodoPago, bancoId, chequeId, referenciaPago,
    } = req.body;

    if (!codigo?.trim()) return res.status(400).json({ success: false, mensaje: 'Código requerido' });
    if (!nombre?.trim()) return res.status(400).json({ success: false, mensaje: 'Nombre requerido' });
    if (!montoFondo || Number(montoFondo) <= 0) return res.status(400).json({ success: false, mensaje: 'Monto del fondo debe ser mayor a 0' });

    const existe = await db.cajas_chicas.findFirst({ where: { empresaId, codigo: codigo.trim() } });
    if (existe) return res.status(409).json({ success: false, mensaje: `El código ${codigo} ya existe` });

    const fondo = await db.$transaction(async (tx) => {
      const nuevo = await tx.cajas_chicas.create({
        data: {
          empresaId,
          codigo: codigo.trim().toUpperCase(),
          nombre: nombre.trim(),
          responsableId: parseIntSafe(responsableId) || null,
          montoFondo: round2(montoFondo),
          cuentaFondoId: parseIntSafe(cuentaFondoId) || null,
          cuentaContrapartidaId: parseIntSafe(cuentaContrapartidaId) || null,
          estado: 'ACTIVO',
          observaciones: observaciones?.trim() || null,
        },
      });

      const pago = await resolverPagoFondo(tx, {
        metodoPago, bancoId, chequeId, empresaId,
        cuentaContrapartidaFondo: parseIntSafe(cuentaContrapartidaId) || null,
      });

      const asiento = await crearAsientoAperturaCajaChica(tx, {
        empresaId, cajaChicaId: nuevo.id,
        monto: montoFondo,
        cuentaFondoId: parseIntSafe(cuentaFondoId) || null,
        cuentaContrapartidaId: pago.cuentaContrapartidaId,
        descripcion: `Apertura fondo ${nuevo.codigo} — ${nuevo.nombre}`,
        fecha: new Date(),
        usuarioId,
      });

      const concepto = `Apertura del fondo ${nuevo.codigo}`;
      const movimientoBancarioId = await ligarMovimientoBancarioFondo(tx, {
        pago, empresaId, fecha: new Date(), monto: round2(montoFondo),
        concepto, referencia: referenciaPago?.trim() || nuevo.codigo, asientoId: asiento.id,
      });

      await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId: nuevo.id, empresaId,
          tipo: 'APERTURA',
          fecha: new Date(),
          concepto,
          monto: round2(montoFondo),
          asientoId: asiento.id,
          metodoPago: pago.metodoPago,
          bancoId: pago.bancoId,
          chequeId: pago.chequeId,
          movimientoBancarioId,
          usuarioId,
        },
      });

      return nuevo;
    });

    res.status(201).json({ success: true, data: fondo, mensaje: 'Fondo creado y apertura registrada' });
  } catch (error) {
    console.error('POST /caja-chica:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'Error al crear el fondo' });
  }
});

// POST /api/caja-chica/:id/gastos — registrar vale/gasto (sin asiento)
router.post('/:id/gastos', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;
    const cajaChicaId = parseIntSafe(req.params.id);
    if (!cajaChicaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const fondo = await db.cajas_chicas.findFirst({
      where: { id: cajaChicaId, empresaId },
      include: { movimientos: { where: { anulado: false } } },
    });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo está cerrado' });

    const { monto, concepto, nroComprobante, proveedor, cuentaGastoId, centroCostoId, fecha, tipoGastoCajaChicaId, numeroPreimpreso } = req.body;

    if (!monto || Number(monto) <= 0) return res.status(400).json({ success: false, mensaje: 'Monto debe ser mayor a 0' });
    if (!concepto?.trim()) return res.status(400).json({ success: false, mensaje: 'Concepto requerido' });

    const saldoActual = calcularSaldo(fondo.movimientos);
    if (round2(monto) > saldoActual + 0.009) {
      return res.status(409).json({
        success: false,
        mensaje: `Monto ($${round2(monto)}) supera el saldo disponible ($${saldoActual})`,
      });
    }

    const numero = await siguienteNumeroGenerico({
      modelo: 'movimientos_caja_chica', prefijo: 'VALE', empresaId,
      fecha: fecha ? new Date(fecha) : new Date(), tx: db,
    });

    const gasto = await db.movimientos_caja_chica.create({
      data: {
        cajaChicaId, empresaId,
        numero,
        tipo: 'GASTO',
        fecha: fecha ? new Date(fecha) : new Date(),
        concepto: concepto.trim(),
        monto: round2(monto),
        nroComprobante: nroComprobante?.trim() || null,
        proveedor: proveedor?.trim() || null,
        cuentaGastoId: parseIntSafe(cuentaGastoId) || null,
        centroCostoId: parseIntSafe(centroCostoId) || null,
        tipoGastoCajaChicaId: parseIntSafe(tipoGastoCajaChicaId) || null,
        numeroPreimpreso: numeroPreimpreso?.trim() || null,
        usuarioId,
      },
    });

    res.status(201).json({ success: true, data: gasto, mensaje: 'Gasto registrado' });
  } catch (error) {
    console.error('POST /caja-chica/:id/gastos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al registrar el gasto' });
  }
});

// PATCH /api/caja-chica/:id/gastos/:movId/anular
router.patch('/:id/gastos/:movId/anular', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const cajaChicaId = parseIntSafe(req.params.id);
    const movId = parseIntSafe(req.params.movId);
    if (!cajaChicaId || !movId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const mov = await db.movimientos_caja_chica.findFirst({
      where: { id: movId, cajaChicaId, empresaId, tipo: 'GASTO' },
    });
    if (!mov) return res.status(404).json({ success: false, mensaje: 'Vale no encontrado' });
    if (mov.anulado) return res.status(409).json({ success: false, mensaje: 'El vale ya está anulado' });

    const { motivo } = req.body;
    const actualizado = await db.movimientos_caja_chica.update({
      where: { id: movId },
      data: { anulado: true, motivoAnulacion: motivo?.trim() || 'Anulado por el usuario' },
    });

    res.json({ success: true, data: actualizado, mensaje: 'Vale anulado' });
  } catch (error) {
    console.error('PATCH /caja-chica/:id/gastos/:movId/anular:', error);
    res.status(500).json({ success: false, mensaje: 'Error al anular el vale' });
  }
});

// POST /api/caja-chica/:id/reponer — reposición de fondos + asiento contable
router.post('/:id/reponer', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;
    const cajaChicaId = parseIntSafe(req.params.id);
    if (!cajaChicaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const fondo = await db.cajas_chicas.findFirst({
      where: { id: cajaChicaId, empresaId },
      include: {
        movimientos: {
          include: { asiento: { select: { id: true } } },
        },
      },
    });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo está cerrado' });

    const todosPendientes = gastosPendientesReponer(fondo.movimientos);
    if (todosPendientes.length === 0) {
      return res.status(409).json({ success: false, mensaje: 'No hay gastos pendientes de reponer' });
    }

    const { descripcion, fecha, metodoPago, bancoId, chequeId, referenciaPago, movimientoIds } = req.body;

    // Selección manual (Fase 3): si viene movimientoIds, reponer solo esos —
    // deben existir entre los pendientes reales del fondo (evita reponer algo
    // ya repuesto, anulado, o de otro fondo). Sin movimientoIds, se mantiene
    // el comportamiento de siempre: repone todos los pendientes.
    let pendientes = todosPendientes;
    if (Array.isArray(movimientoIds) && movimientoIds.length > 0) {
      const idsSolicitados = new Set(movimientoIds.map((id) => parseIntSafe(id)).filter(Boolean));
      pendientes = todosPendientes.filter((p) => idsSolicitados.has(p.id));
      if (pendientes.length !== idsSolicitados.size) {
        return res.status(400).json({ success: false, mensaje: 'Uno o más movimientos seleccionados no están pendientes de reponer en este fondo' });
      }
    }

    const total = round2(pendientes.reduce((a, m) => a + Number(m.monto), 0));

    const movimientoReposicion = await db.$transaction(async (tx) => {
      const pago = await resolverPagoFondo(tx, {
        metodoPago, bancoId, chequeId, empresaId,
        cuentaContrapartidaFondo: fondo.cuentaContrapartidaId,
      });

      const fechaMov = fecha ? new Date(fecha) : new Date();
      const concepto = descripcion?.trim() || `Reposición de ${pendientes.length} vale(s)`;
      const numero = await siguienteNumeroGenerico({
        modelo: 'movimientos_caja_chica', prefijo: 'REP', empresaId,
        fecha: fechaMov, tx,
      });

      const movRep = await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId, empresaId,
          numero, tipo: 'REPOSICION',
          fecha: fechaMov,
          concepto,
          monto: total,
          metodoPago: pago.metodoPago, bancoId: pago.bancoId, chequeId: pago.chequeId,
          usuarioId,
        },
      });

      // Armar los gastos para el asiento (por cuenta contable)
      const gastoParaAsiento = await Promise.all(
        pendientes.map(async (p) => {
          let codigoCuenta = '5.2.01.001';
          let nombreCuenta = 'Gastos Varios Caja Chica';
          if (p.cuentaGastoId) {
            const cuenta = await tx.plan_cuentas.findUnique({ where: { id: p.cuentaGastoId } });
            if (cuenta) { codigoCuenta = cuenta.codigo; nombreCuenta = cuenta.nombre; }
          }
          return { codigoCuenta, nombreCuenta, concepto: p.concepto, monto: Number(p.monto) };
        }),
      );

      const asiento = await crearAsientoReposicionCajaChica(tx, {
        empresaId, reposicionId: movRep.id,
        gastos: gastoParaAsiento,
        cuentaContrapartidaId: pago.cuentaContrapartidaId,
        descripcion: movRep.concepto,
        fecha: movRep.fecha,
        usuarioId,
      });

      const movimientoBancarioId = await ligarMovimientoBancarioFondo(tx, {
        pago, empresaId, fecha: fechaMov, monto: total,
        concepto, referencia: referenciaPago?.trim() || movRep.numero, asientoId: asiento.id,
      });

      await tx.movimientos_caja_chica.update({
        where: { id: movRep.id },
        data: { asientoId: asiento.id, movimientoBancarioId },
      });

      return movRep;
    });

    res.status(201).json({
      success: true, data: movimientoReposicion,
      mensaje: `Reposición de $${total} registrada con asiento contable`,
    });
  } catch (error) {
    console.error('POST /caja-chica/:id/reponer:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'Error al registrar la reposición' });
  }
});

// POST /api/caja-chica/:id/incrementar — aumentar el monto del fondo
router.post('/:id/incrementar', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;
    const cajaChicaId = parseIntSafe(req.params.id);
    if (!cajaChicaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { monto, descripcion, fecha, metodoPago, bancoId, chequeId, referenciaPago } = req.body;
    if (!monto || Number(monto) <= 0) return res.status(400).json({ success: false, mensaje: 'Monto debe ser mayor a 0' });

    const fondo = await db.cajas_chicas.findFirst({ where: { id: cajaChicaId, empresaId } });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo está cerrado' });

    const resultado = await db.$transaction(async (tx) => {
      const pago = await resolverPagoFondo(tx, {
        metodoPago, bancoId, chequeId, empresaId,
        cuentaContrapartidaFondo: fondo.cuentaContrapartidaId,
      });

      const concepto = descripcion?.trim() || `Incremento del fondo`;
      const fechaMov = fecha ? new Date(fecha) : new Date();
      const movInc = await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId, empresaId, tipo: 'INCREMENTO',
          fecha: fechaMov,
          concepto,
          monto: round2(monto),
          metodoPago: pago.metodoPago, bancoId: pago.bancoId, chequeId: pago.chequeId,
          usuarioId,
        },
      });

      const asiento = await crearAsientoIncrementoCajaChica(tx, {
        empresaId, movimientoId: movInc.id,
        monto,
        cuentaFondoId: fondo.cuentaFondoId,
        cuentaContrapartidaId: pago.cuentaContrapartidaId,
        descripcion: movInc.concepto,
        fecha: movInc.fecha,
        usuarioId,
      });

      const movimientoBancarioId = await ligarMovimientoBancarioFondo(tx, {
        pago, empresaId, fecha: fechaMov, monto: round2(monto),
        concepto, referencia: referenciaPago?.trim() || fondo.codigo, asientoId: asiento.id,
      });

      await tx.movimientos_caja_chica.update({
        where: { id: movInc.id },
        data: { asientoId: asiento.id, movimientoBancarioId },
      });

      const nuevoMonto = round2(Number(fondo.montoFondo) + Number(monto));
      await tx.cajas_chicas.update({ where: { id: cajaChicaId }, data: { montoFondo: nuevoMonto } });

      return { movimiento: movInc, nuevoMonto };
    });

    res.status(201).json({
      success: true, data: resultado,
      mensaje: `Fondo incrementado a $${resultado.nuevoMonto}`,
    });
  } catch (error) {
    console.error('POST /caja-chica/:id/incrementar:', error);
    res.status(error.status || 500).json({ success: false, mensaje: error.message || 'Error al incrementar el fondo' });
  }
});

// POST /api/caja-chica/:id/disminuir — reducir el monto del fondo
router.post('/:id/disminuir', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;
    const cajaChicaId = parseIntSafe(req.params.id);
    if (!cajaChicaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { monto, descripcion, fecha } = req.body;
    if (!monto || Number(monto) <= 0) return res.status(400).json({ success: false, mensaje: 'Monto debe ser mayor a 0' });

    const fondo = await db.cajas_chicas.findFirst({
      where: { id: cajaChicaId, empresaId },
      include: { movimientos: { where: { anulado: false } } },
    });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo está cerrado' });

    const saldoActual = calcularSaldo(fondo.movimientos);
    if (round2(monto) > saldoActual + 0.009) {
      return res.status(409).json({
        success: false,
        mensaje: `No se puede disminuir $${round2(monto)} — saldo disponible: $${saldoActual}`,
      });
    }

    const resultado = await db.$transaction(async (tx) => {
      const movDec = await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId, empresaId, tipo: 'DISMINUCION',
          fecha: fecha ? new Date(fecha) : new Date(),
          concepto: descripcion?.trim() || `Disminución del fondo`,
          monto: round2(monto), usuarioId,
        },
      });

      const asiento = await crearAsientoDisminucionCajaChica(tx, {
        empresaId, movimientoId: movDec.id,
        monto,
        cuentaFondoId: fondo.cuentaFondoId,
        cuentaContrapartidaId: fondo.cuentaContrapartidaId,
        descripcion: movDec.concepto,
        fecha: movDec.fecha,
        usuarioId,
      });

      await tx.movimientos_caja_chica.update({ where: { id: movDec.id }, data: { asientoId: asiento.id } });

      const nuevoMonto = round2(Number(fondo.montoFondo) - Number(monto));
      await tx.cajas_chicas.update({ where: { id: cajaChicaId }, data: { montoFondo: nuevoMonto } });

      return { movimiento: movDec, nuevoMonto };
    });

    res.status(201).json({
      success: true, data: resultado,
      mensaje: `Fondo reducido a $${resultado.nuevoMonto}`,
    });
  } catch (error) {
    console.error('POST /caja-chica/:id/disminuir:', error);
    res.status(500).json({ success: false, mensaje: 'Error al disminuir el fondo' });
  }
});

// PATCH /api/caja-chica/:id/cerrar — cierre definitivo del fondo
router.patch('/:id/cerrar', autorizarPermiso('cajaChica.gestionar'), async (req, res) => {
  try {
    const db = req.prisma;
    const empresaId = obtenerEmpresaId(req);
    const usuarioId = req.usuario?.id;
    const cajaChicaId = parseIntSafe(req.params.id);
    if (!cajaChicaId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const fondo = await db.cajas_chicas.findFirst({
      where: { id: cajaChicaId, empresaId },
      include: { movimientos: { where: { anulado: false } } },
    });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo ya está cerrado' });

    const saldoActual = calcularSaldo(fondo.movimientos);
    const pendientes = gastosPendientesReponer(fondo.movimientos);
    if (pendientes.length > 0) {
      return res.status(409).json({
        success: false,
        mensaje: `Hay ${pendientes.length} vale(s) pendiente(s) de reponer ($${round2(pendientes.reduce((a, m) => a + Number(m.monto), 0))}). Reponga antes de cerrar.`,
      });
    }

    const { fecha } = req.body;

    await db.$transaction(async (tx) => {
      let asientoId = null;
      if (saldoActual > 0.009) {
        const asiento = await crearAsientoCierreCajaChica(tx, {
          empresaId, cajaChicaId,
          saldoActual,
          cuentaFondoId: fondo.cuentaFondoId,
          cuentaContrapartidaId: fondo.cuentaContrapartidaId,
          descripcion: `Cierre fondo ${fondo.codigo} — ${fondo.nombre}`,
          fecha: fecha ? new Date(fecha) : new Date(),
          usuarioId,
        });
        asientoId = asiento.id;

        await tx.movimientos_caja_chica.create({
          data: {
            cajaChicaId, empresaId, tipo: 'CIERRE',
            fecha: fecha ? new Date(fecha) : new Date(),
            concepto: `Cierre del fondo ${fondo.codigo}`,
            monto: saldoActual,
            asientoId,
            usuarioId,
          },
        });
      }

      await tx.cajas_chicas.update({
        where: { id: cajaChicaId },
        data: { estado: 'CERRADO', fechaCierre: fecha ? new Date(fecha) : new Date() },
      });
    });

    res.json({ success: true, mensaje: `Fondo ${fondo.codigo} cerrado` });
  } catch (error) {
    console.error('PATCH /caja-chica/:id/cerrar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al cerrar el fondo' });
  }
});

module.exports = router;
