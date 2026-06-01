/**
 * Aplica columnas faltantes directamente via SQL (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
 * Es idempotente: si la columna ya existe, IF NOT EXISTS la salta sin error.
 * No depende del sistema de migraciones de Prisma.
 */

const { Client } = require('pg');

const FIXES = [
  // Impresora térmica POS — agregadas al schema.prisma pero faltantes en BD de Railway
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraIp"        VARCHAR(50)`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraPuerto"    INTEGER DEFAULT 9100`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraAncho"     INTEGER DEFAULT 80`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraHabilitada"  BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "cajaDineroHabilitada" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresionAutoMobile"  BOOLEAN NOT NULL DEFAULT false`,
];

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    let applied = 0;
    for (const sql of FIXES) {
      await client.query(sql);
      applied++;
    }
    console.log(`[schema-fix] ${applied} columna(s) verificadas/aplicadas en configuracion_sistema.`);
  } catch (err) {
    // No abortar el arranque — solo advertir.
    console.error('[schema-fix] Error al aplicar correcciones de schema:', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

run();
