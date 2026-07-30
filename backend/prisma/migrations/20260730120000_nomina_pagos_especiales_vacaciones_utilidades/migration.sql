-- AlterTable
ALTER TABLE "ausencias" ADD COLUMN     "fechaPago" TIMESTAMP(3),
ADD COLUMN     "pagado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valorPagado" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "configuracion_sistema" ADD COLUMN     "regimenDecimoCuarto" VARCHAR(10) NOT NULL DEFAULT 'sierra';

-- AlterTable
ALTER TABLE "empleados" ADD COLUMN     "cargasFamiliares" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "nomina_detalles" ADD COLUMN     "vacacionesProp" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "nomina_pagos_especiales" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "tipo" VARCHAR(20) NOT NULL,
    "anio" INTEGER NOT NULL,
    "periodoDesde" TIMESTAMP(3) NOT NULL,
    "periodoHasta" TIMESTAMP(3) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "fechaPago" TIMESTAMP(3),
    "totalPagado" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "creadoPor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nomina_pagos_especiales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nomina_pagos_especiales_detalle" (
    "id" SERIAL NOT NULL,
    "pagoId" INTEGER NOT NULL,
    "empleadoId" INTEGER NOT NULL,
    "baseCalculo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "diasBase" INTEGER,
    "valor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "detalleJson" TEXT,
    "observaciones" VARCHAR(300),

    CONSTRAINT "nomina_pagos_especiales_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nomina_pagos_especiales_empresaId_idx" ON "nomina_pagos_especiales"("empresaId");

-- CreateIndex
CREATE INDEX "nomina_pagos_especiales_empresaId_tipo_anio_idx" ON "nomina_pagos_especiales"("empresaId", "tipo", "anio");

-- CreateIndex
CREATE INDEX "nomina_pagos_especiales_detalle_pagoId_idx" ON "nomina_pagos_especiales_detalle"("pagoId");

-- CreateIndex
CREATE INDEX "nomina_pagos_especiales_detalle_empleadoId_idx" ON "nomina_pagos_especiales_detalle"("empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "nomina_pagos_especiales_detalle_pagoId_empleadoId_key" ON "nomina_pagos_especiales_detalle"("pagoId", "empleadoId");

-- AddForeignKey
ALTER TABLE "nomina_pagos_especiales" ADD CONSTRAINT "nomina_pagos_especiales_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomina_pagos_especiales_detalle" ADD CONSTRAINT "nomina_pagos_especiales_detalle_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "nomina_pagos_especiales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomina_pagos_especiales_detalle" ADD CONSTRAINT "nomina_pagos_especiales_detalle_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
