// ====================================
// USUARIOS
// backend/routes/usuarios.js
// ====================================

const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const prisma   = require('../config/prisma');
const { proteger, soloAdmin } = require('../middleware/auth');
const { checkLimiteUsuarios } = require('../middleware/edition');
const {
  normalizarUsername,
  normalizarEmail,
  esUsernameValido,
  esEmailValido,
  mensajeDuplicidadUsuario,
} = require('../utils/identidadUsuario');
const {
  DEFAULT_ROLE,
  esRolValido,
  listarRolesComoTexto,
  normalizarRol,
} = require('../utils/roles');

const obtenerEmpresaActual = (req) => req.empresa?.id || req.usuario?.empresaId || 1;

const obtenerUsuarioEmpresa = async (id, empresaId) => prisma.usuarios.findFirst({
  where: { id, empresaId },
});

const normalizarUsuarioSalida = (usuario) => ({
  ...usuario,
  rol: normalizarRol(usuario.rol),
});

// GET /api/usuarios
router.get('/', proteger, soloAdmin, async (req, res) => {
  try {
    const empresaId = obtenerEmpresaActual(req);
    const usuarios = await prisma.usuarios.findMany({
      where: { empresaId },
      select: {
        id: true,
        nombre: true,
        username: true,
        email: true,
        rol: true,
        activo: true,
        createdAt: true,
      },
      orderBy: [
        { rol: 'asc' },
        { nombre: 'asc' },
      ],
    });
    res.json({ success: true, data: usuarios.map(normalizarUsuarioSalida) });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'Error al listar usuarios' });
  }
});

// POST /api/usuarios
router.post('/', proteger, soloAdmin, checkLimiteUsuarios, async (req, res) => {
  try {
    const { nombre, username, email, password, rol, empresaId: empresaIdBody } = req.body;
    const nombreLimpio = String(nombre || '').trim();
    const usernameLimpio = normalizarUsername(username);
    const emailLimpio = normalizarEmail(email);
    const rolNormalizado = normalizarRol(rol || DEFAULT_ROLE);
    // Allow admin to create user for a specific company
    const empresaId = empresaIdBody ? parseInt(empresaIdBody, 10) : obtenerEmpresaActual(req);

    if (!nombreLimpio || !usernameLimpio || !password) {
      return res.status(400).json({ success: false, mensaje: 'Nombre, usuario y contraseña son requeridos' });
    }

    if (!esUsernameValido(usernameLimpio)) {
      return res.status(400).json({
        success: false,
        mensaje: 'El usuario debe tener entre 3 y 40 caracteres y solo usar letras, números, punto, guion o guion bajo',
      });
    }

    if (!esEmailValido(emailLimpio)) {
      return res.status(400).json({ success: false, mensaje: 'Correo electrónico inválido' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, mensaje: 'La contraseña debe tener al menos 8 caracteres' });
    }

    if (!esRolValido(rolNormalizado)) {
      return res.status(400).json({
        success: false,
        mensaje: `Rol inválido. Roles permitidos: ${listarRolesComoTexto()}`,
      });
    }

    const hash = await bcrypt.hash(password, 10);
    const usuario = await prisma.usuarios.create({
      data: {
        empresaId,
        nombre: nombreLimpio,
        username: usernameLimpio,
        email: emailLimpio,
        password: hash,
        rol: rolNormalizado,
      },
      select: { id: true, nombre: true, username: true, email: true, rol: true, activo: true },
    });
    res.status(201).json({ success: true, data: normalizarUsuarioSalida(usuario) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: mensajeDuplicidadUsuario(error) });
    }
    res.status(500).json({ success: false, mensaje: 'Error al crear usuario' });
  }
});

// PUT /api/usuarios/:id
router.put('/:id', proteger, soloAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const empresaId = obtenerEmpresaActual(req);
    const actual = await obtenerUsuarioEmpresa(id, empresaId);

    if (!actual) {
      return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
    }

    const { nombre, username, email, rol, activo, password } = req.body;
    const data = {};

    if (nombre !== undefined) {
      if (!String(nombre).trim()) {
        return res.status(400).json({ success: false, mensaje: 'El nombre no puede estar vacío' });
      }
      data.nombre = String(nombre).trim();
    }

    if (username !== undefined) {
      const usernameLimpio = normalizarUsername(username);
      if (!esUsernameValido(usernameLimpio)) {
        return res.status(400).json({
          success: false,
          mensaje: 'El usuario debe tener entre 3 y 40 caracteres y solo usar letras, números, punto, guion o guion bajo',
        });
      }
      data.username = usernameLimpio;
    }

    if (email !== undefined) {
      const emailLimpio = normalizarEmail(email);
      if (!esEmailValido(emailLimpio)) {
        return res.status(400).json({ success: false, mensaje: 'Correo electrónico inválido' });
      }
      data.email = emailLimpio;
    }

    if (rol !== undefined) {
      const rolNormalizado = normalizarRol(rol);
      if (!esRolValido(rolNormalizado)) {
        return res.status(400).json({
          success: false,
          mensaje: `Rol inválido. Roles permitidos: ${listarRolesComoTexto()}`,
        });
      }
      data.rol = rolNormalizado;
    }

    if (activo !== undefined) {
      if (actual.id === req.usuario.id && activo === false) {
        return res.status(400).json({ success: false, mensaje: 'No puedes desactivar tu propio usuario' });
      }
      data.activo = Boolean(activo);
    }

    if (password !== undefined && String(password).trim()) {
      if (String(password).length < 8) {
        return res.status(400).json({ success: false, mensaje: 'La contraseña debe tener al menos 8 caracteres' });
      }
      data.password = await bcrypt.hash(password, 10);
    }

    const usuario = await prisma.usuarios.update({
      where: { id },
      data,
      select: { id: true, nombre: true, username: true, email: true, rol: true, activo: true },
    });
    res.json({ success: true, data: normalizarUsuarioSalida(usuario) });
  } catch (error) {
    if (error.code === 'P2002') {
      return res.status(409).json({ success: false, mensaje: mensajeDuplicidadUsuario(error) });
    }
    res.status(500).json({ success: false, mensaje: 'Error al actualizar usuario' });
  }
});

module.exports = router;
