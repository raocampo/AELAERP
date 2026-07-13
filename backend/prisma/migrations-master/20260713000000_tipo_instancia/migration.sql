-- Añade campo tipoInstancia al tenant para diferenciar monoempresa/multiempresa en plan PRO.
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "tipoInstancia" VARCHAR(20) DEFAULT 'monoempresa';
