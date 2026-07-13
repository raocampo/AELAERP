// ====================================
// RUTAS: PANEL SUPER-ADMIN SaaS
// backend/routes/superAdmin.js
// Protegido por SUPER_ADMIN_KEY (variable de entorno)
// Accede a la BD master (aela_master) — catálogo de tenants
// ====================================

const express = require('express');
const router  = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');

// ─── Middleware: verificar clave de super-admin ───────────────────────────────
function verificarSuperAdmin(req, res, next) {
  const key = process.env.SUPER_ADMIN_KEY;
  if (!key) {
    return res.status(503).json({ success: false, mensaje: 'Panel admin no configurado (falta SUPER_ADMIN_KEY)' });
  }
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== key) {
    return res.status(401).json({ success: false, mensaje: 'Clave de administración inválida' });
  }
  next();
}

function getMaster(res) {
  const m = getPrismaMaster();
  if (!m) res.status(503).json({ success: false, mensaje: 'Base de datos master no disponible' });
  return m;
}

function sinDbPass({ dbPass, ...t }) {
  return { ...t, dbPassMasked: dbPass ? '••••••••' : null };
}

// ─── Verificar clave (usado por el login del panel) ──────────────────────────
// POST /api/super-admin/verificar
router.post('/verificar', (req, res) => {
  const key   = process.env.SUPER_ADMIN_KEY;
  const { clave } = req.body;
  if (!key) return res.status(503).json({ success: false, mensaje: 'Panel admin no configurado' });
  if (!clave || clave !== key) {
    return res.status(401).json({ success: false, mensaje: 'Clave incorrecta' });
  }
  res.json({ success: true });
});

// ─── Estadísticas globales ────────────────────────────────────────────────────
// GET /api/super-admin/stats
router.get('/stats', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const [total, activos, trial, suspendidos, vencidos, provisioning] = await Promise.all([
      master.tenants.count(),
      master.tenants.count({ where: { estado: 'activo', esTrial: false } }),
      master.tenants.count({ where: { esTrial: true } }),
      master.tenants.count({ where: { estado: 'suspendido' } }),
      master.tenants.count({ where: { estado: 'vencido' } }),
      master.tenants.count({ where: { estado: 'provisioning' } }),
    ]);
    res.json({ success: true, data: { total, activos, trial, suspendidos, vencidos, provisioning } });
  } catch (err) {
    console.error('superAdmin stats:', err);
    res.status(500).json({ success: false, mensaje: 'Error al obtener estadísticas' });
  }
});

// ─── Listar tenants ───────────────────────────────────────────────────────────
// GET /api/super-admin/tenants
router.get('/tenants', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenants = await master.tenants.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        suscripciones: {
          where:   { estado: 'activo' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { suscripciones: true } },
      },
    });
    res.json({ success: true, data: tenants.map(sinDbPass) });
  } catch (err) {
    console.error('superAdmin tenants list:', err);
    res.status(500).json({ success: false, mensaje: 'Error al listar tenants' });
  }
});

// ─── Detalle de un tenant ─────────────────────────────────────────────────────
// GET /api/super-admin/tenants/:id
router.get('/tenants/:id', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenant = await master.tenants.findUnique({
      where:   { id: parseInt(req.params.id, 10) },
      include: { suscripciones: { orderBy: { createdAt: 'desc' } } },
    });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
    res.json({ success: true, data: sinDbPass(tenant) });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener tenant' });
  }
});

// ─── Actualizar tenant ────────────────────────────────────────────────────────
// PUT /api/super-admin/tenants/:id
router.put('/tenants/:id', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const campos = ['plan', 'estado', 'fechaVencimiento', 'fechaActivacion',
                    'nombreContacto', 'emailContacto', 'telefonoContacto',
                    'esTrial', 'trialExpiresAt', 'autoRenovar', 'periodoFacturacion',
                    'tipoInstancia'];
    const data = {};
    for (const c of campos) {
      if (req.body[c] === undefined) continue;
      if (['fechaVencimiento', 'fechaActivacion', 'trialExpiresAt'].includes(c)) {
        data[c] = req.body[c] ? new Date(req.body[c]) : null;
      } else {
        data[c] = req.body[c];
      }
    }

    // Dominio personalizado (marca blanca) — se guarda dentro de brandConfig.dominio
    if (req.body.dominioPersonalizado !== undefined) {
      const tenantActual = await master.tenants.findUnique({
        where:  { id: parseInt(req.params.id, 10) },
        select: { brandConfig: true },
      });
      const bcActual = (tenantActual?.brandConfig && typeof tenantActual.brandConfig === 'object')
        ? tenantActual.brandConfig
        : {};
      const dominio = String(req.body.dominioPersonalizado || '').trim().toLowerCase();
      data.brandConfig = { ...bcActual, dominio: dominio || null };
    }

    const tenant = await master.tenants.update({
      where: { id: parseInt(req.params.id, 10) },
      data,
    });
    res.json({ success: true, data: sinDbPass(tenant) });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
    res.status(500).json({ success: false, mensaje: 'Error al actualizar tenant' });
  }
});

// ─── Crear suscripción manual ─────────────────────────────────────────────────
// POST /api/super-admin/tenants/:id/suscripciones
router.post('/tenants/:id/suscripciones', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenantId = parseInt(req.params.id, 10);
    const { plan, periodo, monto, fechaFin, pagoReferencia, proveedor } = req.body;

    // Vencer suscripciones activas anteriores
    await master.suscripciones.updateMany({
      where: { tenantId, estado: 'activo' },
      data:  { estado: 'vencido' },
    });

    const sus = await master.suscripciones.create({
      data: {
        tenantId,
        plan:           plan      || 'lite',
        periodo:        periodo   || 'mensual',
        monto:          monto     ? parseFloat(monto) : null,
        fechaFin:       fechaFin  ? new Date(fechaFin) : null,
        pagoReferencia: pagoReferencia || null,
        proveedor:      proveedor || 'manual',
        estado: 'activo',
      },
    });

    // Sincronizar plan + vencimiento en el tenant
    await master.tenants.update({
      where: { id: tenantId },
      data: {
        plan:            plan     || 'lite',
        fechaVencimiento: fechaFin ? new Date(fechaFin) : null,
        estado: 'activo',
        esTrial: false,
      },
    });

    res.status(201).json({ success: true, data: sus });
  } catch (err) {
    console.error('superAdmin crear suscripcion:', err);
    res.status(500).json({ success: false, mensaje: 'Error al crear suscripción' });
  }
});

// ─── Listar solicitudes de pago pendientes ────────────────────────────────────
// GET /api/super-admin/pagos-pendientes
router.get('/pagos-pendientes', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const solicitudes = await master.solicitudes_pago.findMany({
      where:   { estado: { in: ['pendiente', 'revision'] } },
      include: { tenant: { select: { slug: true, emailContacto: true, nombreContacto: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: solicitudes });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── Aprobar pago de suscripción ──────────────────────────────────────────────
// POST /api/super-admin/pagos/:id/aprobar
router.post('/pagos/:id/aprobar', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const { invalidarCacheTenant } = require('../middleware/tenant');
    const solicitud = await master.solicitudes_pago.findUnique({
      where:   { id: parseInt(req.params.id, 10) },
      include: { tenant: true },
    });
    if (!solicitud) return res.status(404).json({ success: false, mensaje: 'Solicitud no encontrada' });

    await master.solicitudes_pago.update({ where: { id: solicitud.id }, data: { estado: 'pagado' } });

    const meses = solicitud.periodo === 'anual' ? 12 : 1;
    const fechaFin = new Date();
    fechaFin.setMonth(fechaFin.getMonth() + meses);

    await master.suscripciones.updateMany({ where: { tenantId: solicitud.tenantId, estado: 'activo' }, data: { estado: 'vencido' } });
    await master.suscripciones.create({
      data: { tenantId: solicitud.tenantId, plan: solicitud.plan, periodo: solicitud.periodo, monto: solicitud.monto, fechaFin, proveedor: solicitud.proveedor, pagoReferencia: solicitud.referencia || null, estado: 'activo', fechaInicio: new Date() },
    });
    await master.tenants.update({
      where: { id: solicitud.tenantId },
      data:  { plan: solicitud.plan, estado: 'activo', esTrial: false, fechaVencimiento: fechaFin, fechaActivacion: new Date() },
    });
    invalidarCacheTenant(solicitud.tenant.slug);

    res.json({ success: true, mensaje: 'Suscripción activada' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── Generar API key para un tenant (WebServices) ────────────────────────────
// POST /api/super-admin/tenants/:id/apikey
router.post('/tenants/:id/apikey', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenantId = parseInt(req.params.id, 10);
    const tenant = await master.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const { randomBytes } = require('crypto');
    const apiKey = `aela_${randomBytes(24).toString('hex')}`;

    const bcActual = (tenant.brandConfig && typeof tenant.brandConfig === 'object') ? tenant.brandConfig : {};
    await master.tenants.update({
      where: { id: tenantId },
      data:  { brandConfig: { ...bcActual, apiKey } },
    });

    res.json({ success: true, data: { apiKey } });
  } catch (err) {
    console.error('superAdmin generar apikey:', err);
    res.status(500).json({ success: false, mensaje: 'Error al generar API key' });
  }
});

// ─── Revocar API key de un tenant ────────────────────────────────────────────
// DELETE /api/super-admin/tenants/:id/apikey
router.delete('/tenants/:id/apikey', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenantId = parseInt(req.params.id, 10);
    const tenant = await master.tenants.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const bcActual = (tenant.brandConfig && typeof tenant.brandConfig === 'object') ? tenant.brandConfig : {};
    const { apiKey: _removed, ...bcSinKey } = bcActual;
    await master.tenants.update({
      where: { id: tenantId },
      data:  { brandConfig: bcSinKey },
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al revocar API key' });
  }
});

module.exports = router;
