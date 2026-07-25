-- Sucursales y Puntos de Venta (multi-caja) — Fase 0+1.
-- Un cliente (supermercado) va de 2 a 4 cajas y va a abrir una segunda
-- sucursal. Modelo: Sucursal = local físico = "establecimiento" SRI (3
-- dígitos); Punto de Venta/Caja = caja registradora dentro de una sucursal =
-- "punto de emisión" SRI (3 dígitos). Se agregan las columnas
-- establecimiento/puntoEmision (mismo patrón ya usado en guias_remision) a
-- los 5 modelos de documentos SRI que hoy calculan su secuencial SIN
-- filtrar por establecimiento/puntoEmision (bug de cumplimiento SRI
-- detectado: dos puntos de venta activos se pisarían la numeración).

CREATE TABLE "sucursales" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "establecimiento" VARCHAR(3) NOT NULL,
    "direccion" VARCHAR(300),
    "telefono" VARCHAR(20),
    "esMatriz" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sucursales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sucursales_empresaId_establecimiento_key" ON "sucursales"("empresaId", "establecimiento");
CREATE INDEX "sucursales_empresaId_idx" ON "sucursales"("empresaId");

ALTER TABLE "sucursales" ADD CONSTRAINT "sucursales_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "puntos_emision" ADD COLUMN "sucursalId" INTEGER;
CREATE INDEX "puntos_emision_sucursalId_idx" ON "puntos_emision"("sucursalId");
ALTER TABLE "puntos_emision" ADD CONSTRAINT "puntos_emision_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "sucursales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "facturas" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';
CREATE INDEX "facturas_empresaId_establecimiento_puntoEmision_idx" ON "facturas"("empresaId", "establecimiento", "puntoEmision");

ALTER TABLE "notas_credito" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';
CREATE INDEX "notas_credito_empresaId_establecimiento_puntoEmision_idx" ON "notas_credito"("empresaId", "establecimiento", "puntoEmision");

ALTER TABLE "notas_debito" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';
CREATE INDEX "notas_debito_empresaId_establecimiento_puntoEmision_idx" ON "notas_debito"("empresaId", "establecimiento", "puntoEmision");

ALTER TABLE "retenciones" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';
CREATE INDEX "retenciones_empresaId_establecimiento_puntoEmision_idx" ON "retenciones"("empresaId", "establecimiento", "puntoEmision");

ALTER TABLE "liquidaciones_compra" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';
CREATE INDEX "liquidaciones_compra_empresaId_establecimiento_puntoEmision_idx" ON "liquidaciones_compra"("empresaId", "establecimiento", "puntoEmision");

-- notas_venta: secuencial sigue siendo único global por empresa (no es
-- comprobante electrónico SRI) — solo se agregan las columnas para reporting.
ALTER TABLE "notas_venta" ADD COLUMN "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001', ADD COLUMN "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001';

-- Backfill: los documentos existentes ya traen establecimiento-puntoEmision
-- codificados en su número formateado (ej. "002-002-000000002") — parsearlo
-- de ahí es más correcto que dejar el default '001' parejo para todos, ya
-- que algunos tenants (ej. importaciones históricas) sí tienen documentos
-- de un establecimiento/punto distinto. Sin esto, activar un punto de venta
-- que coincida con un establecimiento histórico reiniciaría su secuencial
-- desde 1, arriesgando numeración/clave de acceso duplicada.
UPDATE "facturas" SET
  "establecimiento" = SUBSTRING("numeroFactura" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numeroFactura" FROM 5 FOR 3)
WHERE "numeroFactura" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';

UPDATE "notas_credito" SET
  "establecimiento" = SUBSTRING("numeroNC" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numeroNC" FROM 5 FOR 3)
WHERE "numeroNC" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';

UPDATE "notas_debito" SET
  "establecimiento" = SUBSTRING("numero" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numero" FROM 5 FOR 3)
WHERE "numero" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';

UPDATE "retenciones" SET
  "establecimiento" = SUBSTRING("numeroRetencion" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numeroRetencion" FROM 5 FOR 3)
WHERE "numeroRetencion" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';

UPDATE "liquidaciones_compra" SET
  "establecimiento" = SUBSTRING("numeroLiquidacion" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numeroLiquidacion" FROM 5 FOR 3)
WHERE "numeroLiquidacion" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';

UPDATE "notas_venta" SET
  "establecimiento" = SUBSTRING("numeroNota" FROM 1 FOR 3),
  "puntoEmision"    = SUBSTRING("numeroNota" FROM 5 FOR 3)
WHERE "numeroNota" ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$';
