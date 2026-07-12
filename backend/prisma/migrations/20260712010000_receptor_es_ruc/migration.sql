-- Compras facturadas a cédula personal vs RUC de la empresa — 2026-07-12
-- Para efectos tributarios, una compra solo es deducible / genera crédito
-- de IVA si el comprobante fue emitido a nombre del RUC de la empresa. Si
-- llegó dirigido a la cédula de una persona natural (aunque sea el mismo
-- contribuyente ante el SRI), no debe contarse en las declaraciones.
-- NULL = se desconoce (compras manuales/históricas sin XML de origen) — no
-- se excluye nada por defecto, solo se excluye lo que se sabe con certeza
-- que llegó a cédula.

ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "receptorEsRuc" BOOLEAN;
