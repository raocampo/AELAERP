/**
 * AELA — Anticipos de Clientes y Proveedores
 * /api/anticipos/clientes  — anticipos recibidos de clientes (antes de facturar)
 * /api/anticipos/proveedores — anticipos pagados a proveedores (antes de recibir factura)
 */
const express = require('express');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloMediumOPro } = require('../middleware/edition');
const {
  crearAsientoAnticipoCliente,
  crearAsientoAnticipoProveedor,
  crearAsientoReversoAnticipoCliente,
  crearAsientoReversoAnticipoProveedor,
  siguienteNumeroGenerico,
  round2,
} = require('../utils/contabilidad');

const router = express.Router();

router.use(proteger);
router.use(soloMediumOPro);

function db(req) { return req.prisma; }
function empresaId(req) { return req.empresa?.id ?? req.usuario?.empresaId ?? 1; }
function usuarioId(req) { return req.usuario?.id; }

const METODOS_VALIDOS = ['efectivo', 'transferencia', 'cheque', 'tarjeta'];

// ════════════════════════════════════════════════════════════════════
// ANTICIPOS DE CLIENTES
// ════════════════════════════════════════════════════════════════════

// GET /api/anticipos/clientes?estado=pendientes|todos
router.get('/clientes', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const solo = req.query.estado === 'todos' ? undefined : 'pendientes';

    const anticipos = await db(req).anticipos_cliente.findMany({
      where: {
        empresaId: empId,
        anulado: false,
        ...(solo === 'pendientes' ? { saldoPendiente: { gt: 0 } } : {}),
      },
      include: { cliente: { select: { id: true, identificacion: true, razonSocial: true } } },
      orderBy: { fecha: 'desc' },
    });

    res.json({ success: true, data: anticipos });
  } catch (err) {
    console.error('GET /anticipos/clientes:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener los anticipos' });
  }
});

// GET /api/anticipos/clientes/historial — todos incluyendo anulados
router.get('/clientes/historial', autorizarPermiso('cxc.ver'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const anticipos = await db(req).anticipos_cliente.findMany({
      where: { empresaId: empId },
      include: { cliente: { select: { id: true, identificacion: true, razonSocial: true } } },
      orderBy: { fecha: 'desc' },
    });
    res.json({ success: true, data: anticipos });
  } catch (err) {
    console.error('GET /anticipos/clientes/historial:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial' });
  }
});

// POST /api/anticipos/clientes
router.post('/clientes', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const { clienteId, nombreCliente, monto, fecha, metodoPago, referencia, observaciones } = req.body;

    if (!nombreCliente?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre del cliente es requerido' });
    const montoNum = round2(parseFloat(monto));
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });
    if (!METODOS_VALIDOS.includes(metodoPago)) return res.status(400).json({ success: false, mensaje: 'Método de pago inválido' });

    const fechaDate = fecha ? new Date(fecha) : new Date();

    const numero = await siguienteNumeroGenerico({
      modelo: db(req).anticipos_cliente,
      prefijo: 'ANT-CLI',
      empresaId: empId,
      fecha: fechaDate,
      tx: db(req),
    });

    const anticipo = await db(req).anticipos_cliente.create({
      data: {
        empresaId: empId,
        clienteId: clienteId ? Number(clienteId) : null,
        nombreCliente: nombreCliente.trim(),
        numero,
        fecha: fechaDate,
        monto: montoNum,
        saldoPendiente: montoNum,
        metodoPago,
        referencia: referencia?.trim() || null,
        observaciones: observaciones?.trim() || null,
        usuarioId: usuarioId(req),
      },
    });

    await crearAsientoAnticipoCliente({ anticipoId: anticipo.id, usuarioId: usuarioId(req), fecha: fechaDate, db: db(req) });

    res.status(201).json({ success: true, data: anticipo, mensaje: `Anticipo ${numero} registrado` });
  } catch (err) {
    console.error('POST /anticipos/clientes:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'No se pudo registrar el anticipo' });
  }
});

// PATCH /api/anticipos/clientes/:id/anular
router.patch('/clientes/:id/anular', autorizarPermiso('cxc.gestionar'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const id = Number(req.params.id);
    const { motivo } = req.body;

    const anticipo = await db(req).anticipos_cliente.findFirst({ where: { id, empresaId: empId } });
    if (!anticipo) return res.status(404).json({ success: false, mensaje: 'Anticipo no encontrado' });
    if (anticipo.anulado) return res.status(400).json({ success: false, mensaje: 'El anticipo ya está anulado' });

    await crearAsientoReversoAnticipoCliente({ anticipoId: id, usuarioId: usuarioId(req), db: db(req) });

    await db(req).anticipos_cliente.update({
      where: { id },
      data: { anulado: true, saldoPendiente: 0, motivoAnulacion: motivo?.trim() || null },
    });

    res.json({ success: true, mensaje: `Anticipo ${anticipo.numero} anulado` });
  } catch (err) {
    console.error('PATCH /anticipos/clientes/:id/anular:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'No se pudo anular el anticipo' });
  }
});

// ════════════════════════════════════════════════════════════════════
// ANTICIPOS A PROVEEDORES
// ════════════════════════════════════════════════════════════════════

// GET /api/anticipos/proveedores?estado=pendientes|todos
router.get('/proveedores', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const solo = req.query.estado === 'todos' ? undefined : 'pendientes';

    const anticipos = await db(req).anticipos_proveedor.findMany({
      where: {
        empresaId: empId,
        anulado: false,
        ...(solo === 'pendientes' ? { saldoPendiente: { gt: 0 } } : {}),
      },
      include: { proveedor: { select: { id: true, identificacion: true, razonSocial: true } } },
      orderBy: { fecha: 'desc' },
    });

    res.json({ success: true, data: anticipos });
  } catch (err) {
    console.error('GET /anticipos/proveedores:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener los anticipos' });
  }
});

// GET /api/anticipos/proveedores/historial — todos incluyendo anulados
router.get('/proveedores/historial', autorizarPermiso('cxp.ver'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const anticipos = await db(req).anticipos_proveedor.findMany({
      where: { empresaId: empId },
      include: { proveedor: { select: { id: true, identificacion: true, razonSocial: true } } },
      orderBy: { fecha: 'desc' },
    });
    res.json({ success: true, data: anticipos });
  } catch (err) {
    console.error('GET /anticipos/proveedores/historial:', err);
    res.status(500).json({ success: false, mensaje: 'No se pudo obtener el historial' });
  }
});

// POST /api/anticipos/proveedores
router.post('/proveedores', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const { proveedorId, nombreProveedor, monto, fecha, metodoPago, referencia, observaciones } = req.body;

    if (!nombreProveedor?.trim()) return res.status(400).json({ success: false, mensaje: 'El nombre del proveedor es requerido' });
    const montoNum = round2(parseFloat(monto));
    if (!(montoNum > 0)) return res.status(400).json({ success: false, mensaje: 'El monto debe ser mayor a cero' });
    if (!METODOS_VALIDOS.includes(metodoPago)) return res.status(400).json({ success: false, mensaje: 'Método de pago inválido' });

    const fechaDate = fecha ? new Date(fecha) : new Date();

    const numero = await siguienteNumeroGenerico({
      modelo: db(req).anticipos_proveedor,
      prefijo: 'ANT-PRV',
      empresaId: empId,
      fecha: fechaDate,
      tx: db(req),
    });

    const anticipo = await db(req).anticipos_proveedor.create({
      data: {
        empresaId: empId,
        proveedorId: proveedorId ? Number(proveedorId) : null,
        nombreProveedor: nombreProveedor.trim(),
        numero,
        fecha: fechaDate,
        monto: montoNum,
        saldoPendiente: montoNum,
        metodoPago,
        referencia: referencia?.trim() || null,
        observaciones: observaciones?.trim() || null,
        usuarioId: usuarioId(req),
      },
    });

    await crearAsientoAnticipoProveedor({ anticipoId: anticipo.id, usuarioId: usuarioId(req), fecha: fechaDate, db: db(req) });

    res.status(201).json({ success: true, data: anticipo, mensaje: `Anticipo ${numero} registrado` });
  } catch (err) {
    console.error('POST /anticipos/proveedores:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'No se pudo registrar el anticipo' });
  }
});

// PATCH /api/anticipos/proveedores/:id/anular
router.patch('/proveedores/:id/anular', autorizarPermiso('cxp.gestionar'), async (req, res) => {
  try {
    const empId = empresaId(req);
    const id = Number(req.params.id);
    const { motivo } = req.body;

    const anticipo = await db(req).anticipos_proveedor.findFirst({ where: { id, empresaId: empId } });
    if (!anticipo) return res.status(404).json({ success: false, mensaje: 'Anticipo no encontrado' });
    if (anticipo.anulado) return res.status(400).json({ success: false, mensaje: 'El anticipo ya está anulado' });

    await crearAsientoReversoAnticipoProveedor({ anticipoId: id, usuarioId: usuarioId(req), db: db(req) });

    await db(req).anticipos_proveedor.update({
      where: { id },
      data: { anulado: true, saldoPendiente: 0, motivoAnulacion: motivo?.trim() || null },
    });

    res.json({ success: true, mensaje: `Anticipo ${anticipo.numero} anulado` });
  } catch (err) {
    console.error('PATCH /anticipos/proveedores/:id/anular:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'No se pudo anular el anticipo' });
  }
});

module.exports = router;
