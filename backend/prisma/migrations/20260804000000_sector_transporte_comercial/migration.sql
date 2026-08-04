-- Sector transporte terrestre comercial (Res. NAC-DGERCGC26-00000024,
-- Anexo 25 Ficha Técnica de Comprobantes Electrónicos Offline v2.34)
ALTER TABLE "configuracion_sri" ADD COLUMN IF NOT EXISTS "sectorTransporte" VARCHAR(20);
ALTER TABLE "facturas" ADD COLUMN IF NOT EXISTS "placaVehiculo" VARCHAR(10);
