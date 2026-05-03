-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "esMatriz" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentEmpresaId" INTEGER;

-- CreateTable
CREATE TABLE "usuario_empresas" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "rol" VARCHAR(50) NOT NULL DEFAULT 'operador',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuario_empresas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuario_empresas_usuarioId_empresaId_key" ON "usuario_empresas"("usuarioId", "empresaId");

-- AddForeignKey
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_parentEmpresaId_fkey" FOREIGN KEY ("parentEmpresaId") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_empresas" ADD CONSTRAINT "usuario_empresas_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuario_empresas" ADD CONSTRAINT "usuario_empresas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
