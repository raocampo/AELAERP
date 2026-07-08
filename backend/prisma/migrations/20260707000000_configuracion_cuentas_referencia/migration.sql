-- Configuración de cuentas por referencia: mapeo genérico código->cuenta para
-- catálogos largos (retenciones compras/ventas, conceptos de nómina, cuentas
-- generales). El catálogo de referencias vive en código (ver
-- backend/utils/catalogosCuentasReferencia.js); esta tabla solo guarda la
-- elección del contador.
CREATE TABLE IF NOT EXISTS "configuracion_cuentas_referencia" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "categoria" VARCHAR(30) NOT NULL,
    "codigoReferencia" VARCHAR(20) NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_cuentas_referencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "config_cuentas_ref_empresa_cat_cod_key"
  ON "configuracion_cuentas_referencia"("empresaId", "categoria", "codigoReferencia");
CREATE INDEX IF NOT EXISTS "config_cuentas_ref_empresaId_idx" ON "configuracion_cuentas_referencia"("empresaId");
CREATE INDEX IF NOT EXISTS "config_cuentas_ref_cuentaId_idx" ON "configuracion_cuentas_referencia"("cuentaId");

ALTER TABLE "configuracion_cuentas_referencia" ADD CONSTRAINT "config_cuentas_ref_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "configuracion_cuentas_referencia" ADD CONSTRAINT "config_cuentas_ref_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "plan_cuentas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
