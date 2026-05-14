-- AlterTable
ALTER TABLE "configuracion_sistema" ADD COLUMN     "impresionAutoReciboPos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "configuracion_sistema" ADD COLUMN     "impresoraKiosko" VARCHAR(120);
