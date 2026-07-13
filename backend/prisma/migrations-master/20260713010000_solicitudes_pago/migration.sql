-- Tabla para registrar solicitudes de pago de suscripción (checkout PayPhone, Stripe, Transferencia).
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS "solicitudes_pago" (
    "id"            SERIAL          NOT NULL,
    "tenantId"      INTEGER         NOT NULL,
    "plan"          VARCHAR(20)     NOT NULL,
    "periodo"       VARCHAR(20)     NOT NULL,
    "monto"         DECIMAL(10,2)   NOT NULL,
    "proveedor"     VARCHAR(30)     NOT NULL,
    "estado"        VARCHAR(20)     NOT NULL DEFAULT 'pendiente',
    "referencia"    VARCHAR(300),
    "checkoutUrl"   VARCHAR(500),
    "transactionId" VARCHAR(200),
    "metadatos"     JSONB,
    "createdAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "solicitudes_pago_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "solicitudes_pago_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "solicitudes_pago_tenantId_idx" ON "solicitudes_pago"("tenantId");
CREATE INDEX IF NOT EXISTS "solicitudes_pago_estado_idx"   ON "solicitudes_pago"("estado");
