#!/usr/bin/env node
// ============================================================
// AELA — Migración de la BD master (aela_master)
//
// Aplica las migraciones de prisma/migrations-master/ a la BD
// master usando Prisma $executeRawUnsafe. Se ejecuta en el
// arranque solo cuando DATABASE_MASTER_URL está configurada.
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const MASTER_URL = process.env.DATABASE_MASTER_URL;

if (!MASTER_URL) {
  console.log('[migrateMaster] DATABASE_MASTER_URL no configurada — omitiendo.');
  process.exit(0);
}

let PrismaClientMaster;
try {
  PrismaClientMaster = require('@prisma/client-master').PrismaClient;
} catch (_) {
  console.log('[migrateMaster] @prisma/client-master no disponible — omitiendo.');
  process.exit(0);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations-master');

async function run() {
  const prisma = new PrismaClientMaster({
    datasources: { db: { url: MASTER_URL } },
    log: ['error'],
  });

  await prisma.$connect();

  // Tabla de control de migraciones aplicadas
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "_aela_master_migrations" (
      "id"        SERIAL PRIMARY KEY,
      "name"      VARCHAR(200) UNIQUE NOT NULL,
      "appliedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const folders = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => fs.statSync(path.join(MIGRATIONS_DIR, f)).isDirectory())
    .sort();

  for (const folder of folders) {
    const sqlFile = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
    if (!fs.existsSync(sqlFile)) continue;

    const applied = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM "_aela_master_migrations" WHERE name = $1`, folder
    );
    if (applied.length > 0) {
      console.log(`[migrateMaster] ✓ ${folder} ya aplicada`);
      continue;
    }

    const sql = fs.readFileSync(sqlFile, 'utf8');
    // Ejecutar sentencia por sentencia para mayor compatibilidad
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_aela_master_migrations" (name) VALUES ($1)`, folder
    );
    console.log(`[migrateMaster] ✔ ${folder} aplicada`);
  }

  await prisma.$disconnect();
  console.log('[migrateMaster] BD master al día.');
}

run().catch(err => {
  console.error('[migrateMaster] Error:', err.message);
  // No salir con error para no bloquear el arranque si la BD master no está lista
  process.exit(0);
});
