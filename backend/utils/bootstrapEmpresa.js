// ====================================
// UTIL — Bootstrap de empresa + usuario admin inicial
// backend/utils/bootstrapEmpresa.js
//
// Lógica compartida por:
//   - POST /api/auth/bootstrap (el cliente completa su propia configuración
//     inicial la primera vez que entra a su URL de tenant)
//   - POST /api/super-admin/tenants (el operador da de alta al cliente él
//     mismo y le entrega usuario/contraseña ya listos, sin que el cliente
//     tenga que pasar por ese primer paso)
//
// Ambos terminan haciendo exactamente lo mismo: buscar/crear la empresa (con
// datos del SRI si están disponibles), su configuración SRI/sistema/plan de
// cuentas, y el usuario admin inicial — centralizado acá para que no diverjan.
// ====================================

const bcrypt = require('bcryptjs');
const {
  normalizarUsername,
  normalizarEmail,
  esUsernameValido,
  esEmailValido,
} = require('./identidadUsuario');
const { asegurarConfiguracionSriEmpresa, obtenerEmpresaSri } = require('./sriContribuyente');
const { asegurarConfiguracionSistemaEmpresa } = require('./configuracionSistema');
const { sembrarPlanCuentasBase } = require('./planCuentasBase');

const SELECT_EMPRESA = {
  id: true, ruc: true, razonSocial: true, nombreComercial: true, direccion: true,
  email: true, telefono: true, plan: true, factAnualesMax: true, activo: true,
};

function errorValidacion(mensaje, status = 400) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

/**
 * Crea (o completa, si ya existe una empresa sin datos) la empresa y el
 * usuario admin inicial de un tenant. Lanza un Error con `.status` (400/409)
 * en caso de validación fallida — el caller lo traduce a respuesta HTTP.
 *
 * @param {import('@prisma/client').PrismaClient} prismaT - cliente Prisma ya
 *   conectado a la BD del tenant destino.
 * @param {object} datos
 * @param {string} datos.nombre, datos.username, datos.email, datos.password
 * @param {string} datos.ruc, datos.razonSocial
 * @param {string} [datos.nombreComercial], [datos.direccion], [datos.telefono], [datos.emailEmpresa]
 * @param {string} [datos.plan] - 'lite' | 'full' (default 'full')
 * @returns {Promise<{empresa: object, usuario: object}>}
 */
async function crearEmpresaYAdminInicial(prismaT, datos = {}) {
  const {
    nombre, username, email, password,
    ruc, razonSocial, nombreComercial, direccion, telefono, emailEmpresa,
    plan,
  } = datos;

  const totalUsuarios = await prismaT.usuarios.count();
  if (totalUsuarios > 0) {
    throw errorValidacion('Este tenant ya tiene usuarios — la configuración inicial ya fue realizada.', 409);
  }

  const nombreLimpio       = String(nombre || '').trim();
  const usernameLimpio     = normalizarUsername(username);
  const emailLimpio        = normalizarEmail(email);
  const rucLimpio          = String(ruc || '').replace(/\D/g, '');
  const razonSocialLimpia  = String(razonSocial || '').trim();

  if (!nombreLimpio || !usernameLimpio || !password || !rucLimpio || !razonSocialLimpia) {
    throw errorValidacion('Nombre, usuario, contraseña, RUC y razón social son requeridos');
  }
  if (!esUsernameValido(usernameLimpio)) {
    throw errorValidacion('El usuario debe tener entre 3 y 40 caracteres y solo usar letras, números, punto, guion o guion bajo');
  }
  if (!esEmailValido(emailLimpio)) {
    throw errorValidacion('Correo electrónico inválido');
  }
  if (!/^\d{13}$/.test(rucLimpio)) {
    throw errorValidacion('El RUC debe tener exactamente 13 dígitos');
  }
  if (String(password).length < 8) {
    throw errorValidacion('La contraseña debe tener al menos 8 caracteres');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  // Se guarda tal cual llega (validado contra el set conocido) en vez de
  // colapsar todo lo que no sea 'lite' a 'full' — un tenant SaaS con plan
  // 'medium' necesita que empresas.plan quede en 'medium', no en 'full'/'pro',
  // porque asegurarConfiguracionSistemaEmpresa() deriva el techo de módulos
  // exactamente de este valor (ver capacidadesPlan() en configuracionSistema.js).
  const PLANES_VALIDOS_EMPRESA = ['lite', 'medium', 'pro', 'full'];
  const planFinal  = PLANES_VALIDOS_EMPRESA.includes(plan) ? plan : 'full';
  const empresaSri = await obtenerEmpresaSri(rucLimpio);

  return prismaT.$transaction(async (tx) => {
    const empresaBase = await tx.empresas.findFirst({ orderBy: { id: 'asc' } });

    const empresaData = {
      ruc: rucLimpio,
      razonSocial: empresaSri?.razonSocial || razonSocialLimpia,
      nombreComercial: empresaSri?.nombreComercial || String(nombreComercial || '').trim() || null,
      direccion: empresaSri?.direccion || String(direccion || '').trim() || null,
      email: String(emailEmpresa || '').trim().toLowerCase() || null,
      telefono: String(telefono || '').trim() || empresaSri?.telefono || null,
      activo: true,
      plan: planFinal,
      factAnualesMax: planFinal === 'lite' ? 100 : null,
    };

    const empresa = empresaBase
      ? await tx.empresas.update({ where: { id: empresaBase.id }, data: empresaData, select: SELECT_EMPRESA })
      : await tx.empresas.create({ data: empresaData, select: SELECT_EMPRESA });

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
      select: { id: true, nombre: true, username: true, email: true, rol: true, empresaId: true },
    });

    return { empresa, usuario };
  });
}

module.exports = { crearEmpresaYAdminInicial };
