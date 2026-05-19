-- ============================================================
-- Índice en contribuyentes_sri.razonSocial
-- Necesario para búsqueda por nombre eficiente sobre 6.8M filas
-- ============================================================

-- Índice btree estándar (Prisma-tracked via @@index([razonSocial]))
CREATE INDEX IF NOT EXISTS "contribuyentes_sri_razonSocial_idx"
  ON "contribuyentes_sri"("razonSocial");

-- Índice btree con varchar_pattern_ops:
-- habilita LIKE 'PREFIX%' en PostgreSQL con locale UTF-8 (sin este operador, 
-- el btree estándar no se usa para LIKE en UTF-8).
-- Construcción: ~30-60 segundos en 6.8M filas.
CREATE INDEX IF NOT EXISTS "contribuyentes_sri_razonSocial_vpo_idx"
  ON "contribuyentes_sri" ("razonSocial" varchar_pattern_ops);
