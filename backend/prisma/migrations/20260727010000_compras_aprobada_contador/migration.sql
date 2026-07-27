-- El contador puede revisar una compra facturada a cédula (receptorEsRuc=false)
-- y aprobarla como gasto de la actividad económica, para que sí cuente en el
-- crédito tributario de IVA (F104) y en el F101.
ALTER TABLE "facturas_compra" ADD COLUMN IF NOT EXISTS "aprobadaPorContador" BOOLEAN NOT NULL DEFAULT false;
