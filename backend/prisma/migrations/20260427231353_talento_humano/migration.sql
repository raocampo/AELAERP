-- AlterTable
ALTER TABLE "asientos_contables" ADD COLUMN     "bloqueado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bloqueadoPor" INTEGER;

-- AlterTable
ALTER TABLE "configuracion_sistema" ADD COLUMN     "talentoHumanoHabilitado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "facturas" ADD COLUMN     "sincronizadoOffline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "subtotal5" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "facturas_compra" ADD COLUMN     "anulada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retencionIVA" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retencionRenta" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "subtotal5" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "notas_credito" ADD COLUMN     "anulada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "motivoAnulacion" TEXT;

-- AlterTable
ALTER TABLE "notas_venta" ADD COLUMN     "sincronizadoOffline" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "notas_debito" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numero" VARCHAR(17) NOT NULL,
    "secuencial" VARCHAR(9) NOT NULL,
    "rucEmisor" VARCHAR(13) NOT NULL,
    "codDocSustento" VARCHAR(2) NOT NULL DEFAULT '01',
    "numeroDocSustento" VARCHAR(17) NOT NULL,
    "fechaEmisionDocSustento" TIMESTAMP(3) NOT NULL,
    "tipoIdentificacionComprador" VARCHAR(2) NOT NULL,
    "identificacionComprador" VARCHAR(20) NOT NULL,
    "razonSocialComprador" VARCHAR(300) NOT NULL,
    "motivos" JSONB NOT NULL,
    "ivaPorcentaje" INTEGER NOT NULL DEFAULT 15,
    "totalSinImpuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "valorTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "estadoSri" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_FIRMA',
    "numeroAutorizacion" VARCHAR(49),
    "fechaAutorizacion" TIMESTAMP(3),
    "mensajesSri" JSONB,
    "xmlGenerado" TEXT,
    "xmlFirmado" TEXT,
    "xmlAutorizado" TEXT,
    "pdfUrl" VARCHAR(500),
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" TEXT,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "emisorId" INTEGER,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_debito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contribuyentes_sri" (
    "id" SERIAL NOT NULL,
    "ruc" VARCHAR(13) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "estado" VARCHAR(20),
    "claseContribuyente" VARCHAR(50),
    "tipoContribuyente" VARCHAR(50),
    "obligadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "provincia" VARCHAR(80),
    "canton" VARCHAR(80),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contribuyentes_sri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retenciones_recibidas" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numeroAutorizacion" VARCHAR(49),
    "fechaAutorizacion" TIMESTAMP(3),
    "rucAgente" VARCHAR(20) NOT NULL,
    "razonSocialAgente" VARCHAR(300) NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "numDocSustento" VARCHAR(17),
    "totalRetencionIva" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "totalRetencionRenta" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "facturaId" INTEGER,
    "detalles" JSONB NOT NULL,
    "xmlAutorizado" TEXT,
    "observaciones" TEXT,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retenciones_recibidas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs_recibidos_otros" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "tipoDocumento" VARCHAR(2) NOT NULL,
    "tipoDescripcion" VARCHAR(50) NOT NULL,
    "numeroAutorizacion" VARCHAR(49),
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "rucEmisor" VARCHAR(20) NOT NULL,
    "razonSocialEmisor" VARCHAR(300) NOT NULL,
    "importeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "xmlAutorizado" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docs_recibidos_otros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guias_remision" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001',
    "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001',
    "secuencial" VARCHAR(9) NOT NULL,
    "fechaIniTransporte" TIMESTAMP(3) NOT NULL,
    "fechaFinTransporte" TIMESTAMP(3) NOT NULL,
    "dirPartida" VARCHAR(300) NOT NULL,
    "rucTransportista" VARCHAR(20) NOT NULL,
    "nombreTransportista" VARCHAR(300) NOT NULL,
    "placaVehiculo" VARCHAR(20),
    "rucDestinatario" VARCHAR(20) NOT NULL,
    "nombreDestinatario" VARCHAR(300) NOT NULL,
    "dirDestinatario" VARCHAR(300) NOT NULL,
    "motivoTraslado" VARCHAR(300) NOT NULL,
    "docAduaneroUnico" VARCHAR(20),
    "detalles" JSONB NOT NULL,
    "codDocSustento" VARCHAR(2) DEFAULT '01',
    "numDocSustento" VARCHAR(17),
    "numAutDocSustento" VARCHAR(49),
    "fechaEmisionDocSustento" TIMESTAMP(3),
    "claveAcceso" VARCHAR(49),
    "numeroAutorizacion" VARCHAR(49),
    "fechaAutorizacion" TIMESTAMP(3),
    "estadoSRI" VARCHAR(20) NOT NULL DEFAULT 'NO_ENVIADA',
    "mensajesSri" JSONB,
    "observaciones" TEXT,
    "xmlGenerado" TEXT,
    "xmlFirmado" TEXT,
    "pdfUrl" VARCHAR(500),
    "pdfBase64" TEXT,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guias_remision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bancos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "banco" VARCHAR(100) NOT NULL,
    "tipoCuenta" VARCHAR(20) NOT NULL DEFAULT 'CORRIENTE',
    "numeroCuenta" VARCHAR(30) NOT NULL,
    "titular" VARCHAR(200),
    "saldoInicial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cuentaContableId" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bancos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_bancarios" (
    "id" SERIAL NOT NULL,
    "bancoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "concepto" VARCHAR(300) NOT NULL,
    "referencia" VARCHAR(100),
    "debe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "haber" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "saldoParcial" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "asientoId" INTEGER,
    "chequeId" INTEGER,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "movimientos_bancarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cheques" (
    "id" SERIAL NOT NULL,
    "bancoId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "numero" VARCHAR(30) NOT NULL,
    "beneficiario" VARCHAR(300) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "monto" DECIMAL(14,2) NOT NULL,
    "concepto" VARCHAR(300),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "proveedorId" INTEGER,
    "usuarioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departamentos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" VARCHAR(300),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cargos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "departamentoId" INTEGER,
    "nombre" VARCHAR(150) NOT NULL,
    "descripcion" VARCHAR(300),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empleados" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "departamentoId" INTEGER,
    "cargoId" INTEGER,
    "cedula" VARCHAR(13) NOT NULL,
    "nombres" VARCHAR(150) NOT NULL,
    "apellidos" VARCHAR(150) NOT NULL,
    "email" VARCHAR(150),
    "telefono" VARCHAR(20),
    "direccion" VARCHAR(300),
    "fechaNacimiento" TIMESTAMP(3),
    "sexo" VARCHAR(1),
    "estadoCivil" VARCHAR(20),
    "tipoContrato" VARCHAR(30) NOT NULL DEFAULT 'indefinido',
    "fechaIngreso" TIMESTAMP(3) NOT NULL,
    "fechaSalida" TIMESTAMP(3),
    "motivoSalida" VARCHAR(200),
    "salarioBase" DECIMAL(10,2) NOT NULL,
    "afiliadoIESS" BOOLEAN NOT NULL DEFAULT true,
    "codigoIESS" VARCHAR(30),
    "tieneRenta" BOOLEAN NOT NULL DEFAULT false,
    "fondosReserva" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empleados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contratos" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "empleadoId" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3),
    "salario" DECIMAL(10,2) NOT NULL,
    "observaciones" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contratos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nominas" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "observaciones" TEXT,
    "totalBruto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuentos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalNeto" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creadoPor" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nominas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nomina_detalles" (
    "id" SERIAL NOT NULL,
    "nominaId" INTEGER NOT NULL,
    "empleadoId" INTEGER NOT NULL,
    "salarioBase" DECIMAL(10,2) NOT NULL,
    "horasExtraSuplemento" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "horasExtraExtraordinario" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "valorHorasExtraSuplemento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valorHorasExtraExtraordinario" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otrosIngresos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otrosIngresosDetalle" VARCHAR(300),
    "decimoTerceroProp" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "decimoCuartoProp" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fondosReservaProp" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "aportePersonalIESS" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "impuestoRenta" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "prestamosIESS" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "anticipos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otrosDescuentos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "otrosDescuentosDetalle" VARCHAR(300),
    "aportePatronal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalIngresos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalDescuentos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netoApagar" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "observaciones" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nomina_detalles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ausencias" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "empleadoId" INTEGER NOT NULL,
    "tipo" VARCHAR(30) NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "dias" INTEGER NOT NULL,
    "aprobado" BOOLEAN NOT NULL DEFAULT false,
    "aprobadoPor" INTEGER,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notas_debito_claveAcceso_key" ON "notas_debito"("claveAcceso");

-- CreateIndex
CREATE INDEX "notas_debito_empresaId_idx" ON "notas_debito"("empresaId");

-- CreateIndex
CREATE INDEX "notas_debito_estadoSri_idx" ON "notas_debito"("estadoSri");

-- CreateIndex
CREATE INDEX "notas_debito_fechaEmision_idx" ON "notas_debito"("fechaEmision");

-- CreateIndex
CREATE UNIQUE INDEX "contribuyentes_sri_ruc_key" ON "contribuyentes_sri"("ruc");

-- CreateIndex
CREATE INDEX "contribuyentes_sri_ruc_idx" ON "contribuyentes_sri"("ruc");

-- CreateIndex
CREATE INDEX "retenciones_recibidas_empresaId_idx" ON "retenciones_recibidas"("empresaId");

-- CreateIndex
CREATE INDEX "retenciones_recibidas_fechaEmision_idx" ON "retenciones_recibidas"("fechaEmision");

-- CreateIndex
CREATE UNIQUE INDEX "retenciones_recibidas_empresaId_claveAcceso_key" ON "retenciones_recibidas"("empresaId", "claveAcceso");

-- CreateIndex
CREATE INDEX "docs_recibidos_otros_empresaId_idx" ON "docs_recibidos_otros"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "docs_recibidos_otros_empresaId_claveAcceso_key" ON "docs_recibidos_otros"("empresaId", "claveAcceso");

-- CreateIndex
CREATE INDEX "guias_remision_empresaId_idx" ON "guias_remision"("empresaId");

-- CreateIndex
CREATE INDEX "guias_remision_fechaIniTransporte_idx" ON "guias_remision"("fechaIniTransporte");

-- CreateIndex
CREATE INDEX "guias_remision_estadoSRI_idx" ON "guias_remision"("estadoSRI");

-- CreateIndex
CREATE UNIQUE INDEX "guias_remision_empresaId_establecimiento_puntoEmision_secue_key" ON "guias_remision"("empresaId", "establecimiento", "puntoEmision", "secuencial");

-- CreateIndex
CREATE INDEX "bancos_empresaId_idx" ON "bancos"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "bancos_empresaId_numeroCuenta_key" ON "bancos"("empresaId", "numeroCuenta");

-- CreateIndex
CREATE INDEX "movimientos_bancarios_bancoId_idx" ON "movimientos_bancarios"("bancoId");

-- CreateIndex
CREATE INDEX "movimientos_bancarios_empresaId_idx" ON "movimientos_bancarios"("empresaId");

-- CreateIndex
CREATE INDEX "movimientos_bancarios_fecha_idx" ON "movimientos_bancarios"("fecha");

-- CreateIndex
CREATE INDEX "cheques_bancoId_idx" ON "cheques"("bancoId");

-- CreateIndex
CREATE INDEX "cheques_empresaId_idx" ON "cheques"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_bancoId_numero_key" ON "cheques"("bancoId", "numero");

-- CreateIndex
CREATE INDEX "departamentos_empresaId_idx" ON "departamentos"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "departamentos_empresaId_nombre_key" ON "departamentos"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "cargos_empresaId_idx" ON "cargos"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "cargos_empresaId_nombre_key" ON "cargos"("empresaId", "nombre");

-- CreateIndex
CREATE INDEX "empleados_empresaId_idx" ON "empleados"("empresaId");

-- CreateIndex
CREATE INDEX "empleados_activo_idx" ON "empleados"("activo");

-- CreateIndex
CREATE UNIQUE INDEX "empleados_empresaId_cedula_key" ON "empleados"("empresaId", "cedula");

-- CreateIndex
CREATE INDEX "contratos_empresaId_idx" ON "contratos"("empresaId");

-- CreateIndex
CREATE INDEX "contratos_empleadoId_idx" ON "contratos"("empleadoId");

-- CreateIndex
CREATE INDEX "nominas_empresaId_idx" ON "nominas"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "nominas_empresaId_mes_anio_key" ON "nominas"("empresaId", "mes", "anio");

-- CreateIndex
CREATE INDEX "nomina_detalles_nominaId_idx" ON "nomina_detalles"("nominaId");

-- CreateIndex
CREATE INDEX "nomina_detalles_empleadoId_idx" ON "nomina_detalles"("empleadoId");

-- CreateIndex
CREATE UNIQUE INDEX "nomina_detalles_nominaId_empleadoId_key" ON "nomina_detalles"("nominaId", "empleadoId");

-- CreateIndex
CREATE INDEX "ausencias_empresaId_idx" ON "ausencias"("empresaId");

-- CreateIndex
CREATE INDEX "ausencias_empleadoId_idx" ON "ausencias"("empleadoId");

-- RenameForeignKey
ALTER TABLE "asientos_contables" RENAME CONSTRAINT "asientos_contables_usuarioId_fkey" TO "asientos_usuario_fk";

-- AddForeignKey
ALTER TABLE "notas_debito" ADD CONSTRAINT "notas_debito_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_debito" ADD CONSTRAINT "notas_debito_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables" ADD CONSTRAINT "asientos_contables_bloqueadoPor_fkey" FOREIGN KEY ("bloqueadoPor") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retenciones_recibidas" ADD CONSTRAINT "retenciones_recibidas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retenciones_recibidas" ADD CONSTRAINT "retenciones_recibidas_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "docs_recibidos_otros" ADD CONSTRAINT "docs_recibidos_otros_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guias_remision" ADD CONSTRAINT "guias_remision_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guias_remision" ADD CONSTRAINT "guias_remision_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bancos" ADD CONSTRAINT "bancos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bancos" ADD CONSTRAINT "bancos_cuentaContableId_fkey" FOREIGN KEY ("cuentaContableId") REFERENCES "plan_cuentas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "bancos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "asientos_contables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_bancarios" ADD CONSTRAINT "movimientos_bancarios_chequeId_fkey" FOREIGN KEY ("chequeId") REFERENCES "cheques"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bancoId_fkey" FOREIGN KEY ("bancoId") REFERENCES "bancos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departamentos" ADD CONSTRAINT "departamentos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cargos" ADD CONSTRAINT "cargos_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "departamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_departamentoId_fkey" FOREIGN KEY ("departamentoId") REFERENCES "departamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "empleados" ADD CONSTRAINT "empleados_cargoId_fkey" FOREIGN KEY ("cargoId") REFERENCES "cargos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nominas" ADD CONSTRAINT "nominas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomina_detalles" ADD CONSTRAINT "nomina_detalles_nominaId_fkey" FOREIGN KEY ("nominaId") REFERENCES "nominas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomina_detalles" ADD CONSTRAINT "nomina_detalles_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "empleados"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
