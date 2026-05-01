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
  if (!_prismaMaster) {
    _prismaMaster = new PrismaClientMaster({
      datasources: {
        db: { url: process.env.DATABASE_MASTER_URL },
      },
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return _prismaMaster;
}

process.on('beforeExit', async () => {
  if (_prismaMaster) await _prismaMaster.$disconnect();
});

module.exports = { getPrismaMaster };
