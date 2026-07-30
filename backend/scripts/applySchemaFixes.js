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
  // codigoReferencia nació en VARCHAR(20) pero el catálogo de nómina/general
  // tiene códigos de hasta 34 caracteres (INVENTARIO_TRANSFERENCIAS_TRANSITO)
  // — causaba P2000 "value too long for column" al guardar (2026-07-13).
  `ALTER TABLE "configuracion_cuentas_referencia" ALTER COLUMN "codigoReferencia" TYPE VARCHAR(50)`,
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
  // Auditoría — tabla existe en tenants antiguos pero nunca recibió las
  // columnas ip/userAgent que utils/auditoria.js viene escribiendo desde
  // hace tiempo (2026-07-13). registrarAuditoria() nunca deja que esto
  // interrumpa la operación principal (try/catch propio), pero sí
  // contaminaba los logs de Railway con "column userAgent does not exist"
  // en cada acción auditada de esos tenants — útil de corregir igual.
  `CREATE TABLE IF NOT EXISTS "auditoria" (
    "id"          SERIAL PRIMARY KEY,
    "empresaId"   INTEGER NOT NULL DEFAULT 1,
    "usuarioId"   INTEGER,
    "accion"      VARCHAR(100) NOT NULL,
    "tabla"       VARCHAR(100),
    "registroId"  INTEGER,
    "datosAntes"  JSONB,
    "datosNuevos" JSONB,
    "ip"          VARCHAR(45),
    "userAgent"   VARCHAR(500),
    "fecha"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `ALTER TABLE "auditoria" ADD COLUMN IF NOT EXISTS "ip"        VARCHAR(45)`,
  `ALTER TABLE "auditoria" ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(500)`,
  `CREATE INDEX IF NOT EXISTS "auditoria_empresaId_idx" ON "auditoria"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "auditoria_accion_idx"    ON "auditoria"("accion")`,
  `CREATE INDEX IF NOT EXISTS "auditoria_fecha_idx"     ON "auditoria"("fecha")`,
  // IVA 12% histórico Ecuador (pre-2024-04-01) — campo subtotal12 (2026-07-15)
  // Ecuador usó 12% desde 2001 hasta el 31-mar-2024 (y 14% brevemente en 2016-2017).
  // La tarifa 15% rige desde el 01-abr-2024 (Ley Orgánica de Eficiencia Económica),
  // confirmado en utils/sri.js:96 y verificado empíricamente contra exports reales
  // del SRI de un cliente (cero comprobantes a 12% en todo abril-2024).
  // Antes este sistema guardaba toda base gravada en subtotal15 como catch-all.
  // La columna subtotal12 separa correctamente esa base para ATS, F104 y XML SRI.
  //
  // CORRECCIÓN 2026-07-27: el corte original de este fix usaba '2024-04-22' en vez
  // de '2024-04-01' — reclasificó incorrectamente 3 semanas de compras realmente
  // al 15% (01 al 21 de abril de 2024) como si fueran al 12%, subestimando el IVA
  // en esos registros. Se corrigieron en producción con
  // scripts/corregirCorteIva15Abril2024.js (backup + fix + regeneración de
  // asientos). La fecha de corte se corrige aquí para que este UPDATE no vuelva a
  // tocar esos registros ya corregidos en el próximo arranque (ahora solo aplica
  // a fechaEmision < '2024-04-01', que es idempotente: subtotal15 ya es 0 ahí).
  `ALTER TABLE "facturas"            ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE "facturas_compra"     ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE "liquidaciones_compra" ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  // Backfill retroactivo: mover subtotal15 → subtotal12 en registros pre-2024-04-01.
  // Es idempotente: después del primer run, subtotal15 ya es 0 en esos registros.
  `UPDATE "facturas"            SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-01' AND "subtotal15" > 0`,
  `UPDATE "facturas_compra"     SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-01' AND "subtotal15" > 0`,
  `UPDATE "liquidaciones_compra" SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-01' AND "subtotal15" > 0`,
  // IVA 5% en liquidaciones de compra (2026-07-16) — nunca existió esta columna:
  // el formulario solo permitía elegir 0%/15% y el cálculo de IVA ignoraba 5%,
  // así que no hace falta backfill (no puede haber datos previos en 5%).
  `ALTER TABLE "liquidaciones_compra" ADD COLUMN IF NOT EXISTS "subtotal5" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  // Compras "No objeto de IVA" (2026-07-17) — categoría SRI distinta de
  // tarifa 0% (subtotal0). Sin backfill, ver migración para detalle.
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "subtotalNoObjeto" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  // Compras "Exenta de IVA" (2026-07-21) — categoría SRI propia, distinta de
  // "No objeto" pese a haberse combinado con ella desde el 07-17 (ver
  // migración para el detalle de por qué eran el mismo campo hasta ahora).
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "subtotalExento" DECIMAL(14,2) NOT NULL DEFAULT 0`,
  // Tipo de comprobante recibido del proveedor en compras (2026-07-17) —
  // FACTURA (default) o NOTA_VENTA (proveedor RIMPE Negocio Popular).
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "tipoComprobante" VARCHAR(20) NOT NULL DEFAULT 'FACTURA'`,
  // Módulos activables por empresa (2026-07-17) — Buzón SRI, Tributario
  // (declaraciones/retenciones recibidas/reportes) y Bancos ahora tienen flag
  // propio en vez de depender de comprasHabilitadas o quedar sin gate. Default
  // true: no oculta nada para tenants existentes hasta que se reconfigure.
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "buzonSriHabilitado" BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "tributarioHabilitado" BOOLEAN NOT NULL DEFAULT true`,
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "bancosHabilitado" BOOLEAN NOT NULL DEFAULT true`,
  // Techo de módulos contratados por tenant (2026-07-17) — null = usar el techo
  // legado derivado de `plan`, ver capacidadesModulos() en configuracionSistema.js.
  `ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "modulosContratados" JSONB`,
  // Facturación como módulo activable (2026-07-17) — antes siempre visible sin flag.
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "facturacionHabilitada" BOOLEAN NOT NULL DEFAULT true`,
  // Regalos/combos de proveedor en compras (2026-07-23) — prefijos configurables
  // (ej. "P-", "OBQ-") para sumar ítems a $0.00 al producto real en vez de crear
  // uno huérfano, y tabla de ítems sin match para resolución manual.
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "prefijosRegaloCompras" TEXT`,
  `CREATE TABLE IF NOT EXISTS "items_compra_pendientes" (
    "id"                     SERIAL PRIMARY KEY,
    "empresaId"              INTEGER NOT NULL,
    "compraId"               INTEGER NOT NULL,
    "codigoPrincipal"        VARCHAR(50) NOT NULL,
    "codigoAuxiliar"         VARCHAR(50),
    "descripcion"            VARCHAR(300) NOT NULL,
    "cantidad"               DECIMAL(14,3) NOT NULL,
    "prefijoDetectado"       VARCHAR(20),
    "estado"                 VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "productoAsignadoId"     INTEGER,
    "usuarioResuelveId"      INTEGER,
    "movimientoInventarioId" INTEGER,
    "resueltoEn"             TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "items_compra_pendientes_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "facturas_compra"("id") ON DELETE CASCADE,
    CONSTRAINT "items_compra_pendientes_productoAsignadoId_fkey" FOREIGN KEY ("productoAsignadoId") REFERENCES "productos_servicios"("id") ON DELETE SET NULL,
    CONSTRAINT "items_compra_pendientes_usuarioResuelveId_fkey" FOREIGN KEY ("usuarioResuelveId") REFERENCES "usuarios"("id") ON DELETE SET NULL,
    CONSTRAINT "items_compra_pendientes_movimientoInventarioId_fkey" FOREIGN KEY ("movimientoInventarioId") REFERENCES "movimientos_inventario"("id") ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "items_compra_pendientes_empresaId_idx" ON "items_compra_pendientes"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "items_compra_pendientes_compraId_idx" ON "items_compra_pendientes"("compraId")`,
  `CREATE INDEX IF NOT EXISTS "items_compra_pendientes_estado_idx" ON "items_compra_pendientes"("estado")`,
  // Sucursales y Puntos de Venta multi-caja (2026-07-24) — Sucursal = local
  // físico (establecimiento SRI); Punto de Venta/Caja = caja registradora
  // dentro de una sucursal (punto de emisión SRI). Se agregan
  // establecimiento/puntoEmision a los documentos SRI que hoy calculaban su
  // secuencial sin filtrar por punto de venta (bug: dos cajas se pisarían
  // la numeración) — mismo patrón que ya tenía guias_remision.
  `CREATE TABLE IF NOT EXISTS "sucursales" (
    "id"              SERIAL PRIMARY KEY,
    "empresaId"       INTEGER NOT NULL,
    "nombre"          VARCHAR(150) NOT NULL,
    "establecimiento" VARCHAR(3) NOT NULL,
    "direccion"       VARCHAR(300),
    "telefono"        VARCHAR(20),
    "esMatriz"        BOOLEAN NOT NULL DEFAULT false,
    "activo"          BOOLEAN NOT NULL DEFAULT true,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sucursales_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "sucursales_empresaId_establecimiento_key" ON "sucursales"("empresaId", "establecimiento")`,
  `CREATE INDEX IF NOT EXISTS "sucursales_empresaId_idx" ON "sucursales"("empresaId")`,
  `ALTER TABLE "puntos_emision" ADD COLUMN IF NOT EXISTS "sucursalId" INTEGER`,
  `CREATE INDEX IF NOT EXISTS "puntos_emision_sucursalId_idx" ON "puntos_emision"("sucursalId")`,
  `ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `CREATE INDEX IF NOT EXISTS "facturas_empresaId_establecimiento_puntoEmision_idx" ON "facturas"("empresaId", "establecimiento", "puntoEmision")`,
  `ALTER TABLE "notas_credito" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "notas_credito" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `CREATE INDEX IF NOT EXISTS "notas_credito_empresaId_establecimiento_puntoEmision_idx" ON "notas_credito"("empresaId", "establecimiento", "puntoEmision")`,
  `ALTER TABLE "notas_debito" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "notas_debito" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `CREATE INDEX IF NOT EXISTS "notas_debito_empresaId_establecimiento_puntoEmision_idx" ON "notas_debito"("empresaId", "establecimiento", "puntoEmision")`,
  `ALTER TABLE "retenciones" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "retenciones" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `CREATE INDEX IF NOT EXISTS "retenciones_empresaId_establecimiento_puntoEmision_idx" ON "retenciones"("empresaId", "establecimiento", "puntoEmision")`,
  `ALTER TABLE "liquidaciones_compra" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "liquidaciones_compra" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `CREATE INDEX IF NOT EXISTS "liquidaciones_compra_empresaId_establecimiento_puntoEmision_idx" ON "liquidaciones_compra"("empresaId", "establecimiento", "puntoEmision")`,
  `ALTER TABLE "notas_venta" ADD COLUMN IF NOT EXISTS "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001'`,
  `ALTER TABLE "notas_venta" ADD COLUMN IF NOT EXISTS "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001'`,
  // Backfill: derivar establecimiento/puntoEmision del número ya formateado
  // en vez de dejar el default '001' parejo — algunos tenants (ej.
  // importaciones históricas) tienen documentos de otro establecimiento/punto.
  // Reversible/idempotente: si ya coincide, el UPDATE no cambia nada.
  `UPDATE "facturas" SET "establecimiento" = SUBSTRING("numeroFactura" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numeroFactura" FROM 5 FOR 3) WHERE "numeroFactura" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  `UPDATE "notas_credito" SET "establecimiento" = SUBSTRING("numeroNC" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numeroNC" FROM 5 FOR 3) WHERE "numeroNC" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  `UPDATE "notas_debito" SET "establecimiento" = SUBSTRING("numero" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numero" FROM 5 FOR 3) WHERE "numero" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  `UPDATE "retenciones" SET "establecimiento" = SUBSTRING("numeroRetencion" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numeroRetencion" FROM 5 FOR 3) WHERE "numeroRetencion" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  `UPDATE "liquidaciones_compra" SET "establecimiento" = SUBSTRING("numeroLiquidacion" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numeroLiquidacion" FROM 5 FOR 3) WHERE "numeroLiquidacion" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  `UPDATE "notas_venta" SET "establecimiento" = SUBSTRING("numeroNota" FROM 1 FOR 3), "puntoEmision" = SUBSTRING("numeroNota" FROM 5 FOR 3) WHERE "numeroNota" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'`,
  // Cajas físicas por Punto de Emisión (2026-07-26) — varias cajas
  // registradoras pueden compartir un mismo punto de emisión SRI (el punto de
  // emisión es un código autoasignado, sin costo/límite del SRI, a diferencia
  // del establecimiento). Se agrega un contador atómico de secuencial de
  // Factura en puntos_emision para que 2 cajas emitiendo casi al mismo tiempo
  // bajo el mismo punto de emisión no se pisen la numeración (el cálculo
  // viejo era 2 pasos sin lock — ver utils/secuenciales.js).
  `CREATE TABLE IF NOT EXISTS "cajas" (
    "id"             SERIAL PRIMARY KEY,
    "empresaId"      INTEGER NOT NULL,
    "puntoEmisionId" INTEGER NOT NULL,
    "nombre"         VARCHAR(100) NOT NULL,
    "activo"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cajas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id"),
    CONSTRAINT "cajas_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "puntos_emision"("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "cajas_puntoEmisionId_nombre_key" ON "cajas"("puntoEmisionId", "nombre")`,
  `CREATE INDEX IF NOT EXISTS "cajas_empresaId_idx" ON "cajas"("empresaId")`,
  `ALTER TABLE "puntos_emision" ADD COLUMN IF NOT EXISTS "ultimoSecuencialFactura" INTEGER`,
  // Backfill idempotente (WHERE ... IS NULL lo hace seguro de re-correr en
  // cada arranque): inicializa el contador con el mayor entre el secuencial
  // inicial configurado y el máximo secuencial de factura ya emitido bajo ese
  // punto de emisión — mismo criterio que usaba siguienteSecuencial() en JS.
  `UPDATE "puntos_emision" pe SET "ultimoSecuencialFactura" = GREATEST(pe."secInicialFactura", COALESCE((SELECT MAX(CAST(f."secuencial" AS INTEGER)) FROM "facturas" f WHERE f."empresaId" = pe."empresaId" AND f."establecimiento" = pe."establecimiento" AND f."puntoEmision" = pe."puntoEmision"), 0)) WHERE pe."ultimoSecuencialFactura" IS NULL`,
  // Caja General por defecto para cada punto de emisión que aún no tenga
  // ninguna — ningún tenant existente se queda sin poder facturar.
  `INSERT INTO "cajas" ("empresaId", "puntoEmisionId", "nombre", "activo", "createdAt", "updatedAt") SELECT pe."empresaId", pe."id", 'Caja General', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "puntos_emision" pe WHERE NOT EXISTS (SELECT 1 FROM "cajas" c WHERE c."puntoEmisionId" = pe."id")`,
  // Límites explícitos por tenant (SuperAdmin) — null = ilimitado.
  `ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "maxSucursales" INTEGER`,
  `ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "maxCajas" INTEGER`,
  // Llave de idempotencia para ventas encoladas offline (2026-07-27) — evita
  // duplicar facturas/notas de venta si un reintento de sincronización
  // llega después de que el servidor ya la había creado pero la respuesta
  // se perdió por un nuevo corte de conexión. NULL en documentos online.
  `ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "facturas_idempotencyKey_key" ON "facturas"("idempotencyKey")`,
  `ALTER TABLE "notas_venta" ADD COLUMN IF NOT EXISTS "idempotencyKey" VARCHAR(64)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "notas_venta_idempotencyKey_key" ON "notas_venta"("idempotencyKey")`,
  // Interruptor "Sucursales y Puntos de Venta habilitado" (2026-07-26) —
  // default false: el selector de caja y el menú quedan ocultos hasta que el
  // admin lo habilite en Configuración del Sistema, aunque ya existan
  // puntos_emision/cajas históricos en la BD.
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "sucursalesHabilitado" BOOLEAN NOT NULL DEFAULT false`,
  // Modo de conexión de la impresora térmica (2026-07-26): 'ninguna' | 'red'
  // (TCP, ya existente) | 'usb' (WebUSB desde el navegador — el backend en
  // la nube no puede alcanzar un puerto USB del cliente).
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraModo" VARCHAR(10) NOT NULL DEFAULT 'ninguna'`,
  // El contador puede revisar una compra facturada a cédula (receptorEsRuc=
  // false) y aprobarla como gasto de la actividad económica, para que sí
  // cuente en el crédito tributario de IVA (F104) y en el F101 (2026-07-27).
  `ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "aprobadaPorContador" BOOLEAN NOT NULL DEFAULT false`,
  // Nómina real: décimo tercero/cuarto, vacaciones, utilidades 15% y
  // liquidación de haberes (2026-07-30).
  `ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "regimenDecimoCuarto" VARCHAR(10) NOT NULL DEFAULT 'sierra'`,
  `ALTER TABLE "empleados" ADD COLUMN IF NOT EXISTS "cargasFamiliares" INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE "nomina_detalles" ADD COLUMN IF NOT EXISTS "vacacionesProp" DECIMAL(10,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE "ausencias" ADD COLUMN IF NOT EXISTS "pagado" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "ausencias" ADD COLUMN IF NOT EXISTS "valorPagado" DECIMAL(10,2)`,
  `ALTER TABLE "ausencias" ADD COLUMN IF NOT EXISTS "fechaPago" TIMESTAMP(3)`,
  `CREATE TABLE IF NOT EXISTS "nomina_pagos_especiales" (
    "id"            SERIAL PRIMARY KEY,
    "empresaId"     INTEGER NOT NULL DEFAULT 1,
    "tipo"          VARCHAR(20) NOT NULL,
    "anio"          INTEGER NOT NULL,
    "periodoDesde"  TIMESTAMP(3) NOT NULL,
    "periodoHasta"  TIMESTAMP(3) NOT NULL,
    "estado"        VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "fechaPago"      TIMESTAMP(3),
    "totalPagado"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creadoPor"     INTEGER,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nomina_pagos_especiales_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "nomina_pagos_especiales_empresaId_idx" ON "nomina_pagos_especiales"("empresaId")`,
  `CREATE INDEX IF NOT EXISTS "nomina_pagos_especiales_empresaId_tipo_anio_idx" ON "nomina_pagos_especiales"("empresaId", "tipo", "anio")`,
  `CREATE TABLE IF NOT EXISTS "nomina_pagos_especiales_detalle" (
    "id"            SERIAL PRIMARY KEY,
    "pagoId"        INTEGER NOT NULL,
    "empleadoId"    INTEGER NOT NULL,
    "baseCalculo"   DECIMAL(12,2) NOT NULL DEFAULT 0,
    "diasBase"      INTEGER,
    "valor"         DECIMAL(10,2) NOT NULL DEFAULT 0,
    "detalleJson"   TEXT,
    "observaciones" VARCHAR(300),
    CONSTRAINT "nomina_pagos_especiales_detalle_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "nomina_pagos_especiales"("id") ON DELETE CASCADE,
    CONSTRAINT "nomina_pagos_especiales_detalle_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "nomina_pagos_especiales_detalle_pagoId_empleadoId_key" ON "nomina_pagos_especiales_detalle"("pagoId", "empleadoId")`,
  `CREATE INDEX IF NOT EXISTS "nomina_pagos_especiales_detalle_pagoId_idx" ON "nomina_pagos_especiales_detalle"("pagoId")`,
  `CREATE INDEX IF NOT EXISTS "nomina_pagos_especiales_detalle_empleadoId_idx" ON "nomina_pagos_especiales_detalle"("empleadoId")`,
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
