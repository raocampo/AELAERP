-- Soporte IVA 5% en liquidaciones de compra (Ecuador: bienes/servicios de
-- primera necesidad exonerados/reducidos desde la reforma de abril 2024 —
-- ej. materiales de construcción de vivienda, medicamentos).
--
-- La tabla liquidaciones_compra nunca tuvo columna para el 5%: el formulario
-- (FormLiquidacion.jsx) solo permitía elegir 0% o 15% por línea y el cálculo
-- de IVA solo contemplaba 15%, así que no existen datos históricos en 5% que
-- reubicar (a diferencia de la migración de subtotal12, esta no requiere
-- backfill).

ALTER TABLE "liquidaciones_compra"
  ADD COLUMN "subtotal5" DECIMAL(14,2) NOT NULL DEFAULT 0;
