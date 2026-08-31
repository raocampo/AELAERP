// ====================================
// RUTAS: PANEL SUPER-ADMIN SaaS
// backend/routes/superAdmin.js
// Protegido por SUPER_ADMIN_KEY (variable de entorno)
// Accede a la BD master (aela_master) — catálogo de tenants
// ====================================

const express = require('express');
const router  = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma } = require('../config/prismaTenant');
const { provisionarTenant, actualizarModulosContratadosTenant, actualizarLimitesTenant } = require('../utils/provisionarTenant');
const { MODULOS_TODOS } = require('../utils/configuracionSistema');
const { crearEmpresaYAdminInicial } = require('../utils/bootstrapEmpresa');
const { obtenerEmpresaSri } = require('../utils/sriContribuyente');

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

// ─── Consultar RUC en el SRI (para precargar el formulario de "Crear cliente") ─
// GET /api/super-admin/consultar-sri/:ruc
router.get('/consultar-sri/:ruc', verificarSuperAdmin, async (req, res) => {
  try {
    const ruc = String(req.params.ruc || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(ruc)) {
      return res.status(400).json({ success: false, mensaje: 'El RUC debe tener 13 dígitos' });
    }
    const empresaSri = await obtenerEmpresaSri(ruc);
    if (!empresaSri) {
      return res.json({ success: true, data: { encontrado: false, mensaje: 'No se encontró información en el SRI para ese RUC' } });
    }
    res.json({
      success: true,
      data: { encontrado: true, fuente: empresaSri.fuenteLocal ? 'local' : 'sri', ...empresaSri },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: 'Error al consultar el SRI' });
  }
});

// ─── Crear tenant (cliente) manualmente ──────────────────────────────────────
// POST /api/super-admin/tenants — equivalente autenticado de POST /api/registro
// (registro público de la landing page), para cuando el operador da de alta un
// cliente directamente en vez de que el cliente use el formulario de la web.
// Reusa el mismo provisionarTenant() — crea la BD del tenant y lo deja listo.
//
// Opcionalmente, si se envían `admin` (nombre/username/email/password) y
// `empresa` (ruc + datos), se completa también el bootstrap inicial (empresa +
// usuario admin) en el momento — el operador entrega usuario/contraseña ya
// listos y el cliente nunca pasa por la pantalla de configuración inicial.
// Si no se envían, el tenant queda igual que en el registro público: listo
// para que alguien complete ese primer paso entrando a la URL de acceso.
router.post('/tenants', verificarSuperAdmin, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const {
      nombreEmpresa, emailContacto, telefonoContacto, nombreContacto,
      plan = 'lite', slugForzado, esTrial, modulosContratados,
      admin, empresa: empresaDatos,
    } = req.body;

    if (!nombreEmpresa?.trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre de la empresa es requerido' });
    }
    const planesValidos = ['lite', 'medium', 'pro'];
    if (!planesValidos.includes(plan)) {
      return res.status(400).json({ success: false, mensaje: 'Plan inválido' });
    }

    let slugLimpio = null;
    if (slugForzado?.trim()) {
      slugLimpio = slugForzado.trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(slugLimpio)) {
        return res.status(400).json({
          success: false,
          mensaje: 'La URL de acceso debe tener entre 3 y 30 caracteres, usar solo letras, números y guiones, y no empezar ni terminar con guion.',
        });
      }
      const existeSlug = await master.tenants.findUnique({ where: { slug: slugLimpio } });
      if (existeSlug) {
        return res.status(409).json({ success: false, mensaje: `Ya existe un tenant con la URL "${slugLimpio}".` });
      }
    }

    // A diferencia del registro público (donde plan!=lite implica trial
    // automático de 15 días), acá el operador decide explícitamente — un
    // cliente dado de alta a mano suele ser ya un acuerdo cerrado, no un
    // funnel de autoservicio.
    const esTrialFinal   = Boolean(esTrial);
    const trialExpiresAt = esTrialFinal ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000) : null;

    const tenant = await provisionarTenant({
      nombreEmpresa:    nombreEmpresa.trim(),
      plan,
      esTrial:          esTrialFinal,
      trialExpiresAt,
      emailContacto:    emailContacto?.trim().toLowerCase() || null,
      telefonoContacto: telefonoContacto?.trim() || null,
      nombreContacto:   nombreContacto?.trim() || nombreEmpresa.trim(),
      slugForzado:      slugLimpio,
    });

    let tenantFinal = tenant;
    if (Array.isArray(modulosContratados)) {
      const modulos = modulosContratados.filter((m) => MODULOS_TODOS.includes(m));
      tenantFinal = await actualizarModulosContratadosTenant(tenant.slug, modulos);
    }

    const appBase  = process.env.APP_BASE_URL || 'https://aela.corpsimtelec.com';
    const data = { ...sinDbPass(tenantFinal), urlAcceso: `${appBase}/${tenantFinal.slug}` };

    if (admin?.username && admin?.password && empresaDatos?.ruc) {
      try {
        const prismaT = await getTenantPrisma(tenantFinal);
        const { empresa, usuario } = await crearEmpresaYAdminInicial(prismaT, {
          ...admin,
          ...empresaDatos,
          plan,
        });
        data.empresaCreada = empresa;
        data.usuarioCreado = { id: usuario.id, nombre: usuario.nombre, username: usuario.username, email: usuario.email };
      } catch (errBootstrap) {
        // El tenant YA existe y quedó activo — solo falló el paso de crear la
        // empresa/admin. No se revierte el provisioning; el operador puede
        // completar ese paso manualmente entrando a la URL de acceso.
        data.bootstrapError = errBootstrap.message || 'No se pudo crear la empresa/usuario admin automáticamente.';
      }
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('superAdmin crear tenant:', err);
    res.status(500).json({ success: false, mensaje: err.message || 'Error al crear el tenant' });
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

    // Módulos contratados — techo por tenant, independiente del plan. Sincroniza
    // master + BD del tenant (empresas.modulosContratados) vía el helper dedicado,
    // no por el loop genérico de arriba.
    if (req.body.modulosContratados !== undefined) {
      const raw = req.body.modulosContratados;
      const modulos = raw === null
        ? null
        : (Array.isArray(raw) ? raw : []).filter((m) => MODULOS_TODOS.includes(m));
      const tenantActual = await master.tenants.findUnique({ where: { id: parseInt(req.params.id, 10) } });
      if (!tenantActual) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
      await actualizarModulosContratadosTenant(tenantActual.slug, modulos);
    }

    // Límites de sucursales/cajas — techo por tenant, independiente del plan.
    // Sincroniza master + BD del tenant (empresas.maxSucursales/maxCajas) vía
    // el helper dedicado, mismo patrón que modulosContratados.
    if (req.body.maxSucursales !== undefined || req.body.maxCajas !== undefined) {
      const tenantActual = await master.tenants.findUnique({ where: { id: parseInt(req.params.id, 10) } });
      if (!tenantActual) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });
      const aNumOrNull = (v) => (v === null || v === '' || v === undefined ? null : parseInt(v, 10));
      await actualizarLimitesTenant(tenantActual.slug, {
        ...(req.body.maxSucursales !== undefined ? { maxSucursales: aNumOrNull(req.body.maxSucursales) } : {}),
        ...(req.body.maxCajas !== undefined ? { maxCajas: aNumOrNull(req.body.maxCajas) } : {}),
      });
    }

    // Si se guarda una fecha de vencimiento futura, el tenant ya no debe seguir
    // tratado como trial: si queda esTrial=true, el middleware (tenant.js) evalúa
    // solo trialExpiresAt e ignora esta fecha por completo — un trial corto ya
    // vencido puede marcar "vencido" un tenant con un plan pago vigente por un
    // año, que es justo la inconsistencia real encontrada en el tenant "sys"
    // (fechaVencimiento a futuro, esTrial nunca desmarcado al setearla a mano
    // desde este mismo formulario). No se toca si el request pide 'suspendido'
    // explícitamente — eso sigue siendo una decisión manual del admin.
    if (data.fechaVencimiento instanceof Date && data.fechaVencimiento > new Date()) {
      data.esTrial = false;
      if (data.estado === undefined || data.estado === 'vencido') {
        data.estado = 'activo';
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
