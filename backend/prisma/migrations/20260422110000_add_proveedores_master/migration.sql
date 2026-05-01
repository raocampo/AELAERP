-- CreateTable
CREATE TABLE "proveedores" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "tipoIdentificacion" VARCHAR(2) NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "direccion" VARCHAR(300),
    "email" VARCHAR(150),
    "telefono" VARCHAR(20),
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "facturas_compra" ADD COLUMN "proveedorId" INTEGER;

-- Backfill proveedores from purchase headers
INSERT INTO "proveedores" (
    "empresaId",
    "tipoIdentificacion",
    "identificacion",
    "razonSocial",
    "nombreComercial",
    "direccion",
    "activo",
    "createdAt",
    "updatedAt"
)
SELECT DISTINCT ON ("empresaId", "identificacionProveedor")
    "empresaId",
    "tipoIdentificacionProveedor",
    "identificacionProveedor",
    "razonSocialProveedor",
    "nombreComercialProveedor",
    "direccionProveedor",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "facturas_compra"
WHERE COALESCE(TRIM("identificacionProveedor"), '') <> ''
ORDER BY "empresaId", "identificacionProveedor", "updatedAt" DESC, "id" DESC;

-- Link existing purchases to the provider master
UPDATE "facturas_compra" fc
SET "proveedorId" = p."id"
FROM "proveedores" p
WHERE p."empresaId" = fc."empresaId"
  AND p."identificacion" = fc."identificacionProveedor";

-- CreateIndex
CREATE INDEX "proveedores_empresaId_idx" ON "proveedores"("empresaId");

-- CreateIndex
CREATE INDEX "proveedores_identificacion_idx" ON "proveedores"("identificacion");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_empresaId_identificacion_key" ON "proveedores"("empresaId", "identificacion");

-- CreateIndex
CREATE INDEX "facturas_compra_proveedorId_idx" ON "facturas_compra"("proveedorId");

-- AddForeignKey
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas_compra" ADD CONSTRAINT "facturas_compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
