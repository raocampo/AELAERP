#!/usr/bin/env node
// ============================================================
// AELA — Migración de la BD master
//
// Crea el esquema PostgreSQL "aela_master" (aislado del esquema
// público donde viven las tablas de tenants) y aplica las
// migraciones de prisma/migrations-master/.
//
// Usar pg directo evita depender de @prisma/client-master en el
// momento del arranque, y garantiza que SET search_path funcione.
// ============================================================

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Client } = require('pg');

const MASTER_URL = process.env.DATABASE_MASTER_URL;

if (!MASTER_URL) {
  console.log('[migrateMaster] DATABASE_MASTER_URL no configurada — omitiendo.');
  process.exit(0);
}

const MIGRATIONS_DIR = path.join(__dirname, '..', 'prisma', 'migrations-master');

async function run() {
  const client = new Client({ connectionString: MASTER_URL });
  await client.connect();

  try {
    // 1. Crear esquema aislado — prisma migrate/db push nunca lo toca
    await client.query('CREATE SCHEMA IF NOT EXISTS aela_master');
    await client.query('SET search_path TO aela_master');

    // 2. Tabla de control de migraciones aplicadas
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_aela_master_migrations" (
        "id"        SERIAL PRIMARY KEY,
        "name"      VARCHAR(200) UNIQUE NOT NULL,
        "appliedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // 3. Aplicar cada migración pendiente
    const folders = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => fs.statSync(path.join(MIGRATIONS_DIR, f)).isDirectory())
      .sort();

    for (const folder of folders) {
      const sqlFile = path.join(MIGRATIONS_DIR, folder, 'migration.sql');
      if (!fs.existsSync(sqlFile)) continue;

      const applied = await client.query(
        `SELECT 1 FROM "_aela_master_migrations" WHERE name = $1`, [folder]
      );
      if (applied.rowCount > 0) {
        console.log(`[migrateMaster] ✓ ${folder} ya aplicada`);
        continue;
      }

      const sql = fs.readFileSync(sqlFile, 'utf8');
      const statements = sql.split(';').map(s => s.trim()).filter(Boolean);
      for (const stmt of statements) {
        await client.query(stmt);
      }
      await client.query(
        `INSERT INTO "_aela_master_migrations" (name) VALUES ($1)`, [folder]
      );
      console.log(`[migrateMaster] ✔ ${folder} aplicada`);
    }

    console.log('[migrateMaster] BD master al día.');
  } finally {
    await client.end();
  }
}

run().catch(err => {
  console.error('[migrateMaster] Error:', err.message);
  // No salir con error — permite que el servidor arranque aunque master falle
  process.exit(0);
});
