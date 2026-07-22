-- Base Imponible Exenta de IVA (SRI tabla 17, código 7) como categoría propia
-- en compras, separada de "No objeto de IVA" (código 6, subtotalNoObjeto).
-- Confirmado contra el XSD oficial del ATS (ats.xsd): baseNoGraIva (no objeto)
-- y baseImpExe (exenta) son 2 campos obligatorios distintos en detalleCompras,
-- no el mismo casillero como se asumió el 2026-07-17 al leer la ficha técnica
-- en PDF (columnas mal alineadas en la extracción).
-- Default 0, sin backfill: imposible distinguir retroactivamente qué parte de
-- subtotalNoObjeto era realmente "exenta" en vez de "no objeto".

ALTER TABLE "facturas_compra"
  ADD COLUMN "subtotalExento" DECIMAL(14,2) NOT NULL DEFAULT 0;
