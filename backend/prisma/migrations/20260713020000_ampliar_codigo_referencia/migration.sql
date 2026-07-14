-- Amplía codigoReferencia de VARCHAR(20) a VARCHAR(50) — el catálogo de
-- referencias (nómina/general) tiene códigos de hasta 34 caracteres
-- (ej. INVENTARIO_TRANSFERENCIAS_TRANSITO) que ya no cabían, causando
-- P2000 "value too long for column" al guardar la configuración.
-- Safe to run multiple times.

ALTER TABLE "configuracion_cuentas_referencia"
  ALTER COLUMN "codigoReferencia" TYPE VARCHAR(50);
