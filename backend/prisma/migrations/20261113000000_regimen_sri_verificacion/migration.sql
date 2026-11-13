-- Verificación automática del régimen del emisor contra el SRI
ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "regimenSriVerificadoEn" TIMESTAMP(3);
ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "regimenSriCambio" JSONB;
