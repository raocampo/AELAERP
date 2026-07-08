-- Cuenta contable específica por factura de compra
-- Permite que cada factura use una cuenta de gasto distinta al default global
-- (ej: comisiones bancarias → cuenta comisiones; transporte → flete en compras)
ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "cuentaGastoId" INTEGER;
