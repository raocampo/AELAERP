-- AlterTable: agregar userAgent a auditoría para rastreo de seguridad
ALTER TABLE "auditoria" ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(500);
