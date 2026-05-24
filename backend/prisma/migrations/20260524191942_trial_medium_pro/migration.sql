/*
  Warnings:

  - You are about to drop the column `motivoAnulacion` on the `facturas_compra` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "esTrial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trialExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "facturas_compra" DROP COLUMN "motivoAnulacion";

-- CreateTable
CREATE TABLE "directorio_global" (
    "id" SERIAL NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "tipoIdentificacion" VARCHAR(2) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "direccion" VARCHAR(300),
    "email" VARCHAR(150),
    "telefono" VARCHAR(20),
    "fuente" VARCHAR(15) NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "directorio_global_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directorio_global_identificacion_key" ON "directorio_global"("identificacion");

-- CreateIndex
CREATE INDEX "directorio_global_identificacion_idx" ON "directorio_global"("identificacion");
