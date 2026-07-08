-- Módulo Caja Chica — 2026-07-08
-- Fondos de caja chica por empresa + movimientos (gastos, reposiciones,
-- incrementos, disminuciones, apertura y cierre) con asiento contable
-- automático en cada operación que mueve dinero entre cuentas.

CREATE TABLE "cajas_chicas" (
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
);

CREATE UNIQUE INDEX "cajas_chicas_empresaId_codigo_key" ON "cajas_chicas"("empresaId", "codigo");
CREATE INDEX "cajas_chicas_empresaId_idx" ON "cajas_chicas"("empresaId");

CREATE TABLE "movimientos_caja_chica" (
  "id"              SERIAL PRIMARY KEY,
  "cajaChicaId"     INTEGER NOT NULL,
  "empresaId"       INTEGER NOT NULL,
  "numero"          VARCHAR(30),
  "tipo"            VARCHAR(20) NOT NULL,
  -- APERTURA | GASTO | REPOSICION | INCREMENTO | DISMINUCION | CIERRE
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
);

CREATE INDEX "movimientos_caja_chica_cajaChicaId_idx" ON "movimientos_caja_chica"("cajaChicaId");
CREATE INDEX "movimientos_caja_chica_empresaId_idx" ON "movimientos_caja_chica"("empresaId");
CREATE INDEX "movimientos_caja_chica_fecha_idx" ON "movimientos_caja_chica"("fecha");
