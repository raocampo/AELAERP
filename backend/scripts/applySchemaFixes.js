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
  // facturas — importación histórica
  `ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "origenRegistro" VARCHAR(30) NOT NULL DEFAULT 'MANUAL'`,
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
  // Forma de pago en proformas (campo agregado 2026-06-18)
  `ALTER TABLE "proformas" ADD COLUMN IF NOT EXISTS "formaPago" VARCHAR(100)`,
  // Firma digital y sello de empresa para proformas (2026-06-20)
  `ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "firmaUrl" TEXT`,
  `ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "selloUrl" TEXT`,
  // Configuración contable — cuentas del plan de cuentas propio enlazadas a los
  // asientos automáticos de compras (2026-07-04)
  `CREATE TABLE IF NOT EXISTS "configuracion_contable" (
    "id"                       SERIAL PRIMARY KEY,
    "empresaId"                INTEGER NOT NULL UNIQUE,
    "codigoCuentaComprasGasto" VARCHAR(20),
    "codigoCuentaInventario"   VARCHAR(20),
    "codigoCuentaIvaCompras"   VARCHAR(20),
    "codigoCuentaCxP"          VARCHAR(20),
    "codigoCuentaCajaCompras"  VARCHAR(20),
    "codigoCuentaCostoVentas"  VARCHAR(20),
    "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  // Cuenta de costo de ventas (inventario permanente) — agregada después de la
  // creación inicial de configuracion_contable, por eso va también como ALTER idempotente.
  `ALTER TABLE "configuracion_contable" ADD COLUMN IF NOT EXISTS "codigoCuentaCostoVentas" VARCHAR(20)`,
  // Centros de costo — dimensión opcional en líneas de asiento (2026-07-04)
  `CREATE TABLE IF NOT EXISTS "centros_costo" (
    "id"          SERIAL PRIMARY KEY,
    "empresaId"   INTEGER NOT NULL,
    "codigo"      VARCHAR(20) NOT NULL,
    "nombre"      VARCHAR(150) NOT NULL,
    "descripcion" VARCHAR(300),
    "activo"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "centros_costo_empresaId_codigo_key" ON "centros_costo"("empresaId", "codigo")`,
  `CREATE INDEX IF NOT EXISTS "centros_costo_empresaId_idx" ON "centros_costo"("empresaId")`,
  `ALTER TABLE "asientos_contables_detalle" ADD COLUMN IF NOT EXISTS "centroCostoId" INTEGER`,
  // Configuración de cuentas por referencia — mapeo genérico código->cuenta para
  // catálogos largos: retenciones compras/ventas, nómina, general (2026-07-07)
  `CREATE TABLE IF NOT EXISTS "configuracion_cuentas_referencia" (
    "id"               SERIAL PRIMARY KEY,
    "empresaId"        INTEGER NOT NULL,
    "categoria"        VARCHAR(30) NOT NULL,
    "codigoReferencia" VARCHAR(20) NOT NULL,
    "cuentaId"         INTEGER NOT NULL,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "config_cuentas_ref_empresa_cat_cod_key" ON "configuracion_cuentas_referencia"("empresaId", "categoria", "codigoReferencia")`,
  `CREATE INDEX IF NOT EXISTS "config_cuentas_ref_empresaId_idx" ON "configuracion_cuentas_referencia"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "config_cuentas_ref_cuentaId_idx" ON "configuracion_cuentas_referencia"("cuentaId")`,
  // Cuentas por Cobrar / Pagar — subledger de cobros y pagos (2026-07-07)
  `CREATE TABLE IF NOT EXISTS "cobros_cliente" (
    "id"                 SERIAL PRIMARY KEY,
    "empresaId"          INTEGER NOT NULL,
    "facturaId"          INTEGER NOT NULL,
    "clienteId"          INTEGER,
    "numero"             VARCHAR(20) NOT NULL,
    "fecha"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"              DECIMAL(14,2) NOT NULL,
    "metodoPago"         VARCHAR(20) NOT NULL,
    "bancoId"            INTEGER,
    "chequeId"           INTEGER,
    "referencia"         VARCHAR(100),
    "observaciones"      TEXT,
    "asientoId"          INTEGER,
    "anulado"            BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion"    VARCHAR(500),
    "fechaAnulacion"     TIMESTAMP(3),
    "usuarioId"          INTEGER,
    "usuarioAnulacionId" INTEGER,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "cobros_cliente_empresaId_numero_key" ON "cobros_cliente"("empresaId", "numero")`,
  `CREATE INDEX IF NOT EXISTS "cobros_cliente_empresaId_idx" ON "cobros_cliente"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "cobros_cliente_facturaId_idx" ON "cobros_cliente"("facturaId")`,
  `CREATE INDEX IF NOT EXISTS "cobros_cliente_clienteId_idx" ON "cobros_cliente"("clienteId")`,
  `CREATE INDEX IF NOT EXISTS "cobros_cliente_fecha_idx" ON "cobros_cliente"("fecha")`,
  `CREATE TABLE IF NOT EXISTS "pagos_proveedor" (
    "id"                 SERIAL PRIMARY KEY,
    "empresaId"          INTEGER NOT NULL,
    "compraId"           INTEGER NOT NULL,
    "proveedorId"        INTEGER,
    "numero"             VARCHAR(20) NOT NULL,
    "fecha"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"              DECIMAL(14,2) NOT NULL,
    "metodoPago"         VARCHAR(20) NOT NULL,
    "bancoId"            INTEGER,
    "chequeId"           INTEGER,
    "referencia"         VARCHAR(100),
    "observaciones"      TEXT,
    "asientoId"          INTEGER,
    "anulado"            BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion"    VARCHAR(500),
    "fechaAnulacion"     TIMESTAMP(3),
    "usuarioId"          INTEGER,
    "usuarioAnulacionId" INTEGER,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "pagos_proveedor_empresaId_numero_key" ON "pagos_proveedor"("empresaId", "numero")`,
  `CREATE INDEX IF NOT EXISTS "pagos_proveedor_empresaId_idx" ON "pagos_proveedor"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "pagos_proveedor_compraId_idx" ON "pagos_proveedor"("compraId")`,
  `CREATE INDEX IF NOT EXISTS "pagos_proveedor_proveedorId_idx" ON "pagos_proveedor"("proveedorId")`,
  `CREATE INDEX IF NOT EXISTS "pagos_proveedor_fecha_idx" ON "pagos_proveedor"("fecha")`,
  // Comprobantes bancarios numerados por categoría (2026-07-07)
  `ALTER TABLE "movimientos_bancarios" ADD COLUMN IF NOT EXISTS "numero" VARCHAR(20)`,
  // Catálogo de transportistas para autocompletar guías de remisión (2026-07-07)
  `CREATE TABLE IF NOT EXISTS "transportistas" (
    "id"             SERIAL PRIMARY KEY,
    "empresaId"      INTEGER NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "nombre"         VARCHAR(300) NOT NULL,
    "placaVehiculo"  VARCHAR(20),
    "activo"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "transportistas_empresaId_identificacion_key" ON "transportistas"("empresaId", "identificacion")`,
  `CREATE INDEX IF NOT EXISTS "transportistas_empresaId_idx" ON "transportistas"("empresaId")`,
  // Caja Chica (2026-07-08)
  `CREATE TABLE IF NOT EXISTS "cajas_chicas" (
    "id"                    SERIAL PRIMARY KEY,
    "empresaId"             INTEGER NOT NULL,
    "codigo"                VARCHAR(20) NOT NULL,
    "nombre"                VARCHAR(150) NOT NULL,
    "responsableId"         INTEGER,
    "montoFondo"            DECIMAL(12,2) NOT NULL,
    "cuentaFondoId"         INTEGER,
    "cuentaContrapartidaId" INTEGER,
    "estado"                VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
    "fechaApertura"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaCierre"           TIMESTAMP(3),
    "observaciones"         TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "cajas_chicas_empresaId_codigo_key" ON "cajas_chicas"("empresaId", "codigo")`,
  `CREATE INDEX IF NOT EXISTS "cajas_chicas_empresaId_idx" ON "cajas_chicas"("empresaId")`,
  `CREATE TABLE IF NOT EXISTS "movimientos_caja_chica" (
    "id"              SERIAL PRIMARY KEY,
    "cajaChicaId"     INTEGER NOT NULL,
    "empresaId"       INTEGER NOT NULL,
    "numero"          VARCHAR(30),
    "tipo"            VARCHAR(20) NOT NULL,
    "fecha"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concepto"        VARCHAR(300) NOT NULL,
    "monto"           DECIMAL(12,2) NOT NULL,
    "nroComprobante"  VARCHAR(50),
    "proveedor"       VARCHAR(200),
    "cuentaGastoId"   INTEGER,
    "centroCostoId"   INTEGER,
    "asientoId"       INTEGER,
    "anulado"         BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" VARCHAR(300),
    "usuarioId"       INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "movimientos_caja_chica_cajaChicaId_idx" ON "movimientos_caja_chica"("cajaChicaId")`,
  `CREATE INDEX IF NOT EXISTS "movimientos_caja_chica_empresaId_idx" ON "movimientos_caja_chica"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "movimientos_caja_chica_fecha_idx" ON "movimientos_caja_chica"("fecha")`,
  // Cuenta contable específica por factura de compra — anula el default global (2026-07-08)
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "cuentaGastoId" INTEGER`,
  // Comprobantes Bancarios: Ingreso, Pago, Crédito, Débito (2026-07-08)
  `CREATE TABLE IF NOT EXISTS "comprobantes_bancarios" (
    "id"               SERIAL PRIMARY KEY,
    "numero"           VARCHAR(50),
    "tipo"             VARCHAR(30) NOT NULL,
    "subtipo"          VARCHAR(50) NOT NULL DEFAULT 'GENERAL',
    "fecha"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notas"            TEXT,
    "estado"           VARCHAR(20) NOT NULL DEFAULT 'ARCHIVADO',
    "total"            DECIMAL(14,2) NOT NULL DEFAULT 0,
    "empresaId"        INTEGER NOT NULL,
    "cuentaBancariaId" INTEGER,
    "proveedorId"      INTEGER,
    "movimientoId"     INTEGER,
    "creadoPorId"      INTEGER,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "comprobantes_bancarios_cuentas" (
    "id"               SERIAL PRIMARY KEY,
    "comprobanteId"    INTEGER NOT NULL REFERENCES "comprobantes_bancarios"("id") ON DELETE CASCADE,
    "notas"            TEXT,
    "valor"            DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cuentaContableId" INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS "comprobantes_bancarios_pagos" (
    "id"               SERIAL PRIMARY KEY,
    "comprobanteId"    INTEGER NOT NULL REFERENCES "comprobantes_bancarios"("id") ON DELETE CASCADE,
    "tipoPago"         VARCHAR(30) NOT NULL DEFAULT 'EFECTIVO',
    "valor"            DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cuentaContableId" INTEGER,
    "notas"            TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "cpb_empresa_tipo_idx" ON "comprobantes_bancarios"("empresaId", "tipo")`,
  `CREATE INDEX IF NOT EXISTS "cpb_empresa_fecha_idx" ON "comprobantes_bancarios"("empresaId", "fecha")`,
  // Cheques recibidos (CxC) — 2026-07-09
  `CREATE TABLE IF NOT EXISTS "cheques_recibidos" (
    "id"              SERIAL PRIMARY KEY,
    "empresaId"       INTEGER NOT NULL,
    "numero"          VARCHAR(50) NOT NULL,
    "banco"           VARCHAR(150) NOT NULL,
    "monto"           DECIMAL(14,2) NOT NULL,
    "fecha"           DATE NOT NULL,
    "fechaRecepcion"  DATE NOT NULL DEFAULT CURRENT_DATE,
    "fechaDeposito"   DATE,
    "clienteId"       INTEGER,
    "clienteNombre"   VARCHAR(300) NOT NULL DEFAULT '',
    "facturaId"       INTEGER,
    "estado"          VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "observaciones"   TEXT,
    "usuarioId"       INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "cheques_recibidos_empresaId_idx" ON "cheques_recibidos"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "cheques_recibidos_estado_idx"    ON "cheques_recibidos"("empresaId", "estado")`,
  // Tarjetas de crédito corporativas (CxP) — 2026-07-09
  `CREATE TABLE IF NOT EXISTS "tarjetas_credito" (
    "id"               SERIAL PRIMARY KEY,
    "empresaId"        INTEGER NOT NULL,
    "nombre"           VARCHAR(150) NOT NULL,
    "numero"           VARCHAR(20) NOT NULL DEFAULT '****',
    "banco"            VARCHAR(100) NOT NULL,
    "limiteCredito"    DECIMAL(14,2) NOT NULL DEFAULT 0,
    "corte"            INTEGER NOT NULL DEFAULT 20,
    "vencimientoPago"  INTEGER NOT NULL DEFAULT 10,
    "activa"           BOOLEAN NOT NULL DEFAULT true,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "tarjetas_credito_empresaId_idx" ON "tarjetas_credito"("empresaId")`,
  `CREATE TABLE IF NOT EXISTS "movimientos_tarjeta" (
    "id"          SERIAL PRIMARY KEY,
    "empresaId"   INTEGER NOT NULL,
    "tarjetaId"   INTEGER NOT NULL,
    "fecha"       DATE NOT NULL,
    "concepto"    VARCHAR(300) NOT NULL,
    "monto"       DECIMAL(14,2) NOT NULL,
    "tipo"        VARCHAR(20) NOT NULL DEFAULT 'CARGO',
    "referencia"  VARCHAR(100),
    "observaciones" TEXT,
    "proveedorId" INTEGER,
    "compraId"    INTEGER,
    "estado"      VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "usuarioId"   INTEGER,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "movimientos_tarjeta_tarjetaId_idx" ON "movimientos_tarjeta"("tarjetaId")`,
  `CREATE INDEX IF NOT EXISTS "movimientos_tarjeta_empresaId_idx" ON "movimientos_tarjeta"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "movimientos_tarjeta_fecha_idx"     ON "movimientos_tarjeta"("fecha")`,
  // Crédito tributario de IVA arrastrado — Formulario 104 (2026-07-12)
  `CREATE TABLE IF NOT EXISTS "declaraciones_credito_iva" (
    "id"                        SERIAL PRIMARY KEY,
    "empresaId"                 INTEGER NOT NULL,
    "anio"                      INTEGER NOT NULL,
    "mes"                       INTEGER NOT NULL,
    "creditoTributarioAnterior" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usuarioId"                 INTEGER,
    "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "declaraciones_credito_iva_empresaId_anio_mes_key" ON "declaraciones_credito_iva"("empresaId", "anio", "mes")`,
  // Compras facturadas a cédula vs RUC — no deducibles si NO es RUC (2026-07-12)
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "receptorEsRuc" BOOLEAN`,
  // Anticipos de clientes y proveedores (2026-07-13)
  `CREATE TABLE IF NOT EXISTS "anticipos_cliente" (
    "id"              SERIAL PRIMARY KEY,
    "empresaId"       INTEGER NOT NULL,
    "clienteId"       INTEGER,
    "nombreCliente"   VARCHAR(300) NOT NULL,
    "numero"          VARCHAR(30) NOT NULL,
    "fecha"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"           DECIMAL(14,2) NOT NULL,
    "saldoPendiente"  DECIMAL(14,2) NOT NULL,
    "metodoPago"      VARCHAR(20) NOT NULL DEFAULT 'efectivo',
    "referencia"      VARCHAR(100),
    "observaciones"   TEXT,
    "anulado"         BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" VARCHAR(500),
    "asientoId"       INTEGER,
    "usuarioId"       INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "anticipos_cliente_empresaId_numero_key" ON "anticipos_cliente"("empresaId", "numero")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_cliente_empresaId_idx" ON "anticipos_cliente"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_cliente_clienteId_idx" ON "anticipos_cliente"("clienteId")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_cliente_fecha_idx"     ON "anticipos_cliente"("fecha")`,
  `CREATE TABLE IF NOT EXISTS "anticipos_proveedor" (
    "id"              SERIAL PRIMARY KEY,
    "empresaId"       INTEGER NOT NULL,
    "proveedorId"     INTEGER,
    "nombreProveedor" VARCHAR(300) NOT NULL,
    "numero"          VARCHAR(30) NOT NULL,
    "fecha"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"           DECIMAL(14,2) NOT NULL,
    "saldoPendiente"  DECIMAL(14,2) NOT NULL,
    "metodoPago"      VARCHAR(20) NOT NULL DEFAULT 'efectivo',
    "referencia"      VARCHAR(100),
    "observaciones"   TEXT,
    "anulado"         BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" VARCHAR(500),
    "asientoId"       INTEGER,
    "usuarioId"       INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "anticipos_proveedor_empresaId_numero_key" ON "anticipos_proveedor"("empresaId", "numero")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_proveedor_empresaId_idx"   ON "anticipos_proveedor"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_proveedor_proveedorId_idx" ON "anticipos_proveedor"("proveedorId")`,
  `CREATE INDEX IF NOT EXISTS "anticipos_proveedor_fecha_idx"       ON "anticipos_proveedor"("fecha")`,
  // Gastos personales en facturas de compra — excluir de declaración IVA F104 (2026-07-13)
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "esGastoPersonal"        BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "categoriaGastoPersonal" VARCHAR(30)`,
];

async function applyFixesToDb(connectionString, label) {
  const client = new Client({ connectionString });
  try {
    await client.connect();
    let errores = 0;
    for (const sql of FIXES) {
      try {
        await client.query(sql);
      } catch (sqlErr) {
        // Cada SQL es independiente: si uno falla no bloqueamos los demás
        errores++;
        console.warn(`[schema-fix] ${label} advertencia: ${sqlErr.message.split('\n')[0]}`);
      }
    }
    console.log(`[schema-fix] ${label}: ${FIXES.length} sentencias verificadas${errores ? ` (${errores} advertencias)` : ''}.`);
  } catch (err) {
    console.error(`[schema-fix] Error de conexión en ${label}:`, err.message);
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
