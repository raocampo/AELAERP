/**
 * Aplica columnas faltantes directamente via SQL (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
 * Es idempotente: si la columna ya existe, IF NOT EXISTS la salta sin error.
 * Corre contra la BD principal Y contra todas las BDs de tenants activos.
 */

const { Client } = require('pg');

const FIXES = [
  // Impresora térmica POS — agregadas al schema pero faltantes en BDs antiguas
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraIp"          VARCHAR(50)`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraPuerto"      INTEGER DEFAULT 9100`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraAncho"       INTEGER DEFAULT 80`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraHabilitada"  BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "cajaDineroHabilitada" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresionAutoMobile"  BOOLEAN NOT NULL DEFAULT false`,
  // SBU Ecuador — puede faltar en BDs de tenants creados antes de esta columna
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "sbuEcuador"           DECIMAL(8,2) NOT NULL DEFAULT 460.00`,
];

async function applyFixesToDb(connectionString, label) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    for (const sql of FIXES) {
      await client.query(sql);
    }
    console.log(`[schema-fix] ${label}: ${FIXES.length} columna(s) verificadas/aplicadas.`);
  } catch (err) {
    console.error(`[schema-fix] Error en ${label}:`, err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function run() {
  const mainUrl = process.env.DATABASE_URL;
  if (!mainUrl) {
    console.error('[schema-fix] DATABASE_URL no definida — omitiendo.');
    return;
  }

  // 1. BD principal
  await applyFixesToDb(mainUrl, 'BD_principal');

  // 2. BDs de tenants activos (todos en el mismo servidor Railway)
  const masterClient = new Client({ connectionString: mainUrl });
  try {
    await masterClient.connect();

    let tenantRows = [];
    try {
      // El campo es "estado" (varchar), no un booleano "activo"
      const { rows } = await masterClient.query(
        `SELECT slug, "dbName", "dbHost", "dbPort" FROM aela_master.tenants WHERE estado = 'activo'`
      );
      tenantRows = rows;
    } catch (err) {
      // Solo ignorar si el schema aela_master no existe (instancias sin multi-tenant)
      const esSchemaMissing = /schema.*aela_master.*does not exist|relation.*aela_master.*does not exist/i.test(err.message);
      if (esSchemaMissing) {
        console.log('[schema-fix] Schema aela_master no encontrado — instancia sin multi-tenant.');
      } else {
        console.error('[schema-fix] Error al leer tenants:', err.message);
      }
    }

    if (tenantRows.length === 0) {
      console.log('[schema-fix] Sin tenants activos que corregir.');
      return;
    }

    // Reusar credenciales del DATABASE_URL (mismo servidor, diferente BD)
    const parsed   = new URL(mainUrl);
    const user     = parsed.username;
    const pass     = parsed.password;
    const mainHost = parsed.hostname;
    const mainPort = parsed.port || '5432';

    for (const t of tenantRows) {
      const host     = t.dbHost || mainHost;
      const port     = t.dbPort || mainPort;
      const tenantUrl = `postgresql://${user}:${pass}@${host}:${port}/${t.dbName}`;
      await applyFixesToDb(tenantUrl, `tenant:${t.slug}`);
    }
  } catch (err) {
    console.error('[schema-fix] Error iterando tenants:', err.message);
  } finally {
    await masterClient.end().catch(() => {});
  }
}

run();
