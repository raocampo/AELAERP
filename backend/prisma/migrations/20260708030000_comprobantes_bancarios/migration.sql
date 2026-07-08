-- Comprobantes Bancarios: Ingreso, Pago, Crédito y Débito bancario
CREATE TABLE IF NOT EXISTS "comprobantes_bancarios" (
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
);

CREATE TABLE IF NOT EXISTS "comprobantes_bancarios_cuentas" (
  "id"              SERIAL PRIMARY KEY,
  "comprobanteId"   INTEGER NOT NULL REFERENCES "comprobantes_bancarios"("id") ON DELETE CASCADE,
  "notas"           TEXT,
  "valor"           DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cuentaContableId" INTEGER
);

CREATE TABLE IF NOT EXISTS "comprobantes_bancarios_pagos" (
  "id"              SERIAL PRIMARY KEY,
  "comprobanteId"   INTEGER NOT NULL REFERENCES "comprobantes_bancarios"("id") ON DELETE CASCADE,
  "tipoPago"        VARCHAR(30) NOT NULL DEFAULT 'EFECTIVO',
  "valor"           DECIMAL(14,2) NOT NULL DEFAULT 0,
  "cuentaContableId" INTEGER,
  "notas"           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cpb_empresa_tipo ON "comprobantes_bancarios"("empresaId", "tipo");
CREATE INDEX IF NOT EXISTS idx_cpb_empresa_fecha ON "comprobantes_bancarios"("empresaId", "fecha");
