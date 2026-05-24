// ============================================================
// SCRIPT: Corrige las credenciales de tenants mal registrados.
// Reemplaza dbHost/dbPass generados incorrectamente con los
// datos reales del servidor PostgreSQL (DATABASE_ADMIN_URL).
//
// Uso: node scripts/fixTenantCredentials.js
// ============================================================
require('dotenv').config();
const { getPrismaMaster } = require('../config/prismaMaster');
const { cifrar }          = require('../utils/cifrado');

function parsearDbUrl(url) {
  try {
    const u = new URL(url);
    return {
      host:     u.hostname,
      port:     u.port || '5432',
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    };
  } catch {
    throw new Error(`URL de BD inválida: ${url}`);
  }
}

async function main() {
  const master = getPrismaMaster();
  if (!master) {
    console.error('BD master no disponible (DATABASE_MASTER_URL no configurado).');
    process.exit(1);
  }

  const adminUrl = process.env.DATABASE_ADMIN_URL
    || process.env.DATABASE_MASTER_URL
    || process.env.DATABASE_URL;
  if (!adminUrl) {
    console.error('No hay URL de admin configurada.');
    process.exit(1);
  }
  const conn = parsearDbUrl(adminUrl);

  const tenants = await master.tenants.findMany({
    where: { dbHost: 'localhost' },
  });

  if (tenants.length === 0) {
    console.log('No hay tenants con dbHost=localhost. Nada que corregir.');
    return;
  }

  console.log(`Corrigiendo ${tenants.length} tenant(s) con dbHost=localhost...`);

  for (const t of tenants) {
    await master.tenants.update({
      where: { id: t.id },
      data: {
        dbHost: conn.host,
        dbPort: parseInt(conn.port, 10),
        dbUser: conn.user,
        dbPass: cifrar(conn.password),
      },
    });
    console.log(`  ✔ ${t.slug} → ${conn.host}:${conn.port}`);
  }

  console.log('Corrección completada.');
  await master.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
