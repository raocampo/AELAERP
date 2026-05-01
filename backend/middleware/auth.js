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

    const usuario = await prisma.usuarios.findUnique({
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
    // El modo operativo puede salir de la configuracion persistida del sistema.
    const modoOperacion = await obtenerModoOperacionGlobal(prisma);
    const modoMulti = modoOperacion === 'multiempresa';
    const empresaId = modoMulti ? usuario.empresaId : 1;

    let empresa = await prisma.empresas.findUnique({ where: { id: empresaId } });
    if (!empresa && !modoMulti) {
      empresa = await prisma.empresas.findFirst({
        where: { activo: true },
        orderBy: { id: 'asc' },
      });
    }

    req.empresa = empresa || { id: 1, plan: process.env.AELA_EDITION || 'full', factAnualesMax: null };

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
