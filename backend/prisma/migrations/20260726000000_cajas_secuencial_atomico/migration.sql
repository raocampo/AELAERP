-- Cajas físicas (terminales/registradoras) por Punto de Emisión + contador
-- atómico de secuencial de Facturas.
--
-- El punto de emisión SRI es un código que la empresa se autoasigna (no lo
-- registra ni lo limita el SRI, a diferencia del establecimiento) — no hace
-- falta crear uno nuevo por cada caja física. Este cambio permite que varias
-- cajas compartan un mismo punto de emisión.
--
-- Eso hace que la concurrencia deje de ser un caso raro: hoy el secuencial de
-- Factura se calcula en 2 pasos separados sin lock (`findFirst` + `max+1` en
-- utils/secuenciales.js, luego el create) — si 2 cajas emiten casi al mismo
-- tiempo bajo el mismo punto de emisión, ambas podrían leer el mismo máximo.
-- Se agrega un contador entero en puntos_emision que se incrementa de forma
-- atómica (`UPDATE ... SET x = x+1`, atómico a nivel de fila en Postgres)
-- dentro de la misma transacción que crea la factura.
--
-- Alcance: solo Facturas (comprobante electrónico SRI real, con clave de
-- acceso — un secuencial duplicado lo rechaza el SRI o, peor, lo duplica
-- silenciosamente). Notas de Venta ya usa un secuencial único GLOBAL por
-- empresa (no por punto de emisión, no es comprobante electrónico SRI, menor
-- riesgo — ver comentario en notas_venta del schema) y no se ve afectada por
-- este cambio: compartir cajas bajo un punto de emisión no cambia su riesgo,
-- que ya era compartido a nivel de toda la empresa desde antes.

CREATE TABLE "cajas" (
    "id"             SERIAL NOT NULL,
    "empresaId"      INTEGER NOT NULL,
    "puntoEmisionId" INTEGER NOT NULL,
    "nombre"         VARCHAR(100) NOT NULL,
    "activo"         BOOLEAN NOT NULL DEFAULT true,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cajas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cajas_puntoEmisionId_nombre_key" ON "cajas"("puntoEmisionId", "nombre");
CREATE INDEX "cajas_empresaId_idx" ON "cajas"("empresaId");

ALTER TABLE "cajas" ADD CONSTRAINT "cajas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_puntoEmisionId_fkey" FOREIGN KEY ("puntoEmisionId") REFERENCES "puntos_emision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "puntos_emision" ADD COLUMN "ultimoSecuencialFactura" INTEGER;

-- Backfill: inicializar el contador con el mayor entre el secuencial inicial
-- configurado y el máximo secuencial de factura ya emitido bajo ese punto de
-- emisión — mismo criterio que usaba siguienteSecuencial() en JS, calculado
-- una sola vez aquí para no reiniciar la numeración de nadie.
UPDATE "puntos_emision" pe
SET "ultimoSecuencialFactura" = GREATEST(
  pe."secInicialFactura",
  COALESCE((
    SELECT MAX(CAST(f."secuencial" AS INTEGER))
    FROM "facturas" f
    WHERE f."empresaId" = pe."empresaId"
      AND f."establecimiento" = pe."establecimiento"
      AND f."puntoEmision" = pe."puntoEmision"
  ), 0)
)
WHERE pe."ultimoSecuencialFactura" IS NULL;

-- Cajas por defecto: "Caja General" para cada punto de emisión existente que
-- todavía no tenga ninguna — así ningún tenant existente se queda sin poder
-- facturar (mismo espíritu que la migración perezosa de Sucursal Matriz del
-- 2026-07-24, pero resuelto aquí de una vez para todos en vez de en runtime).
INSERT INTO "cajas" ("empresaId", "puntoEmisionId", "nombre", "activo", "createdAt", "updatedAt")
SELECT pe."empresaId", pe."id", 'Caja General', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "puntos_emision" pe
WHERE NOT EXISTS (SELECT 1 FROM "cajas" c WHERE c."puntoEmisionId" = pe."id");

-- Límites explícitos por tenant (SuperAdmin) — null = ilimitado.
ALTER TABLE "empresas" ADD COLUMN "maxSucursales" INTEGER;
ALTER TABLE "empresas" ADD COLUMN "maxCajas" INTEGER;
