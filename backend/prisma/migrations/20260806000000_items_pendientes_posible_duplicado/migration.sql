-- Detección de posibles productos duplicados al importar compras
ALTER TABLE "items_compra_pendientes" ADD COLUMN IF NOT EXISTS "motivo" VARCHAR(20) NOT NULL DEFAULT 'REGALO';
ALTER TABLE "items_compra_pendientes" ADD COLUMN IF NOT EXISTS "productoSugeridoId" INTEGER;
