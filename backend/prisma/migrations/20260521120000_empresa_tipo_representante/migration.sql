-- ============================================================
-- Empresa: tipo de contribuyente, representante legal y contadora
-- ============================================================

ALTER TABLE "empresas"
  ADD COLUMN IF NOT EXISTS "tipoContribuyente" VARCHAR(20) DEFAULT 'JURIDICA',
  ADD COLUMN IF NOT EXISTS "repLegalNombre"    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "repLegalCedula"    VARCHAR(13),
  ADD COLUMN IF NOT EXISTS "repLegalCargo"     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "repLegalEmail"     VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "contadoraNombre"   VARCHAR(200),
  ADD COLUMN IF NOT EXISTS "contadoraCedula"   VARCHAR(13),
  ADD COLUMN IF NOT EXISTS "contadoraEmail"    VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "contadoraTelefono" VARCHAR(20);
