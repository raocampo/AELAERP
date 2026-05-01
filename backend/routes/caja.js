const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { asegurarConfiguracionSistemaEmpresa } = require('../utils/configuracionSistema');
const {
  normalizarFechaOperacion,
  obtenerOCrearCajaDelDia,
  registrarMovimientoCaja,
  obtenerCajaConResumen,
} = require('../utils/caja');

router.use(proteger);

const permitirVerCaja = autorizarPermiso('caja.ver');
const permitirGestionarCaja = autorizarPermiso('caja.gestionar');

async function validarCajaHabilitada(req, res, next) {
  try {
    const config = await asegurarConfiguracionSistemaEmpresa(req.empresa.id);
    if (!config?.cajaDiariaHabilitada) {
      return res.status(403).json({
        success: false,
        mensaje: 'La caja diaria está deshabilitada en la configuración del sistema',
      });
    }
    req.configuracionSistema = config;
    next();
  } catch (error) {
    console.error('validarCajaHabilitada:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo validar la caja diaria' });
  }
}

router.get('/resumen', permitirVerCaja, validarCajaHabilitada, async (req, res) => {
  try {
    const fecha = req.query.fecha ? new Date(req.query.fecha) : new Date();
    const data = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha });
    res.json({ success: true, data });
  } catch (error) {
    console.error('GET /caja/resumen:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el resumen de caja' });
  }
});

router.get('/historial', permitirVerCaja, validarCajaHabilitada, async (req, res) => {
  try {
    const items = await prisma.cajas_diarias.findMany({
      where: { empresaId: req.empresa.id },
      include: {
        usuarioApertura: { select: { id: true, nombre: true, username: true } },
        usuarioCierre: { select: { id: true, nombre: true, username: true } },
      },
      orderBy: [{ fechaOperacion: 'desc' }, { id: 'desc' }],
      take: 30,
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /caja/historial:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cargar el historial de caja' });
  }
});

router.post('/apertura', permitirGestionarCaja, validarCajaHabilitada, async (req, res) => {
  try {
    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    const fechaOperacion = normalizarFechaOperacion(fecha);
    const montoApertura = Number(req.body?.montoApertura || 0);
    const observacionesApertura = req.body?.observacionesApertura || null;

    const caja = await obtenerOCrearCajaDelDia({
      empresaId: req.empresa.id,
      fecha: fechaOperacion,
      nombreCaja: req.configuracionSistema.cajaNombre,
    });

    if (caja.estado === 'CERRADA') {
      return res.status(400).json({ success: false, mensaje: 'La caja del día ya fue cerrada' });
    }

    if (caja.aperturaRegistrada) {
      return res.status(400).json({ success: false, mensaje: 'La apertura de caja ya fue registrada para este día' });
    }

    const actualizada = await prisma.cajas_diarias.update({
      where: { id: caja.id },
      data: {
        montoApertura,
        aperturaRegistrada: true,
        observacionesApertura,
        usuarioAperturaId: req.usuario.id,
        openedAt: new Date(),
        estado: 'ABIERTA',
      },
    });

    if (montoApertura > 0) {
      await registrarMovimientoCaja({
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha,
        tipo: 'APERTURA',
        monto: montoApertura,
        descripcion: 'Apertura de caja',
        referencia: `CAJA-${actualizada.id}-APERTURA`,
      });
    }

    const data = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha });
    res.status(201).json({ success: true, data, mensaje: 'Apertura de caja registrada' });
  } catch (error) {
    console.error('POST /caja/apertura:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo registrar la apertura de caja' });
  }
});

router.post('/movimientos', permitirGestionarCaja, validarCajaHabilitada, async (req, res) => {
  try {
    const { tipo, monto, descripcion, categoria, fecha, referencia } = req.body || {};
    if (!['INGRESO', 'EGRESO'].includes(tipo)) {
      return res.status(400).json({ success: false, mensaje: 'Tipo de movimiento inválido' });
    }

    const montoNum = Number(monto || 0);
    if (montoNum <= 0) {
      return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a 0' });
    }

    const dataCaja = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha: fecha || new Date() });
    if (dataCaja?.caja?.estado === 'CERRADA') {
      return res.status(400).json({ success: false, mensaje: 'La caja del día se encuentra cerrada' });
    }

    const movimiento = await registrarMovimientoCaja({
      empresaId: req.empresa.id,
      usuarioId: req.usuario.id,
      fecha: fecha || new Date(),
      tipo,
      monto: montoNum,
      descripcion: descripcion || (tipo === 'INGRESO' ? 'Ingreso manual de caja' : 'Egreso manual de caja'),
      categoria: categoria || 'MANUAL',
      referencia: referencia || null,
    });

    const data = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha: fecha || new Date() });
    res.status(201).json({ success: true, data: { movimiento, caja: data }, mensaje: 'Movimiento registrado' });
  } catch (error) {
    console.error('POST /caja/movimientos:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo registrar el movimiento de caja' });
  }
});

router.post('/cierre', permitirGestionarCaja, validarCajaHabilitada, async (req, res) => {
  try {
    const fecha = req.body?.fecha ? new Date(req.body.fecha) : new Date();
    const dataCaja = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha });

    if (!dataCaja?.caja) {
      return res.status(404).json({ success: false, mensaje: 'No existe caja para la fecha indicada' });
    }

    if (dataCaja.caja.estado === 'CERRADA') {
      return res.status(400).json({ success: false, mensaje: 'La caja del día ya fue cerrada' });
    }

    const montoCierreReal = Number(req.body?.montoCierreReal || 0);
    const diferenciaCierre = Number((montoCierreReal - Number(dataCaja.resumen.totalEsperado || 0)).toFixed(2));

    const actualizada = await prisma.cajas_diarias.update({
      where: { id: dataCaja.caja.id },
      data: {
        estado: 'CERRADA',
        montoCierreReal,
        diferenciaCierre,
        observacionesCierre: req.body?.observacionesCierre || null,
        usuarioCierreId: req.usuario.id,
        closedAt: new Date(),
      },
    });

    const data = await obtenerCajaConResumen({ empresaId: req.empresa.id, fecha });
    res.json({ success: true, data: { ...data, caja: actualizada }, mensaje: 'Caja cerrada correctamente' });
  } catch (error) {
    console.error('POST /caja/cierre:', error);
    res.status(500).json({ success: false, mensaje: 'No se pudo cerrar la caja' });
  }
});

module.exports = router;
