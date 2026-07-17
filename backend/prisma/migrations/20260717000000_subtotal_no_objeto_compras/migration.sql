-- Clasificación de compras "No objeto de IVA" / "Exentas de IVA" (SRI tabla 17,
-- códigos 6 y 7), distinta de tarifa 0% (código 0, subtotal0).
--
-- Cliente reportó que "el sistema no clasifica las otras compras como exentas
-- o no objeto de Iva" — el select de FormCompra solo tenía 0/5/12/15%, así que
-- cualquier compra no gravada quedaba mezclada en subtotal0 (tarifa 0%), que
-- para el SRI es una categoría legal distinta de "no objeto"/"exento"
-- (Ficha Técnica ATS: campos baseNoGraIva, baseImponible y baseImpGrav son
-- mutuamente excluyentes por documento).
--
-- Sin backfill: no hay forma de distinguir retroactivamente, dentro de lo que
-- hoy está en subtotal0, qué líneas eran realmente "no objeto/exento" vs
-- tarifa 0% real — queda a criterio de la contadora reclasificar manualmente
-- si lo necesita.

ALTER TABLE "facturas_compra"
  ADD COLUMN "subtotalNoObjeto" DECIMAL(14,2) NOT NULL DEFAULT 0;
