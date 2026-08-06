-- Mesas y Comandas (módulo restaurante)
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "restauranteHabilitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraCocinaIp" VARCHAR(50);
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraCocinaPuerto" INTEGER DEFAULT 9100;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraCocinaHabilitada" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "restaurante_mesas" (
  "id"        SERIAL PRIMARY KEY,
  "empresaId" INTEGER NOT NULL,
  "nombre"    VARCHAR(50) NOT NULL,
  "capacidad" INTEGER,
  "estado"    VARCHAR(20) NOT NULL DEFAULT 'LIBRE',
  "activo"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurante_mesas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "restaurante_mesas_empresaId_nombre_key" ON "restaurante_mesas"("empresaId", "nombre");
CREATE INDEX IF NOT EXISTS "restaurante_mesas_empresaId_idx" ON "restaurante_mesas"("empresaId");

CREATE TABLE IF NOT EXISTS "restaurante_comandas" (
  "id"               SERIAL PRIMARY KEY,
  "empresaId"        INTEGER NOT NULL,
  "mesaId"           INTEGER NOT NULL,
  "estado"           VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
  "items"            JSONB NOT NULL,
  "numeroComensales" INTEGER,
  "observaciones"    TEXT,
  "meseroId"         INTEGER,
  "facturaId"        INTEGER,
  "notaVentaId"      INTEGER,
  "motivoAnulacion"  TEXT,
  "abiertaEn"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cerradaEn"        TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "restaurante_comandas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id"),
  CONSTRAINT "restaurante_comandas_mesaId_fkey" FOREIGN KEY ("mesaId") REFERENCES "restaurante_mesas"("id"),
  CONSTRAINT "restaurante_comandas_meseroId_fkey" FOREIGN KEY ("meseroId") REFERENCES "usuarios"("id"),
  CONSTRAINT "restaurante_comandas_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id"),
  CONSTRAINT "restaurante_comandas_notaVentaId_fkey" FOREIGN KEY ("notaVentaId") REFERENCES "notas_venta"("id")
);
CREATE INDEX IF NOT EXISTS "restaurante_comandas_empresaId_idx" ON "restaurante_comandas"("empresaId");
CREATE INDEX IF NOT EXISTS "restaurante_comandas_mesaId_idx" ON "restaurante_comandas"("mesaId");
CREATE INDEX IF NOT EXISTS "restaurante_comandas_estado_idx" ON "restaurante_comandas"("estado");
