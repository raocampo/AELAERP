/**
 * Aplica columnas faltantes directamente via SQL (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).
 * Es idempotente: si la columna ya existe, IF NOT EXISTS la salta sin error.
 * Corre contra la BD principal Y contra todas las BDs de tenants activos.
 */

const { Client } = require('pg');

const FIXES = [
  // Impresora térmica POS
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraIp"          VARCHAR(50)`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraPuerto"      INTEGER DEFAULT 9100`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraAncho"       INTEGER DEFAULT 80`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraHabilitada"  BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "cajaDineroHabilitada" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresionAutoMobile"  BOOLEAN NOT NULL DEFAULT false`,
  // SBU Ecuador
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "sbuEcuador"           DECIMAL(8,2) NOT NULL DEFAULT 480.00`,
  // Actualizar SBU al valor 2025 en empresas que tengan aún el valor anterior
  `UPDATE "configuracion_sistema" SET "sbuEcuador" = 480.00 WHERE "sbuEcuador" = 460.00`,
  // facturas_compra — columnas añadidas progresivamente
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "motivoAnulacion"       VARCHAR(500)`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "tipoGasto"             VARCHAR(30)`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "registraInventario"    BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "creaProductos"         BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "movimientosInventario" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "egresoCajaRegistrado"  BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "xmlOrigen"             TEXT`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "observaciones"         TEXT`,
  // Tabla de Utilidades — módulo de márgenes de ganancia para cálculo de PVP
  `CREATE TABLE IF NOT EXISTS "tabla_utilidades" (
    "id"          SERIAL PRIMARY KEY,
    "empresaId"   INTEGER NOT NULL,
    "nombre"      VARCHAR(80) NOT NULL,
    "porcentaje"  DECIMAL(7,2) NOT NULL DEFAULT 30.00,
    "descripcion" VARCHAR(200),
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "tabla_utilidades_empresaId_idx" ON "tabla_utilidades"("empresaId")`,
  // Proformas — cotizaciones / presupuestos
  `CREATE TABLE IF NOT EXISTS "proformas" (
    "id"                  SERIAL PRIMARY KEY,
    "empresaId"           INTEGER NOT NULL DEFAULT 1,
    "numero"              VARCHAR(20) NOT NULL,
    "secuencial"          INTEGER NOT NULL DEFAULT 1,
    "tipoIdentificacion"  VARCHAR(2) NOT NULL DEFAULT '07',
    "identificacion"      VARCHAR(20) NOT NULL DEFAULT '9999999999999',
    "razonSocial"         VARCHAR(300) NOT NULL,
    "direccion"           VARCHAR(300),
    "email"               VARCHAR(150),
    "telefono"            VARCHAR(20),
    "clienteId"           INTEGER,
    "subtotal0"           DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal5"           DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal15"          DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuento"      DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva"            DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles"            JSONB NOT NULL DEFAULT '[]',
    "observaciones"       TEXT,
    "vigenciaDesde"       TIMESTAMP(3),
    "vigenciaHasta"       TIMESTAMP(3),
    "estado"              VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "facturaId"           INTEGER,
    "creadoPor"           INTEGER,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "proformas_empresaId_idx" ON "proformas"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "proformas_estado_idx"    ON "proformas"("estado")`,
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
  const mainUrl   = process.env.DATABASE_URL;
  // DATABASE_MASTER_URL puede apuntar a un DB diferente que contiene aela_master.tenants
  const masterUrl = process.env.DATABASE_MASTER_URL || mainUrl;

  if (!mainUrl) {
    console.error('[schema-fix] DATABASE_URL no definida — omitiendo.');
    return;
  }

  // 1. BD principal (DATABASE_URL)
  await applyFixesToDb(mainUrl, 'BD_principal');

  // 2. Si DATABASE_MASTER_URL ≠ DATABASE_URL, también aplicar allí
  if (masterUrl && masterUrl !== mainUrl) {
    await applyFixesToDb(masterUrl, 'BD_master');
  }

  // 3. BDs de tenants activos — buscar en DATABASE_MASTER_URL (donde está aela_master)
  const masterClient = new Client({ connectionString: masterUrl });
  try {
    await masterClient.connect();

    let tenantRows = [];
    try {
      const { rows } = await masterClient.query(
        `SELECT slug, "dbName", "dbHost", "dbPort", "dbUser", "dbPass" FROM aela_master.tenants WHERE estado = 'activo'`
      );
      tenantRows = rows;
    } catch (err) {
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

    // Credenciales base de DATABASE_URL (mismo servidor, diferente DB por tenant)
    const parsed   = new URL(mainUrl);
    const baseUser = parsed.username;
    const basePass = parsed.password;
    const mainHost = parsed.hostname;
    const mainPort = parsed.port || '5432';

    for (const t of tenantRows) {
      const host = t.dbHost || mainHost;
      const port = t.dbPort || mainPort;

      // Usar credenciales propias del tenant si están disponibles; fallback a las del DB principal
      let tenantUser = t.dbUser || baseUser;
      let tenantPass = basePass;
      if (t.dbPass) {
        try {
          const { descifrar } = require('../utils/cifrado');
          tenantPass = encodeURIComponent(descifrar(t.dbPass));
        } catch {
          // Si no se puede descifrar, usar credenciales del DB principal
        }
      }

      const tenantUrl = `postgresql://${tenantUser}:${tenantPass}@${host}:${port}/${t.dbName}`;
      await applyFixesToDb(tenantUrl, `tenant:${t.slug}`);
    }
  } catch (err) {
    console.error('[schema-fix] Error iterando tenants:', err.message);
  } finally {
    await masterClient.end().catch(() => {});
  }
}

// Ejecutar directamente si es el script principal
if (require.main === module) run();

module.exports = { applyFixesToDb, run };
