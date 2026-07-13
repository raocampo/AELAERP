// ====================================
// RUTAS: Pagos de Suscripción — AELA ERP
// /api/suscripcion-pago/*
//
// Permite que los tenants inicien el pago de su suscripción directamente
// desde la aplicación. Proveedores implementados:
//   - transferencia:  registro manual (cliente sube comprobante / referencia)
//   - payphone:       checkout en la app PayPhone Ecuador
//   - stripe:         tarjeta crédito/débito (requiere STRIPE_SECRET_KEY)
//
// Requiere autenticación JWT (req.tenant resuelto por middleware tenant)
// ====================================

const express = require('express');
const router  = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { proteger }        = require('../middleware/auth');
const { invalidarCacheTenant } = require('../middleware/tenant');

// Precios de referencia (USD) — ajustables por env o por suscripción manual
const PRECIOS = {
  lite:   { mensual: 0,   anual: 0   },
  medium: { mensual: 29,  anual: 290 },
  pro:    { mensual: 59,  anual: 590 },
};

function getMaster(res) {
  const m = getPrismaMaster();
  if (!m) res.status(503).json({ success: false, mensaje: 'Modo SaaS no disponible' });
  return m;
}

// ─── GET /api/suscripcion-pago/info ──────────────────────────────────────────
// Devuelve info del plan actual y opciones de pago disponibles
router.get('/info', proteger, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenant = await master.tenants.findUnique({
      where:   { slug: req.tenant?.slug || '' },
      include: { suscripciones: { where: { estado: 'activo' }, take: 1, orderBy: { createdAt: 'desc' } } },
    });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const pagosDisponibles = [
      { id: 'transferencia', label: 'Transferencia bancaria',   descripcion: 'Transfiere a nuestra cuenta y envíanos el comprobante.',    icono: '🏦' },
      { id: 'payphone',      label: 'PayPhone',                  descripcion: 'Paga desde la app PayPhone o con tu tarjeta.',              icono: '📱', activo: !!process.env.PAYPHONE_API_TOKEN },
      { id: 'stripe',        label: 'Tarjeta de crédito/débito', descripcion: 'Pago seguro con Visa, Mastercard o American Express.',      icono: '💳', activo: !!process.env.STRIPE_SECRET_KEY },
      { id: 'paypal',        label: 'PayPal',                    descripcion: 'Paga con tu cuenta PayPal.',                               icono: '🅿', activo: !!process.env.PAYPAL_CLIENT_ID },
    ];

    res.json({
      success: true,
      data: {
        planActual:      tenant.plan,
        tipoInstancia:   tenant.tipoInstancia || 'monoempresa',
        estado:          tenant.estado,
        esTrial:         tenant.esTrial,
        trialExpiresAt:  tenant.trialExpiresAt,
        fechaVencimiento: tenant.fechaVencimiento,
        precios:         PRECIOS,
        pagosDisponibles: pagosDisponibles.filter(p => p.activo !== false || p.id === 'transferencia'),
        cuentasBancarias: _cuentasBancarias(),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/suscripcion-pago/transferencia ─────────────────────────────────
// Registrar intención de pago por transferencia bancaria
// Body: { plan, periodo, referencia (nro comprobante), monto? }
router.post('/transferencia', proteger, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const { plan, periodo, referencia, monto } = req.body;
    if (!plan || !periodo || !referencia) {
      return res.status(400).json({ success: false, mensaje: 'plan, periodo y referencia son requeridos' });
    }

    const tenantSlug = req.tenant?.slug;
    const tenant = await master.tenants.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const montoFinal = parseFloat(monto) || PRECIOS[plan]?.[periodo] || 0;

    const solicitud = await master.solicitudes_pago.create({
      data: {
        tenantId:  tenant.id,
        plan,
        periodo,
        monto:     montoFinal,
        proveedor: 'transferencia',
        estado:    'revision',
        referencia: String(referencia).trim(),
      },
    });

    // Notificar al equipo de soporte (si hay email configurado)
    _notificarSoporte({
      asunto:  `Pago transferencia: ${tenantSlug} — ${plan}/${periodo} $${montoFinal}`,
      mensaje: `Tenant: ${tenantSlug}\nPlan: ${plan}/${periodo}\nMonto: $${montoFinal}\nReferencia: ${referencia}\nID solicitud: ${solicitud.id}`,
    });

    res.status(201).json({
      success: true,
      mensaje: 'Tu solicitud de pago fue registrada. El equipo la verificará en 24 horas hábiles y activará tu plan.',
      data:    { id: solicitud.id, estado: solicitud.estado },
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/suscripcion-pago/payphone ─────────────────────────────────────
// Iniciar checkout con PayPhone
// Body: { plan, periodo }
router.post('/payphone', proteger, async (req, res) => {
  const token = process.env.PAYPHONE_API_TOKEN;
  if (!token) {
    return res.status(503).json({ success: false, mensaje: 'PayPhone no está configurado en este servidor.' });
  }

  const master = getMaster(res);
  if (!master) return;

  try {
    const { plan, periodo } = req.body;
    if (!plan || !periodo) return res.status(400).json({ success: false, mensaje: 'plan y periodo son requeridos' });

    const tenantSlug = req.tenant?.slug;
    const tenant = await master.tenants.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const monto = PRECIOS[plan]?.[periodo];
    if (!monto) return res.status(400).json({ success: false, mensaje: `El plan ${plan}/${periodo} no tiene precio configurado` });

    // Crear solicitud pendiente primero (para tener el ID del clientTransactionId)
    const solicitud = await master.solicitudes_pago.create({
      data: { tenantId: tenant.id, plan, periodo, monto, proveedor: 'payphone', estado: 'pendiente' },
    });

    const appBase      = process.env.APP_BASE_URL || 'https://aela.corpsimtelec.com';
    const responseUrl  = `${appBase}/api/suscripcion-pago/payphone-callback`;
    const cancelUrl    = `${appBase}/${tenantSlug}/suscripcion?cancelado=1`;

    // Llamar a PayPhone API
    const ppRes = await fetch('https://pay.payphoneapp.com/api/Sale', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        amount:                monto * 100,   // en centavos
        amountWithTax:         0,
        amountWithoutTax:      monto * 100,
        tax:                   0,
        clientTransactionId:   String(solicitud.id),
        storeId:               process.env.PAYPHONE_STORE_ID || undefined,
        responseUrl,
        cancellationUrl:       cancelUrl,
        currency:              'USD',
        reference:             `AELA ${plan.toUpperCase()} ${periodo}`,
      }),
    });

    if (!ppRes.ok) {
      const errBody = await ppRes.text();
      console.error('[payphone] Error al crear pago:', errBody);
      return res.status(502).json({ success: false, mensaje: 'PayPhone rechazó la solicitud. Intenta de nuevo.' });
    }

    const ppData = await ppRes.json();

    // Guardar checkout URL en la solicitud
    await master.solicitudes_pago.update({
      where: { id: solicitud.id },
      data:  {
        checkoutUrl:   ppData.payWithCard || ppData.payWithPayPhone || null,
        transactionId: ppData.transactionId || null,
        metadatos:     ppData,
      },
    });

    res.json({
      success: true,
      data: {
        solicitudId:     solicitud.id,
        checkoutUrl:     ppData.payWithCard,
        payphoneAppUrl:  ppData.payWithPayPhone,
      },
    });
  } catch (err) {
    console.error('[payphone] Error:', err.message);
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/suscripcion-pago/payphone-callback ────────────────────────────
// Webhook que PayPhone llama cuando se completa el pago (público — sin JWT)
router.post('/payphone-callback', async (req, res) => {
  const master = getPrismaMaster();
  if (!master) return res.status(503).json({ ok: false });

  try {
    const { clientTransactionId, transactionId, transactionStatus } = req.body;
    const solicitudId = parseInt(clientTransactionId, 10);
    if (!solicitudId) return res.status(400).json({ ok: false, error: 'clientTransactionId inválido' });

    const solicitud = await master.solicitudes_pago.findUnique({ where: { id: solicitudId }, include: { tenant: true } });
    if (!solicitud) return res.status(404).json({ ok: false });

    // transactionStatus: 3 = aprobado, 2 = rechazado en PayPhone
    const aprobado = transactionStatus === 3 || transactionStatus === '3';

    await master.solicitudes_pago.update({
      where: { id: solicitudId },
      data: {
        estado:        aprobado ? 'pagado' : 'rechazado',
        transactionId: String(transactionId || ''),
        metadatos:     req.body,
      },
    });

    if (aprobado) {
      await _activarSuscripcion(master, solicitud.tenant, solicitud, 'payphone');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[payphone-callback]', err.message);
    res.status(500).json({ ok: false });
  }
});

// ─── GET /api/suscripcion-pago/mis-solicitudes ───────────────────────────────
// Historial de solicitudes de pago del tenant actual
router.get('/mis-solicitudes', proteger, async (req, res) => {
  const master = getMaster(res);
  if (!master) return;
  try {
    const tenant = await master.tenants.findUnique({ where: { slug: req.tenant?.slug || '' } });
    if (!tenant) return res.status(404).json({ success: false, mensaje: 'Tenant no encontrado' });

    const solicitudes = await master.solicitudes_pago.findMany({
      where:   { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take:    20,
    });

    res.json({ success: true, data: solicitudes });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/super-admin/pagos/:id/aprobar ─────────────────────────────────
// Para SuperAdmin: aprobar manualmente una solicitud de transferencia
router.post('/admin/aprobar/:id', async (req, res) => {
  // Verificar clave super-admin
  const key = process.env.SUPER_ADMIN_KEY;
  if (!key) return res.status(503).json({ success: false, mensaje: 'Panel admin no configurado' });
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== key) return res.status(401).json({ success: false, mensaje: 'No autorizado' });

  const master = getMaster(res);
  if (!master) return;

  try {
    const solicitud = await master.solicitudes_pago.findUnique({
      where:   { id: parseInt(req.params.id, 10) },
      include: { tenant: true },
    });
    if (!solicitud) return res.status(404).json({ success: false, mensaje: 'Solicitud no encontrada' });
    if (solicitud.estado === 'pagado') return res.json({ success: true, mensaje: 'Ya estaba aprobada' });

    await master.solicitudes_pago.update({
      where: { id: solicitud.id },
      data:  { estado: 'pagado' },
    });

    await _activarSuscripcion(master, solicitud.tenant, solicitud, 'manual');
    res.json({ success: true, mensaje: 'Suscripción activada correctamente' });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _activarSuscripcion(master, tenant, solicitud, proveedor) {
  const meses     = solicitud.periodo === 'anual' ? 12 : 1;
  const fechaFin  = new Date();
  fechaFin.setMonth(fechaFin.getMonth() + meses);

  // Vencer suscripciones activas anteriores
  await master.suscripciones.updateMany({
    where: { tenantId: tenant.id, estado: 'activo' },
    data:  { estado: 'vencido' },
  });

  // Crear nueva suscripción
  await master.suscripciones.create({
    data: {
      tenantId:      tenant.id,
      plan:          solicitud.plan,
      periodo:       solicitud.periodo,
      monto:         solicitud.monto,
      fechaFin,
      proveedor,
      pagoReferencia: solicitud.referencia || solicitud.transactionId || null,
      estado:        'activo',
      fechaInicio:   new Date(),
    },
  });

  // Actualizar tenant
  await master.tenants.update({
    where: { id: tenant.id },
    data:  {
      plan:             solicitud.plan,
      estado:           'activo',
      esTrial:          false,
      fechaVencimiento: fechaFin,
      fechaActivacion:  new Date(),
    },
  });

  invalidarCacheTenant(tenant.slug);
}

function _cuentasBancarias() {
  return [
    {
      banco:   process.env.BANCO_NOMBRE       || 'Banco Pichincha',
      tipo:    process.env.BANCO_TIPO         || 'Cuenta Corriente',
      numero:  process.env.BANCO_NUMERO       || 'Configura BANCO_NUMERO en .env',
      titular: process.env.BANCO_TITULAR      || 'CorpSimtelec S.A.',
      ruc:     process.env.BANCO_RUC          || '',
    },
  ];
}

async function _notificarSoporte({ asunto, mensaje }) {
  try {
    const { enviarAlertaSoporte } = require('../utils/email');
    if (enviarAlertaSoporte) await enviarAlertaSoporte({ asunto, mensaje });
  } catch (_) {}
}

module.exports = router;
