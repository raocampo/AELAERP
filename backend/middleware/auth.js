// ====================================
// MIDDLEWARE: Autenticación y Autorización — AELA
// ====================================
const jwt    = require('jsonwebtoken');
const prisma = require('../config/prisma');
const { normalizarRol, tienePermiso, obtenerRolLabel } = require('../utils/roles');
const { obtenerModoOperacionGlobal } = require('../utils/configuracionSistema');

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

    const db = req.prisma || prisma;
    const usuario = await db.usuarios.findUnique({
      where: { id: decoded.id },
      select: { id: true, nombre: true, username: true, email: true, rol: true, empresaId: true, activo: true },
    });

    if (!usuario || !usuario.activo) {
      return res.status(401).json({ success: false, mensaje: 'No autorizado — usuario inactivo o inexistente' });
    }

    req.usuario = {
      ...usuario,
      rol: normalizarRol(usuario.rol),
    };

    // ── Inyectar empresa ─────────────────────────────────────────────────────
    const modoOperacion = await obtenerModoOperacionGlobal(db);
    const modoMulti = modoOperacion === 'multiempresa';
    // decoded.empresaId viene del JWT cuando el usuario cambió de empresa activa (macro empresa)
    const empresaIdActiva = decoded.empresaId || usuario.empresaId;

    // En modoMulti: usar la empresaId del JWT (puede ser > 1).
    // En monoempresa: buscar la primera empresa activa (no asumir id=1 que
    // podría no existir o ser otra empresa en BDs migradas).
    let empresa;
    if (modoMulti && empresaIdActiva) {
      empresa = await db.empresas.findUnique({ where: { id: empresaIdActiva } });
      // Si la empresa del JWT no existe, buscar la primera del usuario como fallback
      if (!empresa && usuario.empresaId) {
        empresa = await db.empresas.findUnique({ where: { id: usuario.empresaId } });
      }
    } else {
      // Monoempresa: la empresa del usuario o la primera activa disponible
      if (usuario.empresaId) {
        empresa = await db.empresas.findUnique({ where: { id: usuario.empresaId } });
      }
      if (!empresa) {
        empresa = await db.empresas.findFirst({
          where: { activo: true },
          orderBy: { id: 'asc' },
        });
      }
    }

    req.empresa = empresa || { id: empresaIdActiva || 1, plan: process.env.AELA_EDITION || 'full', factAnualesMax: null };

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
