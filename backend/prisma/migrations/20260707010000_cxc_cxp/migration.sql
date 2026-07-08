-- Cuentas por Cobrar / Cuentas por Pagar: subledger de cobros y pagos.
-- Independiente del JSON `pagos` (metadata SRI de forma de pago) y de
-- `cobrada`/`fechaCobro` en facturas (sin uso, no se tocan). El saldo
-- pendiente se calcula al vuelo agregando estos registros no anulados.
CREATE TABLE IF NOT EXISTS "cobros_cliente" (
    "id"                 SERIAL NOT NULL,
    "empresaId"          INTEGER NOT NULL,
    "facturaId"          INTEGER NOT NULL,
    "clienteId"          INTEGER,
    "numero"             VARCHAR(20) NOT NULL,
    "fecha"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"              DECIMAL(14,2) NOT NULL,
    "metodoPago"         VARCHAR(20) NOT NULL,
    "bancoId"            INTEGER,
    "chequeId"           INTEGER,
    "referencia"         VARCHAR(100),
    "observaciones"      TEXT,
    "asientoId"          INTEGER,
    "anulado"            BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion"    VARCHAR(500),
    "fechaAnulacion"     TIMESTAMP(3),
    "usuarioId"          INTEGER,
    "usuarioAnulacionId" INTEGER,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobros_cliente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cobros_cliente_empresaId_numero_key" ON "cobros_cliente"("empresaId", "numero");
CREATE INDEX IF NOT EXISTS "cobros_cliente_empresaId_idx" ON "cobros_cliente"("empresaId");
CREATE INDEX IF NOT EXISTS "cobros_cliente_facturaId_idx" ON "cobros_cliente"("facturaId");
CREATE INDEX IF NOT EXISTS "cobros_cliente_clienteId_idx" ON "cobros_cliente"("clienteId");
CREATE INDEX IF NOT EXISTS "cobros_cliente_fecha_idx" ON "cobros_cliente"("fecha");

ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "bancos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "asientos_contables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "pagos_proveedor" (
    "id"                 SERIAL NOT NULL,
    "empresaId"          INTEGER NOT NULL,
    "compraId"           INTEGER NOT NULL,
    "proveedorId"        INTEGER,
    "numero"             VARCHAR(20) NOT NULL,
    "fecha"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto"              DECIMAL(14,2) NOT NULL,
    "metodoPago"         VARCHAR(20) NOT NULL,
    "bancoId"            INTEGER,
    "chequeId"           INTEGER,
    "referencia"         VARCHAR(100),
    "observaciones"      TEXT,
    "asientoId"          INTEGER,
    "anulado"            BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion"    VARCHAR(500),
    "fechaAnulacion"     TIMESTAMP(3),
    "usuarioId"          INTEGER,
    "usuarioAnulacionId" INTEGER,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagos_proveedor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pagos_proveedor_empresaId_numero_key" ON "pagos_proveedor"("empresaId", "numero");
CREATE INDEX IF NOT EXISTS "pagos_proveedor_empresaId_idx" ON "pagos_proveedor"("empresaId");
CREATE INDEX IF NOT EXISTS "pagos_proveedor_compraId_idx" ON "pagos_proveedor"("compraId");
CREATE INDEX IF NOT EXISTS "pagos_proveedor_proveedorId_idx" ON "pagos_proveedor"("proveedorId");
CREATE INDEX IF NOT EXISTS "pagos_proveedor_fecha_idx" ON "pagos_proveedor"("fecha");

ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "facturas_compra"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "bancos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "asientos_contables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
