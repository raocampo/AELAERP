-- Facturación (Facturas, Notas de Venta, Notas de Débito, Guías de Remisión) se
-- vuelve un módulo más del sistema de "módulos contratados" — hasta ahora era el
-- único bloque siempre visible sin flag propio. Necesario para poder armar un
-- cliente "solo Contabilidad/Tributario" sin emisión de comprobantes de venta
-- (ej. una contadora que no factura desde este sistema, solo lleva la contabilidad).
-- Default true: no oculta nada a los tenants existentes.

ALTER TABLE "configuracion_sistema"
  ADD COLUMN "facturacionHabilitada" BOOLEAN NOT NULL DEFAULT true;
