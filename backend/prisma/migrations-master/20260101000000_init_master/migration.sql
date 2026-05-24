-- Creación inicial de la BD master (aela_master).
-- Todas las sentencias usan IF NOT EXISTS — seguro correr múltiples veces.

CREATE TABLE IF NOT EXISTS "tenants" (
    "id"                 SERIAL        NOT NULL,
    "slug"               VARCHAR(50)   NOT NULL,
    "plan"               VARCHAR(10)   NOT NULL DEFAULT 'lite',
    "estado"             VARCHAR(20)   NOT NULL DEFAULT 'provisioning',
    "dbName"             VARCHAR(80)   NOT NULL,
    "dbHost"             VARCHAR(100)  NOT NULL DEFAULT 'localhost',
    "dbPort"             INTEGER       NOT NULL DEFAULT 5432,
    "dbUser"             VARCHAR(50)   NOT NULL DEFAULT 'postgres',
    "dbPass"             VARCHAR(200)  NOT NULL,
    "emailContacto"      VARCHAR(150),
    "telefonoContacto"   VARCHAR(30),
    "nombreContacto"     VARCHAR(200),
    "periodoFacturacion" VARCHAR(10),
    "fechaActivacion"    TIMESTAMP(3),
    "fechaVencimiento"   TIMESTAMP(3),
    "autoRenovar"        BOOLEAN       NOT NULL DEFAULT false,
    "brandConfig"        JSONB,
    "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE IF NOT EXISTS "suscripciones" (
    "id"             SERIAL        NOT NULL,
    "tenantId"       INTEGER       NOT NULL,
    "plan"           VARCHAR(10)   NOT NULL,
    "periodo"        VARCHAR(10),
    "monto"          DECIMAL(10,2),
    "estado"         VARCHAR(20)   NOT NULL DEFAULT 'activo',
    "fechaInicio"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaFin"       TIMESTAMP(3),
    "pagoReferencia" VARCHAR(200),
    "proveedor"      VARCHAR(50),
    "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suscripciones_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "suscripciones_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
