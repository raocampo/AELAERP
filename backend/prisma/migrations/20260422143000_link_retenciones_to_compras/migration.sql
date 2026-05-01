-- AlterTable
ALTER TABLE "retenciones" ADD COLUMN IF NOT EXISTS "compraId" INTEGER;

-- Link historical retentions (safe - only if columns exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='facturas_compra' AND column_name='retencionRenta') THEN
    UPDATE "retenciones" r
    SET "compraId" = c."id"
    FROM "facturas_compra" c
    WHERE c."empresaId" = r."empresaId"
      AND c."identificacionProveedor" = r."identificacionProveedor"
      AND c."numeroFactura" = r."numeroDocSustento"
      AND r."tipoDocSustento" = '01'
      AND r."compraId" IS NULL;

    WITH retenciones_compra AS (
        SELECT
            r."compraId",
            COALESCE(SUM(CASE WHEN imp ->> 'codigo' = '1' THEN COALESCE((imp ->> 'valorRetenido')::numeric, 0) ELSE 0 END), 0) AS "retencionRenta",
            COALESCE(SUM(CASE WHEN imp ->> 'codigo' = '2' THEN COALESCE((imp ->> 'valorRetenido')::numeric, 0) ELSE 0 END), 0) AS "retencionIVA"
        FROM "retenciones" r
        LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r."impuestos") = 'array' THEN r."impuestos" ELSE '[]'::jsonb END
        ) imp ON true
        WHERE r."compraId" IS NOT NULL AND r."anulada" = false
        GROUP BY r."compraId"
    )
    UPDATE "facturas_compra" c
    SET "retencionRenta" = COALESCE(rc."retencionRenta", 0),
        "retencionIVA" = COALESCE(rc."retencionIVA", 0)
    FROM retenciones_compra rc
    WHERE c."id" = rc."compraId";
  END IF;
END
$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "retenciones_compraId_idx" ON "retenciones"("compraId");

-- AddForeignKey (safe)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='retenciones_compraId_fkey') THEN
    ALTER TABLE "retenciones" ADD CONSTRAINT "retenciones_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "facturas_compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
