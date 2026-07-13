-- Anticipos de Clientes y Proveedores (2026-07-13)
-- Anticipo cliente: dinero recibido del cliente antes de emitir la factura
-- Anticipo proveedor: pago realizado al proveedor antes de recibir la factura

CREATE TABLE IF NOT EXISTS "anticipos_cliente" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "anticipos_cliente_empresaId_numero_key" ON "anticipos_cliente"("empresaId", "numero");
CREATE INDEX IF NOT EXISTS "anticipos_cliente_empresaId_idx" ON "anticipos_cliente"("empresaId");
CREATE INDEX IF NOT EXISTS "anticipos_cliente_clienteId_idx" ON "anticipos_cliente"("clienteId");
CREATE INDEX IF NOT EXISTS "anticipos_cliente_fecha_idx" ON "anticipos_cliente"("fecha");

CREATE TABLE IF NOT EXISTS "anticipos_proveedor" (
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
);

CREATE UNIQUE INDEX IF NOT EXISTS "anticipos_proveedor_empresaId_numero_key" ON "anticipos_proveedor"("empresaId", "numero");
CREATE INDEX IF NOT EXISTS "anticipos_proveedor_empresaId_idx" ON "anticipos_proveedor"("empresaId");
CREATE INDEX IF NOT EXISTS "anticipos_proveedor_proveedorId_idx" ON "anticipos_proveedor"("proveedorId");
CREATE INDEX IF NOT EXISTS "anticipos_proveedor_fecha_idx" ON "anticipos_proveedor"("fecha");
