-- AlterTable
ALTER TABLE "configuracion_sistema" ADD COLUMN     "importacionesHabilitado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "facturas_compra" ADD COLUMN     "fechaDim" TIMESTAMP(3),
ADD COLUMN     "numeroDim" VARCHAR(30),
ADD COLUMN     "paisOrigenProveedor" VARCHAR(2),
ADD COLUMN     "tributosAduanerosPagados" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valorCif" DECIMAL(14,2),
ADD COLUMN     "valorDai" DECIMAL(14,2),
ADD COLUMN     "valorFlete" DECIMAL(14,2),
ADD COLUMN     "valorFob" DECIMAL(14,2),
ADD COLUMN     "valorFodinfa" DECIMAL(14,2),
ADD COLUMN     "valorIce" DECIMAL(14,2),
ADD COLUMN     "valorIsd" DECIMAL(14,2),
ADD COLUMN     "valorSeguro" DECIMAL(14,2);
