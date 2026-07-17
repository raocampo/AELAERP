-- Módulos activables por empresa/cliente — cierre de huecos + techo por tenant.
--
-- Hasta ahora Buzón SRI compartía flag con Compras (comprasHabilitadas) — no se
-- podía activar uno sin el otro. Bancos, CxC/CxP/Caja Chica, Declaraciones,
-- Retenciones recibidas y Reportes Tributarios no tenían flag propio — siempre
-- visibles/accesibles sin importar la configuración del sistema.
--
-- Se agregan 3 flags nuevos, independientes, al mismo patrón de las 9 columnas
-- existentes en configuracion_sistema (comprasHabilitadas, contabilidadHabilitada,
-- etc.), default true para no ocultar nada a los tenants existentes hasta que se
-- reconfiguren explícitamente:
--   buzonSriHabilitado    → /buzon (antes atado a comprasHabilitadas)
--   tributarioHabilitado  → /retenciones-recibidas, /declaraciones, /reportes-tributarios
--   bancosHabilitado      → /bancos (todas las tabs)
-- CxC/CxP/Caja Chica se agrupan bajo el flag existente contabilidadHabilitada
-- (ya están en el mismo grupo del sidebar) — no necesitan columna nueva.
--
-- Además, `empresas.modulosContratados` (JSONB, nullable) permite fijar un techo
-- explícito de módulos por tenant, independiente del plan lite/medium/pro — antes
-- el único techo posible eran 3 combinaciones fijas (capacidadesPlan). null =
-- comportamiento legado (techo derivado del plan, sin cambios para nadie que no
-- se reconfigure). Se gestiona desde el panel super-admin (BD master) y se
-- sincroniza aquí.

ALTER TABLE "configuracion_sistema"
  ADD COLUMN "buzonSriHabilitado" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "tributarioHabilitado" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "bancosHabilitado" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "empresas"
  ADD COLUMN "modulosContratados" JSONB;
