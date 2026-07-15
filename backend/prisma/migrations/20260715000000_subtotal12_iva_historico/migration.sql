-- Soporte IVA 12% histórico (Ecuador: vigente hasta el 21-abr-2024)
-- El SRI subió la tarifa general de 12% a 15% mediante la Ley Orgánica de
-- Eficiencia Económica y Generación de Empleo publicada el 22-abr-2024
-- (Registro Oficial Suplemento 535). Antes de esa fecha, la tarifa general
-- era 12% (con excepción del período jun-2016/may-2017 que fue 14%).
--
-- El sistema guardaba TODA base gravada (12%, 14%, 15%) en "subtotal15".
-- Esta migración agrega el campo "subtotal12" y relocaliza los registros
-- previos al 22-abr-2024: su base va a subtotal12, subtotal15 queda en 0.

ALTER TABLE "facturas"
  ADD COLUMN "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "facturas_compra"
  ADD COLUMN "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "liquidaciones_compra"
  ADD COLUMN "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- ── Backfill: mover base gravada de pre-2024 a subtotal12 ─────────────────
-- Se usa 2024-04-22 como corte (fecha de publicación de la ley).
-- Cualquier registro con fechaEmision anterior Y subtotal15 > 0 tenía 12% IVA.

UPDATE "facturas"
SET "subtotal12" = "subtotal15", "subtotal15" = 0
WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0;

UPDATE "facturas_compra"
SET "subtotal12" = "subtotal15", "subtotal15" = 0
WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0;

UPDATE "liquidaciones_compra"
SET "subtotal12" = "subtotal15", "subtotal15" = 0
WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0;
