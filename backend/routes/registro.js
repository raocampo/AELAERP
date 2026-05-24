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
      urlAcceso,          // slug elegido por el cliente (ej: "torneosloja")
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

    // ── Validar y reservar slug personalizado ──
    let slugForzado = null;
    if (urlAcceso?.trim()) {
      const slugLimpio = urlAcceso.trim().toLowerCase()
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

      const reservadas = ['admin', 'app', 'api', 'www', 'mail', 'aela', 'corpsimtelec', 'login', 'registro', 'acceso'];
      if (reservadas.includes(slugLimpio)) {
        return res.status(400).json({ success: false, mensaje: `"${slugLimpio}" es una URL reservada. Elige otra.` });
      }

      try {
        const master = getPrismaMaster();
        if (master) {
          const existeSlug = await master.tenants.findUnique({ where: { slug: slugLimpio } });
          if (existeSlug) {
            return res.status(409).json({
              success: false,
              mensaje: 'Esa URL de acceso ya está en uso. Por favor elige otra.',
              codigo: 'SLUG_DUPLICADO',
            });
          }
        }
      } catch (err) {
        console.warn('[registro] Error verificando slug:', err.message);
      }

      slugForzado = slugLimpio;
    }

    // Lite: activo de por vida (sin trial).
    // Medium / Pro: 15 días de prueba completa; pago posterior activa la suscripción real.
    const esTrial        = plan !== 'lite';
    const trialExpiresAt = esTrial
      ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000)
      : null;

    // ── Verificar email único ──
    try {
      const master = getPrismaMaster();
      if (master) {
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
      } else {
        console.warn('[registro] BD master no disponible — omitiendo verificación de duplicados');
      }
    } catch (err) {
      console.warn('[registro] Error verificando duplicado en master:', err.message);
    }

    // ── Lanzar provisioning en background ──
    // Respondemos inmediatamente; el provisioning puede tardar 5-15 seg.
    const mensajeBienvenida = esTrial
      ? `¡Bienvenido! Tu cuenta ${plan.toUpperCase()} con 15 días de prueba está siendo configurada. Recibirás un correo en ${emailContacto} cuando esté lista.`
      : `¡Bienvenido! Tu cuenta está siendo configurada. Recibirás un correo en ${emailContacto} cuando esté lista.`;

    res.json({
      success: true,
      mensaje: mensajeBienvenida,
      data: {
        nombreEmpresa: nombreEmpresa.trim(),
        plan,
        esTrial,
        estado:        'provisioning',
      },
    });

    // Ejecutar provisioning tras responder al cliente
    setImmediate(async () => {
      try {
        const tenant = await provisionarTenant({
          nombreEmpresa:    nombreEmpresa.trim(),
          plan,
          esTrial,
          trialExpiresAt,
          emailContacto:    emailContacto.trim().toLowerCase(),
          telefonoContacto: telefonoContacto?.trim() || null,
          nombreContacto:   nombreContacto?.trim() || nombreEmpresa.trim(),
          slugForzado:      slugForzado || null,
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

    if (!master) {
      // BD master no configurada — responder como "provisioning" para no bloquear al cliente
      return res.json({
        success: true,
        data: { estado: 'provisioning', plan: 'lite', urlAcceso: null },
      });
    }

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

    const appBase   = process.env.APP_BASE_URL || 'https://aela.corpsimtelec.com';
    const urlAcceso = tenant.estado === 'activo'
      ? `${appBase}/acceso/${tenant.slug}`
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
