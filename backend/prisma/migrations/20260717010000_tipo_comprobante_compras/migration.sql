-- Tipo de comprobante recibido del proveedor en compras (facturas_compra).
--
-- Hasta ahora toda compra registrada se reportaba al SRI en el ATS como
-- "01 FACTURA" sin importar el documento real. Cuando el proveedor es un
-- contribuyente RIMPE Negocio Popular, el documento que entrega es una
-- "Nota de Venta" (tipo de comprobante 02 en la Tabla 4 del SRI) — sin
-- derecho a crédito tributario de IVA (codSustento 02, no 01). El cliente
-- ya registra estas compras en el sistema pero quedaban mal clasificadas
-- en el ATS.
--
-- Default 'FACTURA' para todos los registros existentes: es lo que ya
-- asumía el sistema implícitamente, no cambia el comportamiento actual de
-- ningún registro histórico.

ALTER TABLE "facturas_compra"
  ADD COLUMN "tipoComprobante" VARCHAR(20) NOT NULL DEFAULT 'FACTURA';
