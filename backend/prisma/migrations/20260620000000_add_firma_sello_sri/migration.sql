-- AlterTable: firma digital y sello de empresa en configuracion_sri (para proformas)
ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "firmaUrl" TEXT;
ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "selloUrl" TEXT;
