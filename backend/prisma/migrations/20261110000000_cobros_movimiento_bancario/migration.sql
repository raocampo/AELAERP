-- Cobros CxC no-efectivo: enlace a su fila en Libro de Bancos.
ALTER TABLE "cobros_cliente" ADD COLUMN IF NOT EXISTS "movimientoBancarioId" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "cobros_cliente_movimientoBancarioId_key" ON "cobros_cliente"("movimientoBancarioId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cobros_cliente_movimientoBancarioId_fkey') THEN
    ALTER TABLE "cobros_cliente" ADD CONSTRAINT "cobros_cliente_movimientoBancarioId_fkey"
      FOREIGN KEY ("movimientoBancarioId") REFERENCES "movimientos_bancarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
