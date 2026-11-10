-- API externa: idempotencia de POST /api/ext/v1/pagos y bitácora de llamadas
ALTER TABLE "cobros_cliente" ADD COLUMN IF NOT EXISTS "idExterno" VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS "cobros_cliente_empresaId_idExterno_key" ON "cobros_cliente"("empresaId", "idExterno");

-- Tabla fuera de schema.prisma (se usa con SQL crudo, igual que proformas)
CREATE TABLE IF NOT EXISTS "ext_api_log" (
  "id" SERIAL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metodo" VARCHAR(10) NOT NULL,
  "ruta" VARCHAR(200) NOT NULL,
  "status" INTEGER NOT NULL,
  "referencia" VARCHAR(120),
  "error" TEXT,
  "duracionMs" INTEGER
);
CREATE INDEX IF NOT EXISTS "ext_api_log_createdAt_idx" ON "ext_api_log"("createdAt");
CREATE INDEX IF NOT EXISTS "ext_api_log_referencia_idx" ON "ext_api_log"("referencia");
