// ====================================
// UTIL — Provisioning de Tenant
// Crea y configura la BD PostgreSQL para un nuevo cliente.
//
// Proceso completo:
//   1. Generar slug único y contraseña de BD
//   2. Crear base de datos PostgreSQL
//   3. Ejecutar migraciones Prisma (schema del tenant)
//   4. Registrar el tenant en la BD master
//   5. (Opcional) Enviar email de bienvenida
//
// Este proceso se ejecuta en background tras el registro del cliente.
// El estado del tenant pasa por: provisioning → activo (o error si falla)
// ====================================

const { execSync } = require('child_process');
const { Client }   = require('pg');
const path         = require('path');
const crypto       = require('crypto');
const { getPrismaMaster }  = require('../config/prismaMaster');
const { getTenantPrisma }  = require('../config/prismaTenant');
const { limitesPlan }      = require('./configuracionSistema');
const { cifrar }           = require('./cifrado');

// ─── Genera un slug URL-safe a partir del nombre de empresa ──────────────────
function generarSlug(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    || 'empresa';
}

// ─── Genera un slug único verificando contra la BD master ────────────────────
async function generarSlugUnico(nombre) {
  const master = getPrismaMaster();
  const base   = generarSlug(nombre);
  let slug     = base;
  let intento  = 1;

  while (true) {
    const existe = await master.tenants.findUnique({ where: { slug } });
    if (!existe) return slug;
    intento++;
    slug = `${base}-${intento}`;
  }
}

// ─── Parsea una URL de PostgreSQL en sus componentes ────────────────────────
function parsearDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port || '5432',
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: (u.pathname || '/postgres').slice(1) || 'postgres',
    };
  } catch {
    throw new Error(`URL de BD inválida: ${url}`);
  }
}

// ─── Crea la BD PostgreSQL usando el cliente pg (no requiere psql instalado) ──
async function crearBaseDatos(dbName) {
  const adminUrl = process.env.DATABASE_ADMIN_URL
    || process.env.DATABASE_MASTER_URL
    || process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('No hay URL de admin de BD configurada (DATABASE_ADMIN_URL / DATABASE_URL)');

  const safeDb = dbName.replace(/[^a-z0-9_]/gi, '_');
  const client = new Client({ connectionString: adminUrl });

  try {
    await client.connect();
    // Verificar si ya existe para hacer la operación idempotente
    const existe = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`, [safeDb]
    );
    if (existe.rowCount === 0) {
      // CREATE DATABASE no puede ejecutarse dentro de una transacción
      await client.query(`CREATE DATABASE "${safeDb}"`);
    }
  } finally {
    await client.end().catch(() => {});
  }

  return { dbName: safeDb };
}

// ─── Aplica el schema Prisma sobre la BD del tenant con db push ───────────────
// Usamos "db push" y NO "migrate deploy" porque este proyecto no tiene archivos
// de migración en prisma/migrations/ — usa db push en el startup script.
// "migrate deploy" con carpeta vacía no hace nada y deja la BD sin tablas.
function aplicarSchemaTenant(dbUrl) {
  const schemaPath = path.join(__dirname, '../prisma/schema.prisma');
  execSync(
    `npx prisma db push --schema="${schemaPath}" --accept-data-loss --skip-generate`,
    {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
      timeout: 120000, // 2 min — crear tablas en BD nueva puede tardar
    }
  );
}

// ─── Proceso completo de provisioning ────────────────────────────────────────
/**
 * Provisiona un tenant completo: BD + migraciones + registro en master.
 *
 * @param {object} opciones
 * @param {string} opciones.nombreEmpresa   - Nombre de la empresa (para generar slug)
 * @param {string} opciones.plan            - 'lite' | 'medium' | 'pro'
 * @param {string} [opciones.emailContacto]
 * @param {string} [opciones.telefonoContacto]
 * @param {string} [opciones.slugForzado]   - Forzar un slug específico (white-label)
 * @returns {Promise<object>}               - Tenant creado
 */
async function provisionarTenant({
  nombreEmpresa,
  plan = 'lite',
  esTrial = false,
  trialExpiresAt = null,
  emailContacto,
  telefonoContacto,
  nombreContacto,
  slugForzado,
}) {
  const master = getPrismaMaster();
  const limites = limitesPlan(plan);

  // 1. Generar slug y nombre de BD
  const slug   = slugForzado || await generarSlugUnico(nombreEmpresa);
  const dbName = `aela_${slug.replace(/-/g, '_')}`;

  // En Railway (PostgreSQL compartido) todos los tenants usan las mismas
  // credenciales del servidor pero cada uno tiene su propia base de datos.
  // Extraemos host/port/user/pass del URL de admin para guardarlos correctamente.
  const adminUrlBase  = process.env.DATABASE_ADMIN_URL
    || process.env.DATABASE_MASTER_URL
    || process.env.DATABASE_URL;
  if (!adminUrlBase) throw new Error('No hay URL de admin de BD configurada');
  const adminConnBase = parsearDbUrl(adminUrlBase);

  const dbUser = process.env.DB_TENANT_USER || adminConnBase.user;
  const dbHost = process.env.DB_TENANT_HOST || adminConnBase.host;
  const dbPort = parseInt(process.env.DB_TENANT_PORT || adminConnBase.port || '5432', 10);
  const dbPass = adminConnBase.password; // mismas credenciales, distinta BD

  // 2. Crear registro en BD master con estado "provisioning"
  const tenant = await master.tenants.create({
    data: {
      slug,
      plan,
      estado:    'provisioning',
      dbName,
      dbHost,
      dbPort,
      dbUser,
      dbPass: cifrar(dbPass),
      emailContacto:    emailContacto    || null,
      telefonoContacto: telefonoContacto || null,
      nombreContacto:   nombreContacto   || nombreEmpresa || null,
      periodoFacturacion: plan === 'lite' ? null : 'mensual',
      fechaActivacion: new Date(),
      fechaVencimiento: null,
      esTrial,
      trialExpiresAt: trialExpiresAt || null,
    },
  });

  try {
    // 3. Crear BD PostgreSQL
    await crearBaseDatos(dbName);

    // 4. Aplicar schema Prisma con db push (NO migrate deploy — no hay archivos de migración)
    // Usamos DATABASE_ADMIN_URL con prioridad; si no existe, DATABASE_URL como fallback.
    // DATABASE_MASTER_URL puede tener ?schema=aela_master y no sirve como admin de BD.
    const adminUrlParaSchema = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
    if (!adminUrlParaSchema) throw new Error('No hay DATABASE_ADMIN_URL ni DATABASE_URL configurado');
    const adminConn = parsearDbUrl(adminUrlParaSchema);
    const dbUrl = `postgresql://${adminConn.user}:${encodeURIComponent(adminConn.password)}@${adminConn.host}:${adminConn.port}/${dbName}`;
    aplicarSchemaTenant(dbUrl);

    // 5. Actualizar estado → activo
    const tenantActivo = await master.tenants.update({
      where: { id: tenant.id },
      data:  {
        estado: 'activo',
        fechaActivacion: new Date(),
      },
    });

    // 6. Actualizar plan/trial en empresa dentro de la BD del tenant
    // (La empresa real se crea en bootstrap cuando el usuario configura su cuenta)
    try {
      const prismaT = getTenantPrisma(tenantActivo);
      const empresasExistentes = await prismaT.empresas.count();
      if (empresasExistentes > 0) {
        await prismaT.empresas.updateMany({
          data: {
            plan,
            factAnualesMax: limites.factAnualesMax,
            maxUsuarios:    limites.maxUsuarios,
            esTrial,
            trialExpiresAt: trialExpiresAt || null,
          },
        });
      }
    } catch (err) {
      // No crítico — bootstrap lo completará al momento del setup inicial
      console.warn(`[provisioning] No se pudo actualizar empresas en BD '${slug}':`, err.message);
    }

    console.log(`[provisioning] Tenant '${slug}' (${plan}${esTrial ? ' trial 15d' : ''}) listo. BD: ${dbName}`);
    return tenantActivo;

  } catch (err) {
    // Si algo falla, marcar como error para reintento manual
    await master.tenants.update({
      where: { id: tenant.id },
      data:  { estado: 'error' },
    }).catch(() => {});

    console.error(`[provisioning] Error en tenant '${slug}':`, err.message);
    throw err;
  }
}

// ─── Cambiar plan de un tenant existente ─────────────────────────────────────
/**
 * Actualiza el plan de un tenant en la BD master Y en su propia BD (empresa).
 *
 * @param {string} slug
 * @param {string} nuevoPlan  - 'lite' | 'medium' | 'pro'
 * @param {object} [datosSuscripcion] - { periodo, monto, pagoRef, proveedor }
 */
async function actualizarPlanTenant(slug, nuevoPlan, datosSuscripcion = {}) {
  const master  = getPrismaMaster();
  const limites = limitesPlan(nuevoPlan);

  const tenant = await master.tenants.findUnique({ where: { slug } });
  if (!tenant) throw new Error(`Tenant '${slug}' no encontrado`);

  // Calcular fecha de vencimiento
  let fechaVencimiento = null;
  if (nuevoPlan !== 'lite') {
    const hoy = new Date();
    fechaVencimiento = new Date(hoy);
    if (datosSuscripcion.periodo === 'anual') {
      fechaVencimiento.setFullYear(hoy.getFullYear() + 1);
    } else {
      fechaVencimiento.setMonth(hoy.getMonth() + 1);
    }
  }

  // Actualizar en BD master
  const tenantActualizado = await master.tenants.update({
    where: { id: tenant.id },
    data: {
      plan:              nuevoPlan,
      estado:            'activo',
      periodoFacturacion: datosSuscripcion.periodo || null,
      fechaActivacion:   new Date(),
      fechaVencimiento,
      autoRenovar:       Boolean(datosSuscripcion.autoRenovar),
    },
  });

  // Registrar en historial de suscripciones
  if (datosSuscripcion.monto) {
    await master.suscripciones.create({
      data: {
        tenantId:      tenant.id,
        plan:          nuevoPlan,
        periodo:       datosSuscripcion.periodo || null,
        monto:         datosSuscripcion.monto,
        estado:        'activo',
        fechaInicio:   new Date(),
        fechaFin:      fechaVencimiento,
        pagoReferencia: datosSuscripcion.pagoRef || null,
        proveedor:     datosSuscripcion.proveedor || null,
      },
    });
  }

  // Actualizar plan en la BD del tenant (tabla empresas)
  try {
    const prismaT = getTenantPrisma(tenant);
    await prismaT.empresas.updateMany({
      data: {
        plan:          nuevoPlan,
        factAnualesMax: limites.factAnualesMax,
        maxUsuarios:   limites.maxUsuarios,
      },
    });
  } catch (err) {
    console.warn(`[plan] No se pudo actualizar la BD del tenant '${slug}':`, err.message);
  }

  // Invalidar cache del tenant
  const { invalidarCacheTenant } = require('../middleware/tenant');
  invalidarCacheTenant(slug);

  console.log(`[plan] Tenant '${slug}' actualizado a '${nuevoPlan}'`);
  return tenantActualizado;
}

module.exports = { provisionarTenant, actualizarPlanTenant, generarSlug, generarSlugUnico };
