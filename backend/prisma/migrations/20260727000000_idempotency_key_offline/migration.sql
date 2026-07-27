-- Llave de idempotencia para ventas encoladas offline (POS sin internet).
--
-- El wrapper apiOffline() (frontend/src/utils/syncQueue.js) guarda la venta
-- en IndexedDB si no hay conexión, y la reintenta cuando vuelve la señal.
-- Si el servidor ya había creado la factura/nota pero la respuesta se
-- perdió por un nuevo corte de conexión, un reintento sin esta llave
-- duplicaría la venta con un secuencial distinto. NULL en documentos
-- creados online normalmente — no cambia nada para el flujo existente.

ALTER TABLE "facturas" ADD COLUMN "idempotencyKey" VARCHAR(64);
CREATE UNIQUE INDEX "facturas_idempotencyKey_key" ON "facturas"("idempotencyKey");

ALTER TABLE "notas_venta" ADD COLUMN "idempotencyKey" VARCHAR(64);
CREATE UNIQUE INDEX "notas_venta_idempotencyKey_key" ON "notas_venta"("idempotencyKey");
