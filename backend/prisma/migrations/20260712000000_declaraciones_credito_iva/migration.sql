-- Crédito tributario de IVA arrastrado de un mes a otro — 2026-07-12
-- El F104 (resumen de ayuda para la declaración) necesita saber el saldo a
-- favor que el contribuyente arrastra del período anterior (casillero 617/
-- 619 del formulario real). Se guarda por período porque el saldo real
-- oficial puede no coincidir con lo que este sistema calcularía solo (por
-- ejemplo, si el contribuyente empezó a usar AELA a mitad de año).

CREATE TABLE "declaraciones_credito_iva" (
  "id"                     SERIAL PRIMARY KEY,
  "empresaId"              INTEGER NOT NULL,
  "anio"                   INTEGER NOT NULL,
  "mes"                    INTEGER NOT NULL,
  "creditoTributarioAnterior" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "usuarioId"              INTEGER,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "declaraciones_credito_iva_empresaId_anio_mes_key" ON "declaraciones_credito_iva"("empresaId", "anio", "mes");
