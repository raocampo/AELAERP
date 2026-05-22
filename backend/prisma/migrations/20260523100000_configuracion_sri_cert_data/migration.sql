-- AELA: Almacenar certificado P12 como base64 en BD
-- Resuelve el problema de filesystem efímero en Railway:
-- cada deploy borra los archivos subidos, incluyendo el .p12.
-- Con este campo el certificado persiste en la base de datos.
--
-- Nota: ALTER TABLE ... ADD COLUMN IF NOT EXISTS es seguro
-- sobre datos existentes; no modifica registros previos.

ALTER TABLE "configuracion_sri"
  ADD COLUMN IF NOT EXISTS "certificadoP12Data" TEXT;
