-- AlterTable: enriquecer modelo proveedores con campos de ciudad, provincia, contacto y banco
ALTER TABLE "proveedores" ADD COLUMN IF NOT EXISTS "ciudad" VARCHAR(100);
ALTER TABLE "proveedores" ADD COLUMN IF NOT EXISTS "provincia" VARCHAR(100);
ALTER TABLE "proveedores" ADD COLUMN IF NOT EXISTS "contactoNombre" VARCHAR(150);
ALTER TABLE "proveedores" ADD COLUMN IF NOT EXISTS "banco" VARCHAR(100);
ALTER TABLE "proveedores" ADD COLUMN IF NOT EXISTS "cuentaBancaria" VARCHAR(50);
