-- Límites explícitos de sucursales/cajas por tenant, independientes del plan.
-- null = sin restricción explícita (comportamiento normal, sin cambios para
-- tenants existentes). Se gestiona desde el panel super-admin y se
-- sincroniza a empresas.maxSucursales/maxCajas en la BD de cada tenant (ver
-- actualizarLimitesTenant en provisionarTenant.js) — mismo patrón que
-- modulosContratados. Safe to run multiple times.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "maxSucursales" INTEGER;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "maxCajas" INTEGER;
