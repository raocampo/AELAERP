/**
 * AELA — Caja Chica
 * Fondos de caja chica por empresa. Saldo disponible calculado al vuelo.
 * Asientos contables automáticos en: apertura, reposición, incremento,
 * disminución y cierre. Los vales individuales de gasto NO generan asiento.
 */
const express = require('express');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const {
  crearAsientoAperturaCajaChica,
  crearAsientoReposicionCajaChica,
  crearAsientoIncrementoCajaChica,
  crearAsientoDisminucionCajaChica,
  crearAsientoCierreCajaChica,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');

const router = express.Router();
router.use(proteger);

function obtenerEmpresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

function parseIntSafe(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Calcula el saldo disponible de un fondo sumando los movimientos no anulados.
// APERTURA + REPOSICION + INCREMENTO → positivos
// GASTO + DISMINUCION → negativos
// CIERRE no se descuenta (ya cierra el fondo)
function calcularSaldo(movimientos) {
  return round2(
    movimientos.reduce((acc, m) => {
      if (m.anulado) return acc;
      if (['APERTURA', 'REPOSICION', 'INCREMENTO'].includes(m.tipo)) return acc + Number(m.monto);
      if (['GASTO', 'DISMINUCION'].includes(m.tipo)) return acc - Number(m.monto);
      return acc;
    }, 0),
  );
}

// Gastos pendientes de reponer (desde la última REPOSICION o desde APERTURA)
function gastosPendientesReponer(movimientos) {
  const movOrdenados = [...movimientos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const ultimaRepo = movOrdenados.filter((m) => !m.anulado && m.tipo === 'REPOSICION').at(-1);
  const desde = ultimaRepo ? new Date(ultimaRepo.fecha) : null;
  return movOrdenados.filter(
    (m) => !m.anulado && m.tipo === 'GASTO' && (!desde || new Date(m.fecha) > desde),
  );
}

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

    res.json({ success: true, data: { ...fondo, saldoDisponible, totalPendienteReponer } });
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

    const { codigo, nombre, responsableId, montoFondo, cuentaFondoId, cuentaContrapartidaId, observaciones } = req.body;

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

      const asiento = await crearAsientoAperturaCajaChica(tx, {
        empresaId, cajaChicaId: nuevo.id,
        monto: montoFondo,
        cuentaFondoId: parseIntSafe(cuentaFondoId) || null,
        cuentaContrapartidaId: parseIntSafe(cuentaContrapartidaId) || null,
        descripcion: `Apertura fondo ${nuevo.codigo} — ${nuevo.nombre}`,
        fecha: new Date(),
        usuarioId,
      });

      await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId: nuevo.id, empresaId,
          tipo: 'APERTURA',
          fecha: new Date(),
          concepto: `Apertura del fondo ${nuevo.codigo}`,
          monto: round2(montoFondo),
          asientoId: asiento.id,
          usuarioId,
        },
      });

      return nuevo;
    });

    res.status(201).json({ success: true, data: fondo, mensaje: 'Fondo creado y apertura registrada' });
  } catch (error) {
    console.error('POST /caja-chica:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear el fondo' });
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

    const { monto, concepto, nroComprobante, proveedor, cuentaGastoId, centroCostoId, fecha } = req.body;

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

    const pendientes = gastosPendientesReponer(fondo.movimientos);
    if (pendientes.length === 0) {
      return res.status(409).json({ success: false, mensaje: 'No hay gastos pendientes de reponer' });
    }

    const total = round2(pendientes.reduce((a, m) => a + Number(m.monto), 0));
    const { descripcion, fecha } = req.body;

    const movimientoReposicion = await db.$transaction(async (tx) => {
      const numero = await siguienteNumeroGenerico({
        modelo: 'movimientos_caja_chica', prefijo: 'REP', empresaId,
        fecha: fecha ? new Date(fecha) : new Date(), tx,
      });

      const movRep = await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId, empresaId,
          numero, tipo: 'REPOSICION',
          fecha: fecha ? new Date(fecha) : new Date(),
          concepto: descripcion?.trim() || `Reposición de ${pendientes.length} vale(s)`,
          monto: total,
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
        cuentaContrapartidaId: fondo.cuentaContrapartidaId,
        descripcion: movRep.concepto,
        fecha: movRep.fecha,
        usuarioId,
      });

      await tx.movimientos_caja_chica.update({
        where: { id: movRep.id },
        data: { asientoId: asiento.id },
      });

      return movRep;
    });

    res.status(201).json({
      success: true, data: movimientoReposicion,
      mensaje: `Reposición de $${total} registrada con asiento contable`,
    });
  } catch (error) {
    console.error('POST /caja-chica/:id/reponer:', error);
    res.status(500).json({ success: false, mensaje: 'Error al registrar la reposición' });
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

    const { monto, descripcion, fecha } = req.body;
    if (!monto || Number(monto) <= 0) return res.status(400).json({ success: false, mensaje: 'Monto debe ser mayor a 0' });

    const fondo = await db.cajas_chicas.findFirst({ where: { id: cajaChicaId, empresaId } });
    if (!fondo) return res.status(404).json({ success: false, mensaje: 'Fondo no encontrado' });
    if (fondo.estado !== 'ACTIVO') return res.status(409).json({ success: false, mensaje: 'El fondo está cerrado' });

    const resultado = await db.$transaction(async (tx) => {
      const movInc = await tx.movimientos_caja_chica.create({
        data: {
          cajaChicaId, empresaId, tipo: 'INCREMENTO',
          fecha: fecha ? new Date(fecha) : new Date(),
          concepto: descripcion?.trim() || `Incremento del fondo`,
          monto: round2(monto), usuarioId,
        },
      });

      const asiento = await crearAsientoIncrementoCajaChica(tx, {
        empresaId, movimientoId: movInc.id,
        monto,
        cuentaFondoId: fondo.cuentaFondoId,
        cuentaContrapartidaId: fondo.cuentaContrapartidaId,
        descripcion: movInc.concepto,
        fecha: movInc.fecha,
        usuarioId,
      });

      await tx.movimientos_caja_chica.update({ where: { id: movInc.id }, data: { asientoId: asiento.id } });

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
    res.status(500).json({ success: false, mensaje: 'Error al incrementar el fondo' });
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
