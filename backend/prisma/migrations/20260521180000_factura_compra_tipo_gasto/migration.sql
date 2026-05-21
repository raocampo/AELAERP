-- Migration: add tipoGasto to facturas_compra
-- Safe: ADD COLUMN IF NOT EXISTS - no data loss, existing rows get NULL
ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "tipoGasto" VARCHAR(30) NULL;
