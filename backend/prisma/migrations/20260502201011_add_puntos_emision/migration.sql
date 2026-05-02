-- CreateTable
CREATE TABLE "puntos_emision" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001',
    "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001',
    "descripcion" VARCHAR(100),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "secInicialFactura" INTEGER NOT NULL DEFAULT 0,
    "secInicialNotaCredito" INTEGER NOT NULL DEFAULT 0,
    "secInicialNotaDebito" INTEGER NOT NULL DEFAULT 0,
    "secInicialRetencion" INTEGER NOT NULL DEFAULT 0,
    "secInicialLiquidacion" INTEGER NOT NULL DEFAULT 0,
    "secInicialGuiaRemision" INTEGER NOT NULL DEFAULT 0,
    "secInicialNotaVenta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "puntos_emision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "puntos_emision_empresaId_idx" ON "puntos_emision"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "puntos_emision_empresaId_establecimiento_puntoEmision_key" ON "puntos_emision"("empresaId", "establecimiento", "puntoEmision");

-- AddForeignKey
ALTER TABLE "puntos_emision" ADD CONSTRAINT "puntos_emision_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
