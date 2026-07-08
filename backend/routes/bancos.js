/**
 * AELA — Módulo de Bancos
 * Gestión de cuentas bancarias de la empresa, movimientos y cheques.
 * Requiere plan Medium o Pro.
 */
const express = require('express');
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const { crearAsientoMovimientoBancario, siguienteNumeroGenerico } = require('../utils/contabilidad');

// Prefijo de comprobante por categoría de movimiento — equivalente a los
// "Comprobantes de ingreso/pago/crédito/débito" de otros ERP contables.
const PREFIJO_COMPROBANTE = {
  DEPOSITO: 'ING', TRANSFERENCIA_IN: 'ING',
  RETIRO: 'EGR', TRANSFERENCIA_OUT: 'EGR', CHEQUE: 'EGR',
  NOTA_CREDITO: 'NC', NOTA_DEBITO: 'ND', AJUSTE: 'AJU',
};

const router = express.Router();

router.use(proteger);
router.use(soloMediumOPro);

// ============================================================
// HELPERS
// ============================================================
function parseIntSafe(v) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// req.empresa.id refleja la empresa ACTIVA (EmpresaSwitcher / cambiar-empresa en
// Macro Empresa). req.usuario.empresaId es la empresa BASE del usuario y nunca
// cambia al cambiar de empresa — usarlo aquí hacía que Bancos operara siempre
// sobre la empresa base del usuario, ignorando a qué empresa había cambiado.
function obtenerEmpresaId(req) {
  return req.empresa?.id ?? req.usuario?.empresaId ?? 1;
}

// ============================================================
// CUENTAS BANCARIAS
// ============================================================

// GET /api/bancos — lista cuentas bancarias
router.get('/', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const cuentas = await prisma.bancos.findMany({
      where: { empresaId, activo: true },
      include: {
        cuentaContable: { select: { codigo: true, nombre: true } },
        _count: { select: { movimientos: true, cheques: true } },
      },
      orderBy: { nombre: 'asc' },
    });
    res.json({ success: true, data: cuentas });
  } catch (error) {
    console.error('GET /bancos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener cuentas bancarias' });
  }
});

// GET /api/bancos/:id — detalle de cuenta
router.get('/:id', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({
      where: { id, empresaId },
      include: {
        cuentaContable: { select: { codigo: true, nombre: true } },
      },
    });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });
    res.json({ success: true, data: cuenta });
  } catch (error) {
    console.error('GET /bancos/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener cuenta bancaria' });
  }
});

// POST /api/bancos — crear cuenta bancaria
router.post('/', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { nombre, banco, tipoCuenta, numeroCuenta, titular, saldoInicial, cuentaContableId } = req.body;
    if (!nombre || !banco || !numeroCuenta) {
      return res.status(400).json({ success: false, mensaje: 'nombre, banco y numeroCuenta son obligatorios' });
    }
    const nueva = await prisma.bancos.create({
      data: {
        empresaId,
        nombre: String(nombre).trim(),
        banco: String(banco).trim(),
        tipoCuenta: String(tipoCuenta || 'CORRIENTE').toUpperCase(),
        numeroCuenta: String(numeroCuenta).trim(),
        titular: titular ? String(titular).trim() : null,
        saldoInicial: parseFloat(saldoInicial) || 0,
        cuentaContableId: cuentaContableId ? parseIntSafe(cuentaContableId) : null,
      },
      include: {
        cuentaContable: { select: { codigo: true, nombre: true } },
      },
    });
    res.status(201).json({ success: true, data: nueva });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe una cuenta con ese número en esta empresa' });
    }
    console.error('POST /bancos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al crear cuenta bancaria' });
  }
});

// PUT /api/bancos/:id — editar cuenta
router.put('/:id', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const actual = await prisma.bancos.findFirst({ where: { id, empresaId } });
    if (!actual) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    const { nombre, banco, tipoCuenta, numeroCuenta, titular, saldoInicial, cuentaContableId, activo } = req.body;

    const actualizado = await prisma.bancos.update({
      where: { id },
      data: {
        nombre:   nombre      ? String(nombre).trim()   : undefined,
        banco:    banco       ? String(banco).trim()    : undefined,
        tipoCuenta: tipoCuenta ? String(tipoCuenta).toUpperCase() : undefined,
        numeroCuenta: numeroCuenta ? String(numeroCuenta).trim() : undefined,
        titular:  titular !== undefined ? (titular || null) : undefined,
        saldoInicial: saldoInicial !== undefined ? (parseFloat(saldoInicial) || 0) : undefined,
        cuentaContableId: cuentaContableId !== undefined ? (parseIntSafe(cuentaContableId) || null) : undefined,
        activo: activo !== undefined ? Boolean(activo) : undefined,
      },
      include: {
        cuentaContable: { select: { codigo: true, nombre: true } },
      },
    });
    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('PUT /bancos/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar cuenta bancaria' });
  }
});

// DELETE /api/bancos/:id — desactivar (no eliminar físico si tiene movimientos)
router.delete('/:id', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const id = parseIntSafe(req.params.id);
    if (!id) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({
      where: { id, empresaId },
      include: { _count: { select: { movimientos: true } } },
    });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    if (cuenta._count.movimientos > 0) {
      // Tiene movimientos: solo desactivar
      await prisma.bancos.update({ where: { id }, data: { activo: false } });
      return res.json({ success: true, mensaje: 'Cuenta bancaria desactivada (tiene movimientos registrados)' });
    }

    await prisma.bancos.delete({ where: { id } });
    res.json({ success: true, mensaje: 'Cuenta bancaria eliminada' });
  } catch (error) {
    console.error('DELETE /bancos/:id:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar cuenta bancaria' });
  }
});

// ============================================================
// MOVIMIENTOS BANCARIOS
// ============================================================

// GET /api/bancos/:id/movimientos — libro de banco (mayorizacion)
router.get('/:id/movimientos', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({ where: { id: bancoId, empresaId } });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    const { fechaDesde, fechaHasta, tipo, conciliado, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { bancoId, empresaId };
    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) where.fecha.gte = new Date(fechaDesde);
      if (fechaHasta) {
        const fd = new Date(fechaHasta);
        fd.setHours(23, 59, 59, 999);
        where.fecha.lte = fd;
      }
    }
    if (tipo) where.tipo = tipo.toUpperCase();
    if (conciliado !== undefined) where.conciliado = conciliado === 'true';

    const [total, movimientos] = await Promise.all([
      prisma.movimientos_bancarios.count({ where }),
      prisma.movimientos_bancarios.findMany({
        where,
        include: {
          cheque: { select: { numero: true, beneficiario: true, estado: true } },
        },
        orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
        skip,
        take: parseInt(limit),
      }),
    ]);

    // Calcular saldo acumulado desde saldoInicial
    let saldoAcumulado = parseFloat(cuenta.saldoInicial);
    const movimientosConSaldo = movimientos.map((m) => {
      saldoAcumulado += parseFloat(m.debe) - parseFloat(m.haber);
      return { ...m, saldoAcumulado };
    });

    res.json({
      success: true,
      data: movimientosConSaldo,
      meta: { total, page: parseInt(page), limit: parseInt(limit), saldoInicial: parseFloat(cuenta.saldoInicial) },
    });
  } catch (error) {
    console.error('GET /bancos/:id/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener movimientos' });
  }
});

// POST /api/bancos/:id/movimientos — registrar movimiento
router.post('/:id/movimientos', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({ where: { id: bancoId, empresaId } });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    const { fecha, tipo, concepto, referencia, debe, haber, observaciones, cuentaContrapartidaId } = req.body;

    const TIPOS_VALIDOS = ['DEPOSITO', 'RETIRO', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT', 'CHEQUE', 'NOTA_DEBITO', 'NOTA_CREDITO', 'AJUSTE'];
    if (!TIPOS_VALIDOS.includes(String(tipo).toUpperCase())) {
      return res.status(400).json({ success: false, mensaje: `Tipo inválido. Válidos: ${TIPOS_VALIDOS.join(', ')}` });
    }
    if (!concepto) return res.status(400).json({ success: false, mensaje: 'concepto es obligatorio' });

    const debeNum  = parseFloat(debe)  || 0;
    const haberNum = parseFloat(haber) || 0;
    if (debeNum < 0 || haberNum < 0) {
      return res.status(400).json({ success: false, mensaje: 'Los valores debe/haber no pueden ser negativos' });
    }
    if (debeNum === 0 && haberNum === 0) {
      return res.status(400).json({ success: false, mensaje: 'Ingrese un valor en debe o haber' });
    }

    const tipoNorm = String(tipo).toUpperCase();
    const fechaMov = fecha ? new Date(fecha) : new Date();
    const numero = await siguienteNumeroGenerico({
      modelo: 'movimientos_bancarios',
      prefijo: PREFIJO_COMPROBANTE[tipoNorm] || 'MOV',
      empresaId, fecha: fechaMov,
    });

    const nuevo = await prisma.movimientos_bancarios.create({
      data: {
        bancoId,
        empresaId,
        fecha: fechaMov,
        tipo: tipoNorm,
        numero,
        concepto: String(concepto).trim(),
        referencia: referencia ? String(referencia).trim() : null,
        debe: debeNum,
        haber: haberNum,
        observaciones: observaciones ? String(observaciones).trim() : null,
      },
    });

    if (cuentaContrapartidaId) {
      try {
        await crearAsientoMovimientoBancario({
          movimientoId: nuevo.id,
          cuentaContrapartidaId: parseIntSafe(cuentaContrapartidaId),
          usuarioId: req.usuario?.id || null,
          fecha: nuevo.fecha,
          db: req.prisma,
        });
      } catch (contErr) {
        console.error('Error creando asiento de movimiento bancario:', contErr.message);
      }
    }

    res.status(201).json({ success: true, data: nuevo });
  } catch (error) {
    console.error('POST /bancos/:id/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'Error al registrar movimiento' });
  }
});

// PATCH /api/bancos/movimientos/:movId/conciliar — marcar/desmarcar conciliado
router.patch('/movimientos/:movId/conciliar', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const movId = parseIntSafe(req.params.movId);
    if (!movId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { conciliado } = req.body;
    const mov = await prisma.movimientos_bancarios.findFirst({ where: { id: movId, empresaId } });
    if (!mov) return res.status(404).json({ success: false, mensaje: 'Movimiento no encontrado' });

    await prisma.movimientos_bancarios.update({ where: { id: movId }, data: { conciliado: Boolean(conciliado) } });
    res.json({ success: true });
  } catch (error) {
    console.error('PATCH /bancos/movimientos/:movId/conciliar:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar conciliación' });
  }
});

// PATCH /api/bancos/:id/movimientos/conciliar-lote — conciliar/desconciliar múltiples
router.patch('/:id/movimientos/conciliar-lote', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { ids, conciliado } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'ids debe ser un arreglo no vacío' });
    }

    const result = await prisma.movimientos_bancarios.updateMany({
      where: { id: { in: ids.map((id) => parseInt(id, 10)) }, bancoId, empresaId },
      data: { conciliado: Boolean(conciliado) },
    });
    res.json({ success: true, data: { count: result.count } });
  } catch (error) {
    console.error('PATCH /bancos/:id/movimientos/conciliar-lote:', error);
    res.status(500).json({ success: false, mensaje: 'Error al conciliar movimientos' });
  }
});

// DELETE /api/bancos/movimientos/:movId — eliminar movimiento manual
router.delete('/movimientos/:movId', autorizarPermiso('bancos.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const movId = parseIntSafe(req.params.movId);
    if (!movId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const mov = await prisma.movimientos_bancarios.findFirst({ where: { id: movId, empresaId } });
    if (!mov) return res.status(404).json({ success: false, mensaje: 'Movimiento no encontrado' });
    if (mov.asientoId || mov.chequeId) {
      return res.status(400).json({ success: false, mensaje: 'No se puede eliminar un movimiento generado automáticamente' });
    }

    await prisma.movimientos_bancarios.delete({ where: { id: movId } });
    res.json({ success: true, mensaje: 'Movimiento eliminado' });
  } catch (error) {
    console.error('DELETE /bancos/movimientos/:movId:', error);
    res.status(500).json({ success: false, mensaje: 'Error al eliminar movimiento' });
  }
});

// GET /api/bancos/:id/saldo — saldo actual de la cuenta
router.get('/:id/saldo', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({ where: { id: bancoId, empresaId } });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    const agg = await prisma.movimientos_bancarios.aggregate({
      where: { bancoId, empresaId },
      _sum: { debe: true, haber: true },
    });

    const totalDebe  = parseFloat(agg._sum.debe  || 0);
    const totalHaber = parseFloat(agg._sum.haber || 0);
    const saldo = parseFloat(cuenta.saldoInicial) + totalDebe - totalHaber;

    res.json({
      success: true,
      data: {
        id: cuenta.id,
        nombre: cuenta.nombre,
        saldoInicial: parseFloat(cuenta.saldoInicial),
        totalDebe,
        totalHaber,
        saldoActual: saldo,
      },
    });
  } catch (error) {
    console.error('GET /bancos/:id/saldo:', error);
    res.status(500).json({ success: false, mensaje: 'Error al calcular saldo' });
  }
});

// ============================================================
// CHEQUES
// ============================================================

// GET /api/bancos/cheques — lista de cheques de la empresa
router.get('/cheques/lista', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const { bancoId, estado, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { empresaId };
    if (bancoId) where.bancoId = parseIntSafe(bancoId);
    if (estado) where.estado = estado.toUpperCase();

    const [total, cheques] = await Promise.all([
      prisma.cheques.count({ where }),
      prisma.cheques.findMany({
        where,
        include: {
          banco: { select: { nombre: true, banco: true } },
          proveedor: { select: { razonSocial: true, identificacion: true } },
        },
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        skip,
        take: parseInt(limit),
      }),
    ]);

    res.json({ success: true, data: cheques, meta: { total, page: parseInt(page), limit: parseInt(limit) } });
  } catch (error) {
    console.error('GET /bancos/cheques/lista:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener cheques' });
  }
});

// GET /api/bancos/:id/cheques — cheques de un banco específico
router.get('/:id/cheques', autorizarPermiso('bancos.ver'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const { estado } = req.query;
    const where = { bancoId, empresaId };
    if (estado) where.estado = estado.toUpperCase();

    const cheques = await prisma.cheques.findMany({
      where,
      include: {
        proveedor: { select: { razonSocial: true, identificacion: true } },
      },
      orderBy: [{ fecha: 'desc' }, { numero: 'asc' }],
    });
    res.json({ success: true, data: cheques });
  } catch (error) {
    console.error('GET /bancos/:id/cheques:', error);
    res.status(500).json({ success: false, mensaje: 'Error al obtener cheques' });
  }
});

// POST /api/bancos/:id/cheques — emitir cheque
router.post('/:id/cheques', autorizarPermiso('cheques.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const bancoId = parseIntSafe(req.params.id);
    if (!bancoId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const cuenta = await prisma.bancos.findFirst({ where: { id: bancoId, empresaId } });
    if (!cuenta) return res.status(404).json({ success: false, mensaje: 'Cuenta bancaria no encontrada' });

    const { numero, beneficiario, fecha, fechaVencimiento, monto, concepto, proveedorId, cuentaContrapartidaId } = req.body;
    if (!numero || !beneficiario || !monto) {
      return res.status(400).json({ success: false, mensaje: 'numero, beneficiario y monto son obligatorios' });
    }

    let movimientoId = null;
    const cheque = await prisma.$transaction(async (tx) => {
      const nuevoCheque = await tx.cheques.create({
        data: {
          bancoId,
          empresaId,
          numero: String(numero).trim(),
          beneficiario: String(beneficiario).trim(),
          fecha: fecha ? new Date(fecha) : new Date(),
          fechaVencimiento: fechaVencimiento ? new Date(fechaVencimiento) : null,
          monto: parseFloat(monto),
          concepto: concepto ? String(concepto).trim() : null,
          estado: 'PENDIENTE',
          proveedorId: proveedorId ? parseIntSafe(proveedorId) : null,
          usuarioId: req.usuario?.id || null,
        },
      });

      // Registrar movimiento de banco automáticamente
      const numeroComprobante = await siguienteNumeroGenerico({
        modelo: 'movimientos_bancarios', prefijo: PREFIJO_COMPROBANTE.CHEQUE,
        empresaId, fecha: nuevoCheque.fecha, tx,
      });
      const movimiento = await tx.movimientos_bancarios.create({
        data: {
          bancoId,
          empresaId,
          fecha: nuevoCheque.fecha,
          tipo: 'CHEQUE',
          numero: numeroComprobante,
          concepto: `Cheque #${nuevoCheque.numero} - ${nuevoCheque.beneficiario}`,
          referencia: nuevoCheque.numero,
          debe: 0,
          haber: parseFloat(monto),
          chequeId: nuevoCheque.id,
        },
      });
      movimientoId = movimiento.id;

      return nuevoCheque;
    });

    if (cuentaContrapartidaId) {
      try {
        await crearAsientoMovimientoBancario({
          movimientoId,
          cuentaContrapartidaId: parseIntSafe(cuentaContrapartidaId),
          usuarioId: req.usuario?.id || null,
          fecha: cheque.fecha,
          db: req.prisma,
        });
      } catch (contErr) {
        console.error('Error creando asiento de cheque:', contErr.message);
      }
    }

    res.status(201).json({ success: true, data: cheque });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: 'Ya existe un cheque con ese número en esta cuenta' });
    }
    console.error('POST /bancos/:id/cheques:', error);
    res.status(500).json({ success: false, mensaje: 'Error al emitir cheque' });
  }
});

// PATCH /api/bancos/cheques/:chequeId/estado — cambiar estado del cheque
router.patch('/cheques/:chequeId/estado', autorizarPermiso('cheques.gestionar'), async (req, res) => {
  try {
    const empresaId = obtenerEmpresaId(req);
    const chequeId = parseIntSafe(req.params.chequeId);
    if (!chequeId) return res.status(400).json({ success: false, mensaje: 'ID inválido' });

    const ESTADOS_VALIDOS = ['PENDIENTE', 'COBRADO', 'ANULADO', 'PROTESTADO'];
    const { estado } = req.body;
    if (!ESTADOS_VALIDOS.includes(String(estado).toUpperCase())) {
      return res.status(400).json({ success: false, mensaje: `Estado inválido. Válidos: ${ESTADOS_VALIDOS.join(', ')}` });
    }

    const cheque = await prisma.cheques.findFirst({ where: { id: chequeId, empresaId } });
    if (!cheque) return res.status(404).json({ success: false, mensaje: 'Cheque no encontrado' });

    const actualizado = await prisma.cheques.update({
      where: { id: chequeId },
      data: { estado: estado.toUpperCase() },
    });
    res.json({ success: true, data: actualizado });
  } catch (error) {
    console.error('PATCH /bancos/cheques/:chequeId/estado:', error);
    res.status(500).json({ success: false, mensaje: 'Error al actualizar estado del cheque' });
  }
});

module.exports = router;
