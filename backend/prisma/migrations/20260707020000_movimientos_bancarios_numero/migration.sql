-- Comprobantes bancarios numerados por categoría (Ingreso/Egreso/NC/ND/Ajuste),
-- equivalente a los "Comprobantes de ingreso/pago/crédito/débito" de Sofía.
-- Nullable: movimientos ya existentes quedan sin número, no se backfillea.
ALTER TABLE "movimientos_bancarios" ADD COLUMN IF NOT EXISTS "numero" VARCHAR(20);
