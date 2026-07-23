-- Ítems de compra a $0.00 (regalos/combos de proveedor, ej. "P-1043664" ligado
-- al producto real "1043664") que no matchearon con ningún "hermano" en la
-- misma factura por prefijo configurado. En vez de crear un producto huérfano
-- en productos_servicios, se registran aquí para resolución manual (asignar
-- a un producto existente, ignorar, o crear el producto de todas formas).
-- Reportado por Comercial S&S (tenant "sys"): los proveedores facturan
-- regalos/combos a $0.00 con códigos derivados del producto real mediante un
-- prefijo, y el matching exacto existente siempre creaba un producto nuevo.

-- Lista de prefijos configurable por empresa (JSON array), con default
-- razonable resuelto en código si la empresa no la ha configurado aún.
ALTER TABLE "configuracion_sistema"
  ADD COLUMN "prefijosRegaloCompras" TEXT;

CREATE TABLE "items_compra_pendientes" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "compraId" INTEGER NOT NULL,
    "codigoPrincipal" VARCHAR(50) NOT NULL,
    "codigoAuxiliar" VARCHAR(50),
    "descripcion" VARCHAR(300) NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "prefijoDetectado" VARCHAR(20),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "productoAsignadoId" INTEGER,
    "usuarioResuelveId" INTEGER,
    "movimientoInventarioId" INTEGER,
    "resueltoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_compra_pendientes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "items_compra_pendientes_empresaId_idx" ON "items_compra_pendientes"("empresaId");
CREATE INDEX "items_compra_pendientes_compraId_idx" ON "items_compra_pendientes"("compraId");
CREATE INDEX "items_compra_pendientes_estado_idx" ON "items_compra_pendientes"("estado");

ALTER TABLE "items_compra_pendientes" ADD CONSTRAINT "items_compra_pendientes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "items_compra_pendientes" ADD CONSTRAINT "items_compra_pendientes_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "facturas_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "items_compra_pendientes" ADD CONSTRAINT "items_compra_pendientes_productoAsignadoId_fkey" FOREIGN KEY ("productoAsignadoId") REFERENCES "productos_servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items_compra_pendientes" ADD CONSTRAINT "items_compra_pendientes_usuarioResuelveId_fkey" FOREIGN KEY ("usuarioResuelveId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items_compra_pendientes" ADD CONSTRAINT "items_compra_pendientes_movimientoInventarioId_fkey" FOREIGN KEY ("movimientoInventarioId") REFERENCES "movimientos_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
