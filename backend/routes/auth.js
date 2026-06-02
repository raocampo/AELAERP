// ====================================
// AUTH — Login y perfil
// backend/routes/auth.js
// ====================================

const express  = require('express');
const router   = express.Router();

const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const prisma   = require('../config/prisma');

// Garantiza que req.prisma siempre apunte a la BD correcta:
// la del tenant activo (SaaS) o la BD por defecto (monoinstancia).
router.use((req, _res, next) => { req.prisma = req.prisma || prisma; next(); });
const { proteger } = require('../middleware/auth');
const {
  normalizarLogin,
  normalizarUsername,
  normalizarEmail,
  esUsernameValido,
  esEmailValido,
  mensajeDuplicidadUsuario,
} = require('../utils/identidadUsuario');
const { normalizarRol } = require('../utils/roles');
const {
  asegurarConfiguracionSriEmpresa,
  obtenerEmpresaSri,
} = require('../utils/sriContribuyente');
const { asegurarConfiguracionSistemaEmpresa } = require('../utils/configuracionSistema');
const { sembrarPlanCuentasBase } = require('../utils/planCuentasBase');

const emitirToken = (usuario, opts = {}) => jwt.sign(
  {
    id: usuario.id,
    email: usuario.email,
    username: usuario.username,
    rol: normalizarRol(usuario.rol),
    empresaId: opts.empresaId ?? usuario.empresaId ?? null,
    tenantSlug: opts.tenantSlug ?? null,
  },
  process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);

const obtenerPlanEmpresa = () => {
  const edition = process.env.AELA_EDITION === 'lite' ? 'lite' : 'full';
  return {
    plan: edition,
    factAnualesMax: edition === 'lite' ? 100 : null,
  };
};

// GET /api/auth/bootstrap-status
router.get('/bootstrap-status', async (req, res) => {
  try {
    const [totalUsuarios, totalEmpresas] = await Promise.all([
      req.prisma.usuarios.count(),
      req.prisma.empresas.count(),
    ]);

    res.json({
      success: true,
      data: {
        setupRequired: totalUsuarios === 0,
        totalUsuarios,
        totalEmpresas,
      },
    });
  } catch (error) {
    console.error('Error bootstrap-status:', error);
    res.status(500).json({ success: false, mensaje: 'Error al verificar la configuración inicial' });
  }
});

// GET /api/auth/identificar-dominio?host=erp.miempresa.com
// Endpoint público: dado un hostname devuelve el slug del tenant que lo tiene configurado.
// Usado por el frontend cuando se carga desde un dominio personalizado (marca blanca).
router.get('/identificar-dominio', async (req, res) => {
  const host = String(req.query.host || '').trim().toLowerCase().split(':')[0];
  if (!host) return res.json({ success: true, data: null });

  try {
    const { getPrismaMaster } = require('../config/prismaMaster');
    const master = getPrismaMaster();
    if (!master) return res.json({ success: true, data: null });

    const tenants = await master.tenants.findMany({
      where:  { estado: 'activo' },
      select: { slug: true, plan: true, brandConfig: true },
    });

    const found = tenants.find((t) => {
      const bc = t.brandConfig;
      if (!bc || typeof bc !== 'object') return false;
      const dominios = Array.isArray(bc.dominios) ? bc.dominios : [];
      if (bc.dominio) dominios.push(bc.dominio);
      return dominios.includes(host);
    });

    res.json({ success: true, data: found ? { slug: found.slug, plan: found.plan } : null });
  } catch {
    res.json({ success: true, data: null });
  }
});

// GET /api/auth/branding — branding público (sin auth) para personalizar el login
router.get('/branding', async (req, res) => {
  try {
    const config = await req.prisma.configuracion_sri.findFirst({
      where:   { activo: true },
      orderBy: { empresaId: 'asc' },
      select:  { razonSocial: true, nombreComercial: true, logoUrl: true },
    });

    res.json({
      success: true,
      data: {
        nombre:  config?.nombreComercial || config?.razonSocial || null,
        logoUrl: config?.logoUrl         || null,
      },
    });
  } catch {
    res.json({ success: true, data: { nombre: null, logoUrl: null } });
  }
});

// GET /api/auth/empresa-sri/:ruc
router.get('/empresa-sri/:ruc', async (req, res) => {
  try {
    const ruc = String(req.params.ruc || '').replace(/\D/g, '');
    if (!/^\d{13}$/.test(ruc)) {
      return res.status(400).json({ success: false, mensaje: 'El RUC debe tener 13 dígitos' });
    }

    const empresaSri = await obtenerEmpresaSri(ruc);
    if (!empresaSri) {
      return res.json({
        success: true,
        encontrado: false,
        mensaje: 'No se encontró información en el SRI para ese RUC',
      });
    }

    res.json({
      success: true,
      encontrado: true,
      data: empresaSri,
    });
  } catch (error) {
    console.error('Error empresa-sri:', error);
    res.status(500).json({ success: false, mensaje: 'Error al consultar el SRI' });
  }
});

// POST /api/auth/bootstrap
router.post('/bootstrap', async (req, res) => {
  try {
    const {
      nombre,
      username,
      email,
      password,
      ruc,
      razonSocial,
      nombreComercial,
      direccion,
      telefono,
      emailEmpresa,
    } = req.body;

    const totalUsuarios = await req.prisma.usuarios.count();
    if (totalUsuarios > 0) {
      return res.status(409).json({
        success: false,
        mensaje: 'La configuración inicial ya fue realizada. Inicia sesión con tu usuario.',
      });
    }

    const nombreLimpio = String(nombre || '').trim();
    const usernameLimpio = normalizarUsername(username);
    const emailLimpio = normalizarEmail(email);
    const rucLimpio = String(ruc || '').replace(/\D/g, '');
    const razonSocialLimpia = String(razonSocial || '').trim();

    if (!nombreLimpio || !usernameLimpio || !password || !rucLimpio || !razonSocialLimpia) {
      return res.status(400).json({
        success: false,
        mensaje: 'Nombre, usuario, contraseña, RUC y razón social son requeridos',
      });
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

    if (!/^\d{13}$/.test(rucLimpio)) {
      return res.status(400).json({ success: false, mensaje: 'El RUC debe tener exactamente 13 dígitos' });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ success: false, mensaje: 'La contraseña debe tener al menos 8 caracteres' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const planEmpresa = obtenerPlanEmpresa();
    const empresaSri = await obtenerEmpresaSri(rucLimpio);

    const { empresa, usuario } = await req.prisma.$transaction(async (tx) => {
      const empresaBase = await tx.empresas.findFirst({ orderBy: { id: 'asc' } });

      const empresaData = {
        ruc: rucLimpio,
        razonSocial: empresaSri?.razonSocial || razonSocialLimpia,
        nombreComercial: empresaSri?.nombreComercial || String(nombreComercial || '').trim() || null,
        direccion: empresaSri?.direccion || String(direccion || '').trim() || null,
        email: String(emailEmpresa || '').trim().toLowerCase() || null,
        telefono: String(telefono || '').trim() || empresaSri?.telefono || null,
        activo: true,
        ...planEmpresa,
      };

      const empresa = empresaBase
        ? await tx.empresas.update({
            where: { id: empresaBase.id },
            data: empresaData,
            select: {
              id: true,
              ruc: true,
              razonSocial: true,
              nombreComercial: true,
              direccion: true,
              email: true,
              telefono: true,
              plan: true,
              factAnualesMax: true,
              activo: true,
            },
          })
        : await tx.empresas.create({
            data: empresaData,
            select: {
              id: true,
              ruc: true,
              razonSocial: true,
              nombreComercial: true,
              direccion: true,
              email: true,
              telefono: true,
              plan: true,
              factAnualesMax: true,
              activo: true,
            },
          });

      await asegurarConfiguracionSriEmpresa(tx, empresa, empresaSri);
      await asegurarConfiguracionSistemaEmpresa(empresa, tx);
      await sembrarPlanCuentasBase(tx, empresa.id);

      const usuario = await tx.usuarios.create({
        data: {
          empresaId: empresa.id,
          nombre: nombreLimpio,
          username: usernameLimpio,
          email: emailLimpio,
          password: passwordHash,
          rol: 'admin',
          activo: true,
        },
        select: {
          id: true,
          nombre: true,
          username: true,
          email: true,
          rol: true,
          empresaId: true,
        },
      });

      return { empresa, usuario };
    });

    const tenantSlug = req.tenant?.slug || null;
    const token = emitirToken(usuario, { tenantSlug });

    res.status(201).json({
      success: true,
      mensaje: 'Configuración inicial completada',
      token,
      tenantSlug,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        username: usuario.username,
        email: usuario.email,
        rol: normalizarRol(usuario.rol),
      },
      empresa,
    });
  } catch (error) {
    console.error('Error bootstrap:', error);
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        mensaje: mensajeDuplicidadUsuario(error),
      });
    }
    res.status(500).json({ success: false, mensaje: 'Error al completar la configuración inicial' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { login, email, password } = req.body;
    const identificador = normalizarLogin(login || email);

    if (!identificador || !password) {
      return res.status(400).json({ success: false, mensaje: 'Usuario o correo y contraseña son requeridos' });
    }

    const totalUsuarios = await req.prisma.usuarios.count();
    if (totalUsuarios === 0) {
      return res.status(409).json({
        success: false,
        setupRequired: true,
        mensaje: 'Aún no existe un usuario administrador. Completa la configuración inicial.',
      });
    }

    const usuario = await req.prisma.usuarios.findFirst({
      where: {
        OR: [
          { username: identificador },
          { email: identificador },
        ],
      },
    });
    if (!usuario || !usuario.activo) {
      return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
    }

    const passwordValida = await bcrypt.compare(password, usuario.password);
    if (!passwordValida) {
      return res.status(401).json({ success: false, mensaje: 'Credenciales inválidas' });
    }

    const tenantSlug = req.tenant?.slug || null;
    const token = emitirToken(usuario, { tenantSlug });

    res.json({
      success: true,
      token,
      tenantSlug,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        username: usuario.username,
        email: usuario.email,
        rol: normalizarRol(usuario.rol),
      },
    });
  } catch (error) {
    console.error('Error login:', error);
    res.status(500).json({ success: false, mensaje: 'Error al iniciar sesión' });
  }
});

// GET /api/auth/perfil
router.get('/perfil', proteger, async (req, res) => {
  try {
    const usuario = await req.prisma.usuarios.findUnique({
      where: { id: req.usuario.id },
      select: { id: true, nombre: true, username: true, email: true, rol: true, activo: true, createdAt: true },
    });
    res.json({
      success: true,
      data: usuario ? { ...usuario, rol: normalizarRol(usuario.rol) } : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, mensaje: 'Error al obtener perfil' });
  }
});

// POST /api/auth/cambiar-password
router.post('/cambiar-password', proteger, async (req, res) => {
  try {
    const { passwordActual, passwordNuevo } = req.body;

    if (!passwordActual || !passwordNuevo) {
      return res.status(400).json({ success: false, mensaje: 'La contraseña actual y la nueva son requeridas' });
    }

    if (String(passwordNuevo).length < 8) {
      return res.status(400).json({ success: false, mensaje: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }

    const usuario = await req.prisma.usuarios.findUnique({ where: { id: req.usuario.id } });
    if (!usuario) {
      return res.status(404).json({ success: false, mensaje: 'Usuario no encontrado' });
    }

    const passwordValida = await bcrypt.compare(passwordActual, usuario.password);
    if (!passwordValida) {
      return res.status(401).json({ success: false, mensaje: 'La contraseña actual es incorrecta' });
    }

    const hash = await bcrypt.hash(passwordNuevo, 10);
    await req.prisma.usuarios.update({ where: { id: usuario.id }, data: { password: hash } });

    res.json({ success: true, mensaje: 'Contraseña actualizada correctamente' });
  } catch (error) {
    console.error('Error cambiar-password:', error);
    res.status(500).json({ success: false, mensaje: 'Error al cambiar la contraseña' });
  }
});

// POST /api/auth/cambiar-empresa
// Emite un nuevo JWT con la empresa activa seleccionada.
// Solo disponible si el usuario tiene acceso a esa empresa (usuario_empresas o es su empresa default).
router.post('/cambiar-empresa', proteger, async (req, res) => {
  try {
    const empresaId = parseInt(req.body.empresaId, 10);
    if (!empresaId || isNaN(empresaId)) {
      return res.status(400).json({ success: false, mensaje: 'empresaId requerido' });
    }

    // Verificar acceso: empresa propia del usuario O entrada en usuario_empresas
    const [propiaEmpresa, accesoExtra] = await Promise.all([
      req.usuario.empresaId === empresaId
        ? req.prisma.empresas.findUnique({ where: { id: empresaId } })
        : Promise.resolve(null),
      req.prisma.usuario_empresas.findUnique({
        where: { usuarioId_empresaId: { usuarioId: req.usuario.id, empresaId } },
        include: { empresa: true },
      }),
    ]);

    const empresa = propiaEmpresa || accesoExtra?.empresa || null;
    if (!empresa || !empresa.activo) {
      return res.status(403).json({ success: false, mensaje: 'No tienes acceso a esa empresa o está inactiva' });
    }

    const tenantSlug = req.tenant?.slug || null;
    const token = emitirToken(req.usuario, { empresaId: empresa.id, tenantSlug });

    res.json({
      success: true,
      token,
      tenantSlug,
      empresa: {
        id: empresa.id,
        ruc: empresa.ruc,
        razonSocial: empresa.razonSocial,
        nombreComercial: empresa.nombreComercial,
        plan: empresa.plan,
        factAnualesMax: empresa.factAnualesMax,
        activo: empresa.activo,
        esMatriz: empresa.esMatriz,
      },
    });
  } catch (error) {
    console.error('Error cambiar-empresa:', error);
    res.status(500).json({ success: false, mensaje: 'Error al cambiar de empresa' });
  }
});

module.exports = router;
