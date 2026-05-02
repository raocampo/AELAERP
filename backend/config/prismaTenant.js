// ====================================
// PRISMA CLIENT DINÁMICO — Por Tenant
// Crea/reutiliza conexiones Prisma según el tenant activo en el request.
// Cada tenant tiene su propia BD PostgreSQL aislada.
//
// Uso desde middleware:
//   const prisma = await getTenantPrisma(tenant);
//   req.prisma = prisma;  // disponible en todos los handlers
// ====================================

const { PrismaClient } = require('@prisma/client');
const { descifrar }    = require('../utils/cifrado');

// Pool de clientes Prisma — una instancia por BD de tenant
// Se mantienen vivos durante el proceso para reutilizar conexiones
const _pool = new Map(); // slug → PrismaClient

/**
 * Retorna un PrismaClient conectado a la BD del tenant.
 * Si ya existe en el pool, lo reutiliza.
 * @param {object} tenant - Registro de la tabla tenants
 * @returns {PrismaClient}
 */
function getTenantPrisma(tenant) {
  const key = tenant.slug;

  if (_pool.has(key)) {
    return _pool.get(key);
  }

  const url = buildConnectionUrl(tenant);

  const client = new PrismaClient({
    datasources: { db: { url } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  _pool.set(key, client);
  return client;
}

/**
 * Construye la URL de conexión para un tenant.
 * Soporta contraseñas con caracteres especiales (encodeURIComponent).
 */
function buildConnectionUrl(tenant) {
  const pass = encodeURIComponent(descifrar(tenant.dbPass));
  const host = tenant.dbHost || 'localhost';
  const port = tenant.dbPort || 5432;
  const db   = tenant.dbName;
  const user = tenant.dbUser || 'postgres';

  return `postgresql://${user}:${pass}@${host}:${port}/${db}`;
}

/**
 * Elimina un cliente del pool (p.ej. al suspender un tenant).
 * Llama a $disconnect() antes de removerlo.
 */
async function removeTenantFromPool(slug) {
  if (_pool.has(slug)) {
    const client = _pool.get(slug);
    await client.$disconnect().catch(() => {});
    _pool.delete(slug);
  }
}

/**
 * Estadísticas del pool (útil para monitoreo).
 */
function getPoolStats() {
  return {
    total: _pool.size,
    slugs: [..._pool.keys()],
  };
}

// Limpiar todas las conexiones al cerrar el proceso
process.on('beforeExit', async () => {
  for (const [, client] of _pool) {
    await client.$disconnect().catch(() => {});
  }
  _pool.clear();
});

module.exports = { getTenantPrisma, removeTenantFromPool, getPoolStats };
