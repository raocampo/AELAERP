-- Catálogo de transportistas para autocompletar guías de remisión (los campos
-- planos en guias_remision se mantienen, exigidos por el XSD del SRI).
CREATE TABLE IF NOT EXISTS "transportistas" (
    "id"             SERIAL NOT NULL,
    "empresaId"      INTEGER NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "nombre"         VARCHAR(300) NOT NULL,
    "placaVehiculo"  VARCHAR(20),
    "activo"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transportistas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "transportistas_empresaId_identificacion_key" ON "transportistas"("empresaId", "identificacion");
CREATE INDEX IF NOT EXISTS "transportistas_empresaId_idx" ON "transportistas"("empresaId");

ALTER TABLE "transportistas" ADD CONSTRAINT "transportistas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
