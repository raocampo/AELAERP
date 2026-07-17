-- Techo de módulos contratados por tenant, independiente del plan lite/medium/pro.
-- null = usar el techo legado derivado de `plan` (sin cambios para tenants existentes).
-- Se gestiona desde el panel super-admin y se sincroniza a empresas.modulosContratados
-- en la BD de cada tenant (ver actualizarModulosContratadosTenant en provisionarTenant.js).
-- Safe to run multiple times.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "modulosContratados" JSONB;
