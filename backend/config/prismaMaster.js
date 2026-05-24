// ====================================
// PRISMA CLIENT — BD MASTER (tenants)
// Conecta a aela_master, la BD que gestiona el catálogo de clientes.
// NO usar para datos operativos de facturas, clientes, etc.
// ====================================

// El cliente master se usa solo en modo multitenant (BD aela_master separada).
// Si el paquete no está instalado, se retorna null y las rutas que lo usen
// responden con 503 "Modo SaaS no activado".
let PrismaClientMaster = null;
try {
  PrismaClientMaster = require('@prisma/client-master').PrismaClient;
} catch (_) {
  // Módulo no instalado — modo monoempresa o primer arranque
}

let _prismaMaster = null;

function getPrismaMaster() {
  if (!PrismaClientMaster) return null;
  if (!process.env.DATABASE_MASTER_URL) return null;
  if (!_prismaMaster) {
    // Forzar esquema aela_master para que Prisma use tablas aisladas del schema público.
    // Así prisma migrate/db push sobre DATABASE_URL (schema public) nunca las toca.
    let url = process.env.DATABASE_MASTER_URL;
    if (!url.includes('schema=')) {
      url += (url.includes('?') ? '&' : '?') + 'schema=aela_master';
    }
    _prismaMaster = new PrismaClientMaster({
      datasources: { db: { url } },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return _prismaMaster;
}

process.on('beforeExit', async () => {
  if (_prismaMaster) await _prismaMaster.$disconnect();
});

module.exports = { getPrismaMaster };
