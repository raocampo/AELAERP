// ====================================
// RUTA — Registro Público de Tenants
// POST /api/registro
//
// Endpoint público (sin autenticación) para que nuevos clientes
// se registren desde la landing page.
//
// Flujo:
//   1. Validar datos del formulario
//   2. Verificar que el email no exista en otra cuenta
//   3. Crear tenant en BD master con estado "provisioning"
//   4. Lanzar provisioning de BD en background (no bloquea la respuesta)
//   5. Responder con URL de acceso + mensaje de bienvenida
// ====================================

const express  = require('express');
const router   = express.Router();
const { getPrismaMaster } = require('../config/prismaMaster');
const { provisionarTenant } = require('../utils/provisionarTenant');
const { enviarEmailBienvenida, enviarAlertaSoporte } = require('../utils/email');

// Rate limit básico: máx 5 registros por IP en 10 min
const _registrosPorIp = new Map();
function checkRateLimit(ip) {
  const ahora = Date.now();
  const ventana = 10 * 60 * 1000; // 10 minutos
  const intentos = (_registrosPorIp.get(ip) || []).filter((t) => ahora - t < ventana);
  if (intentos.length >= 5) return false;
  _registrosPorIp.set(ip, [...intentos, ahora]);
  return true;
}

// ─── POST /api/registro ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  // Verificar que el modo SaaS esté activado
  const prismaMaster = getPrismaMaster();
  if (!prismaMaster) {
    return res.status(503).json({
      success: false,
      mensaje: 'El registro público no está disponible en este servidor. Contacte al administrador.',
    });
  }

  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({
      success: false,
      mensaje: 'Demasiados intentos de registro. Intenta en 10 minutos.',
    });
  }

  try {
    const {
      nombreEmpresa,
      emailContacto,
      telefonoContacto,
      nombreContacto,
      plan = 'lite',
      terminosAceptados,
    } = req.body;

    // ── Validaciones básicas ──
    if (!nombreEmpresa?.trim()) {
      return res.status(400).json({ success: false, mensaje: 'El nombre de la empresa es requerido.' });
    }
    if (!emailContacto?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailContacto.trim())) {
      return res.status(400).json({ success: false, mensaje: 'Correo electrónico inválido.' });
    }
    if (!terminosAceptados) {
      return res.status(400).json({ success: false, mensaje: 'Debes aceptar los términos y condiciones.' });
    }

    const planesValidos = ['lite', 'medium', 'pro'];
    if (!planesValidos.includes(plan)) {
      return res.status(400).json({ success: false, mensaje: 'Plan inválido.' });
    }

    // Para medium/pro el registro público siempre inicia como lite;
    // la activación del plan superior ocurre tras el pago.
    // (El plan real se activa via webhook de pago)
    const planInicial = 'lite';

    // ── Verificar email único ──
    try {
      const master = getPrismaMaster();
      const existente = await master.tenants.findFirst({
        where: { emailContacto: emailContacto.trim().toLowerCase() },
      });
      if (existente) {
        return res.status(409).json({
          success: false,
          mensaje: 'Ya existe una cuenta con ese correo electrónico.',
          codigo: 'EMAIL_DUPLICADO',
        });
      }
    } catch {
      // Si la BD master no está disponible aún, continuar en modo degradado
      console.warn('[registro] BD master no disponible — operando en modo degradado');
    }

    // ── Lanzar provisioning en background ──
    // Respondemos inmediatamente; el provisioning puede tardar 5-15 seg.
    res.json({
      success: true,
      mensaje: `¡Bienvenido! Tu cuenta está siendo configurada. Recibirás un correo en ${emailContacto} cuando esté lista.`,
      data: {
        nombreEmpresa: nombreEmpresa.trim(),
        plan:          planInicial,
        estado:        'provisioning',
      },
    });

    // Ejecutar provisioning tras responder al cliente
    setImmediate(async () => {
      try {
        const tenant = await provisionarTenant({
          nombreEmpresa:    nombreEmpresa.trim(),
          plan:             planInicial,
          emailContacto:    emailContacto.trim().toLowerCase(),
          telefonoContacto: telefonoContacto?.trim() || null,
          nombreContacto:   nombreContacto?.trim() || nombreEmpresa.trim(),
        });

        // Enviar email de bienvenida con URL de acceso
        await enviarEmailBienvenida(tenant, emailContacto.trim().toLowerCase());
        console.log(`[registro] Tenant provisionado: ${tenant.slug} → ${tenant.dbName}`);

      } catch (err) {
        console.error('[registro] Error en provisioning background:', err.message);
        await enviarAlertaSoporte({
          asunto:  `Error provisioning: ${nombreEmpresa.trim()}`,
          mensaje: `Email: ${emailContacto}\nError: ${err.message}\nStack: ${err.stack}`,
        });
      }
    });

  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ success: false, mensaje: 'Error al procesar el registro. Intenta de nuevo.' });
  }
});

// ─── GET /api/registro/estado/:email ─────────────────────────────────────────
// Permite al cliente verificar si su cuenta ya está lista
router.get('/estado/:email', async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    const master = getPrismaMaster();

    const tenant = await master.tenants.findFirst({
      where: { emailContacto: email },
      select: {
        slug: true,
        plan: true,
        estado: true,
        brandConfig: true,
        createdAt: true,
      },
    });

    if (!tenant) {
      return res.status(404).json({ success: false, mensaje: 'No se encontró cuenta con ese correo.' });
    }

    const dominioBase = process.env.AELA_DOMINIO_BASE || 'aela.ec';
    const urlAcceso   = tenant.estado === 'activo'
      ? `https://${tenant.slug}.${dominioBase}`
      : null;

    res.json({
      success: true,
      data: {
        estado:    tenant.estado,
        plan:      tenant.plan,
        urlAcceso,
        creadoEl:  tenant.createdAt,
      },
    });
  } catch (error) {
    console.error('Error verificando estado de registro:', error);
    res.status(500).json({ success: false, mensaje: 'Error al verificar el estado.' });
  }
});

module.exports = router;
