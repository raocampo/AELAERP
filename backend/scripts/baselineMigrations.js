/**
 * Baseline de migraciones Prisma para BDs que fueron creadas con `db push`.
 *
 * Cuando la BD tiene tablas pero no tiene `_prisma_migrations`,
 * `prisma migrate deploy` falla con P3005. Este script crea el historial
 * marcando todas las migraciones existentes como ya aplicadas, de modo que
 * el siguiente `migrate deploy` solo aplique las nuevas.
 */

const { execSync } = require('child_process');
const { Client }   = require('pg');
const fs           = require('fs');
const path         = require('path');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();

    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name   = '_prisma_migrations'
      ) AS existe;
    `);

    if (rows[0].existe) {
      console.log('[baseline] _prisma_migrations ya existe — no se requiere baseline.');
      return;
    }

    console.log('[baseline] _prisma_migrations no existe. Aplicando baseline de todas las migraciones...');

    const migrationsDir = path.join(__dirname, '../prisma/migrations');
    const migrations = fs.readdirSync(migrationsDir)
      .filter(name => {
        const full = path.join(migrationsDir, name);
        return name !== 'migration_lock.toml' && fs.statSync(full).isDirectory();
      })
      .sort();

    for (const migration of migrations) {
      console.log(`[baseline]   → marcando ${migration}`);
      try {
        execSync(
          `npx prisma migrate resolve --applied "${migration}" --schema prisma/schema.prisma`,
          { stdio: 'inherit' }
        );
      } catch {
        // Si ya fue marcada (re-run del script), ignorar el error.
        console.log(`[baseline]   ⚠ ${migration} ya estaba marcada o falló — se ignora.`);
      }
    }

    console.log('[baseline] Baseline completado. migrate deploy solo aplicará migraciones nuevas.');

  } catch (err) {
    console.error('[baseline] Error inesperado:', err.message);
    // No abortamos el arranque — el servidor intentará continuar.
  } finally {
    await client.end().catch(() => {});
  }
}

run();
