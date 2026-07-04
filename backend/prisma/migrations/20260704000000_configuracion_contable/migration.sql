-- Configuración contable por empresa: enlaza cuentas del Plan de Cuentas propio
-- a los asientos automáticos de compras, para que el contador pueda elegir a qué
-- cuenta se contabilizan (en vez de siempre usar las cuentas genéricas por defecto).
CREATE TABLE IF NOT EXISTS "configuracion_contable" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "codigoCuentaComprasGasto" VARCHAR(20),
    "codigoCuentaInventario" VARCHAR(20),
    "codigoCuentaIvaCompras" VARCHAR(20),
    "codigoCuentaCxP" VARCHAR(20),
    "codigoCuentaCajaCompras" VARCHAR(20),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_contable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "configuracion_contable_empresaId_key" ON "configuracion_contable"("empresaId");

ALTER TABLE "configuracion_contable" ADD CONSTRAINT "configuracion_contable_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
