// ====================================
// MIDDLEWARE: Autenticación y Autorización — AELA
// ====================================
const jwt    = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { normalizarRol, tienePermiso, obtenerRolLabel } = require('../utils/roles');

// ─── Proteger rutas (JWT requerido) ──────────────────────────────────────────
// Inyecta req.usuario y req.empresa
const proteger = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, mensaje: 'No autorizado — token no proporcionado' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Validar que el token pertenezca al mismo tenant del request.
    // Un token emitido para corpsimtelec (tenantSlug=null) no puede usarse
    // para acceder a un tenant externo (mprq, loja-torneos, etc.) y viceversa.
    const tokenTenant   = decoded.tenantSlug ?? null;
    const requestTenant = req.tenant?.slug    ?? null;
    if (tokenTenant !== requestTenant) {
      return res.status(401).json({
        success: false,
        mensaje: 'Sesión no válida para este tenant. Por favor inicia sesión nuevamente.',
        codigo:  'TENANT_MISMATCH',
      });
    }

    const db = req.prisma || prisma;
    const usuario = await db.usuarios.findUnique({
      where: { id: decoded.id },
      select: { id: true, nombre: true, username: true, email: true, rol: true, empresaId: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ success: false, mensaje: 'No autorizado — usuario inactivo o inexistente' });
    }

    // Usar el rol del JWT (efectivo para la empresa activa) en lugar del rol base de la BD.
    // En login normal ambos coinciden; en cambiarEmpresa el JWT tiene el rol de usuario_empresas.
    req.usuario = {
      ...usuario,
      rol: normalizarRol(decoded.rol ?? usuario.rol),
    };

    // ── Inyectar empresa ─────────────────────────────────────────────────────
    // Prioridad: decoded.empresaId (JWT — puede venir de cambiar-empresa)
    // > usuario.empresaId (empresa base del usuario en BD)
    // > primera empresa activa (fallback monoempresa sin empresa asignada)
    const empresaIdActiva = decoded.empresaId || usuario.empresaId;

    let empresa;
    if (empresaIdActiva) {
      empresa = await db.empresas.findUnique({ where: { id: empresaIdActiva } });
      // El JWT puede referir una empresa eliminada — caer al empresa base del usuario
      if (!empresa && decoded.empresaId && usuario.empresaId) {
        empresa = await db.empresas.findUnique({ where: { id: usuario.empresaId } });
      }
    }
    if (!empresa) {
      empresa = await db.empresas.findFirst({
        where: { activo: true },
        orderBy: { id: 'asc' },
      });
    }

    if (!empresa) {
      // Si el JWT/usuario apuntaba a una empresaId específica y no se pudo resolver
      // NI esa empresa NI ninguna otra empresa activa, no inventamos un id falso
      // (eso rompe cualquier create() con FK sobre empresaId — ver facturas_compra_empresaId_fkey).
      // Se conserva el fallback a id=1 solo para instalaciones mono-empresa legítimas
      // sin empresaId en el JWT ni en el usuario.
      if (empresaIdActiva) {
        return res.status(409).json({
          success: false,
          mensaje: 'Tu sesión hace referencia a una empresa que ya no existe o no está disponible. Cierra sesión y vuelve a iniciar.',
          codigo: 'EMPRESA_NO_ENCONTRADA',
        });
      }
      empresa = { id: 1, plan: process.env.AELA_EDITION || 'full', factAnualesMax: null };
    }
    req.empresa = empresa;

    // ── Trial expirado ───────────────────────────────────────────────────────
    if (req.empresa.esTrial && req.empresa.trialExpiresAt) {
      if (new Date() > new Date(req.empresa.trialExpiresAt)) {
        return res.status(402).json({
          success: false,
          codigo:  'TRIAL_EXPIRADO',
          mensaje: 'Tu período de prueba ha terminado. Contacta a soporte para activar tu suscripción.',
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ success: false, mensaje: 'No autorizado — token inválido' });
  }
};

// ─── Solo Admin ───────────────────────────────────────────────────────────────
const soloAdmin = (req, res, next) => {
  if (tienePermiso(req.usuario?.rol, 'usuarios.gestionar')) return next();
  return res.status(403).json({ success: false, mensaje: 'Acceso denegado — solo administradores' });
};

// ─── Solo Admin o Contador ────────────────────────────────────────────────────
const adminOContador = (req, res, next) => {
  if (['admin', 'contador'].includes(normalizarRol(req.usuario?.rol))) return next();
  return res.status(403).json({ success: false, mensaje: 'Acceso denegado — se requiere rol admin o contador' });
};

// ─── Autorizar roles (lista variable) ────────────────────────────────────────
const autorizarRoles = (...roles) => (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ success: false, mensaje: 'No autenticado' });
  }
  const rolUsuario = normalizarRol(req.usuario.rol);
  const rolesPermitidos = roles.map(normalizarRol);
  if (!rolesPermitidos.includes(rolUsuario)) {
    return res.status(403).json({
      success: false,
      mensaje: `Acceso denegado — se requiere: ${rolesPermitidos.map(obtenerRolLabel).join(', ')}`,
    });
  }
  next();
};

const autorizarPermiso = (permiso) => (req, res, next) => {
  if (!req.usuario) {
    return res.status(401).json({ success: false, mensaje: 'No autenticado' });
  }
  if (!tienePermiso(req.usuario.rol, permiso)) {
    return res.status(403).json({
      success: false,
      mensaje: 'Acceso denegado — tu rol no tiene permiso para esta acción',
    });
  }
  next();
};

module.exports = { proteger, soloAdmin, adminOContador, autorizarRoles, autorizarPermiso };
