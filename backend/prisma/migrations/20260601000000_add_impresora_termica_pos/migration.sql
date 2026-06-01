-- AlterTable: agregar campos de impresora térmica POS a configuracion_sistema
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraIp"        VARCHAR(50);
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraPuerto"    INTEGER DEFAULT 9100;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraAncho"     INTEGER DEFAULT 80;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresoraHabilitada"  BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "cajaDineroHabilitada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracion_sistema" ADD COLUMN IF NOT EXISTS "impresionAutoMobile"  BOOLEAN NOT NULL DEFAULT false;
