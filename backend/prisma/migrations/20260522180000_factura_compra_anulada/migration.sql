-- Migration: add anulada + motivoAnulacion to facturas_compra
-- Safe: ADD COLUMN IF NOT EXISTS - no borra datos, filas existentes quedan con default
ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "anulada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "motivoAnulacion" TEXT NULL;
