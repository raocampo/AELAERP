-- Centros de costo: dimensión opcional en las líneas de asiento contable.
-- No duplica cuentas por sucursal/departamento — un mismo plan de gastos con
-- el centro de costo como atributo de cada línea.
CREATE TABLE IF NOT EXISTS "centros_costo" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" VARCHAR(300),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "centros_costo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "centros_costo_empresaId_codigo_key" ON "centros_costo"("empresaId", "codigo");
CREATE INDEX IF NOT EXISTS "centros_costo_empresaId_idx" ON "centros_costo"("empresaId");

ALTER TABLE "centros_costo" ADD CONSTRAINT "centros_costo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "asientos_contables_detalle" ADD COLUMN IF NOT EXISTS "centroCostoId" INTEGER;
ALTER TABLE "asientos_contables_detalle" ADD CONSTRAINT "asientos_contables_detalle_centroCostoId_fkey" FOREIGN KEY ("centroCostoId") REFERENCES "centros_costo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
