-- Menú digital por QR (módulo restaurante) — campos opcionales en productos
ALTER TABLE "productos_servicios" ADD COLUMN IF NOT EXISTS "categoriaMenu" VARCHAR(80);
ALTER TABLE "productos_servicios" ADD COLUMN IF NOT EXISTS "descripcionMenu" TEXT;
ALTER TABLE "productos_servicios" ADD COLUMN IF NOT EXISTS "imagenMenuUrl" TEXT;
ALTER TABLE "productos_servicios" ADD COLUMN IF NOT EXISTS "visibleEnMenu" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "productos_servicios" ADD COLUMN IF NOT EXISTS "ordenMenu" INTEGER NOT NULL DEFAULT 0;
