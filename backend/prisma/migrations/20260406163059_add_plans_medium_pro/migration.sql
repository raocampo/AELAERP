-- CreateTable
CREATE TABLE "empresas" (
    "id" SERIAL NOT NULL,
    "ruc" VARCHAR(13) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "direccion" VARCHAR(300),
    "email" VARCHAR(150),
    "telefono" VARCHAR(20),
    "plan" VARCHAR(10) NOT NULL DEFAULT 'pro',
    "factAnualesMax" INTEGER,
    "maxUsuarios" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "nombre" VARCHAR(200) NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "email" VARCHAR(150),
    "password" TEXT NOT NULL,
    "rol" VARCHAR(50) NOT NULL DEFAULT 'operador',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "tipoIdentificacion" VARCHAR(2) NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "direccion" VARCHAR(300),
    "email" VARCHAR(150),
    "telefono" VARCHAR(20),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "productos_servicios" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "codigoPrincipal" VARCHAR(50) NOT NULL,
    "codigoAuxiliar" VARCHAR(50),
    "nombre" VARCHAR(300) NOT NULL,
    "precioUnitario" DECIMAL(14,4) NOT NULL,
    "costoUnitario" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "tarifaIva" INTEGER NOT NULL DEFAULT 15,
    "unidadMedida" VARCHAR(20) NOT NULL DEFAULT 'UND',
    "inventariable" BOOLEAN NOT NULL DEFAULT false,
    "stockActual" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockMinimo" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "infoAdicional" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "productos_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_sistema" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "tipoSistema" VARCHAR(20) NOT NULL DEFAULT 'full',
    "modoOperacion" VARCHAR(20) NOT NULL DEFAULT 'monoempresa',
    "cajaNombre" VARCHAR(80) NOT NULL DEFAULT 'Caja General',
    "cajaDiariaHabilitada" BOOLEAN NOT NULL DEFAULT true,
    "cierreCajaObligatorio" BOOLEAN NOT NULL DEFAULT false,
    "posHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "documentoPosDefault" VARCHAR(20) NOT NULL DEFAULT 'factura',
    "inventarioHabilitado" BOOLEAN NOT NULL DEFAULT false,
    "permitirStockNegativo" BOOLEAN NOT NULL DEFAULT false,
    "comprasHabilitadas" BOOLEAN NOT NULL DEFAULT true,
    "contabilidadHabilitada" BOOLEAN NOT NULL DEFAULT true,
    "retencionesHabilitadas" BOOLEAN NOT NULL DEFAULT true,
    "liquidacionesHabilitadas" BOOLEAN NOT NULL DEFAULT true,
    "atsHabilitado" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_sistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cajas_diarias" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "fechaOperacion" TIMESTAMP(3) NOT NULL,
    "nombreCaja" VARCHAR(80) NOT NULL DEFAULT 'Caja General',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ABIERTA',
    "montoApertura" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "aperturaRegistrada" BOOLEAN NOT NULL DEFAULT false,
    "montoCierreReal" DECIMAL(14,2),
    "diferenciaCierre" DECIMAL(14,2),
    "observacionesApertura" TEXT,
    "observacionesCierre" TEXT,
    "usuarioAperturaId" INTEGER,
    "usuarioCierreId" INTEGER,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cajas_diarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caja_movimientos" (
    "id" SERIAL NOT NULL,
    "cajaId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "usuarioId" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "categoria" VARCHAR(30),
    "monto" DECIMAL(14,2) NOT NULL,
    "descripcion" TEXT,
    "referencia" VARCHAR(120),
    "origenId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "caja_movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos_inventario" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "productoId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "tipo" VARCHAR(30) NOT NULL,
    "cantidad" DECIMAL(14,3) NOT NULL,
    "stockAnterior" DECIMAL(14,3) NOT NULL,
    "stockNuevo" DECIMAL(14,3) NOT NULL,
    "costoUnitario" DECIMAL(14,4),
    "referencia" VARCHAR(120),
    "observacion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_sri" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "ruc" VARCHAR(13) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "nombreComercial" VARCHAR(300),
    "dirMatriz" VARCHAR(300) NOT NULL,
    "dirEstablecimiento" VARCHAR(300),
    "establecimiento" VARCHAR(3) NOT NULL DEFAULT '001',
    "puntoEmision" VARCHAR(3) NOT NULL DEFAULT '001',
    "ambiente" INTEGER NOT NULL DEFAULT 1,
    "contribuyenteEspecial" VARCHAR(13),
    "contribuyenteRimpe" BOOLEAN NOT NULL DEFAULT false,
    "negocioPopular" BOOLEAN NOT NULL DEFAULT false,
    "obligadoContabilidad" BOOLEAN NOT NULL DEFAULT false,
    "agenteRetencion" VARCHAR(13),
    "certificadoP12" VARCHAR(500),
    "claveCertificado" VARCHAR(500),
    "tipoCertificado" VARCHAR(20) DEFAULT 'archivo',
    "logoUrl" VARCHAR(500),
    "emailNotificaciones" VARCHAR(150),
    "telefono" VARCHAR(20),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracion_sri_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numeroFactura" VARCHAR(17) NOT NULL,
    "secuencial" VARCHAR(9) NOT NULL,
    "rucEmisor" VARCHAR(13) NOT NULL,
    "razonSocialEmisor" VARCHAR(300) NOT NULL,
    "tipoIdentificacionComprador" VARCHAR(2) NOT NULL,
    "identificacionComprador" VARCHAR(20) NOT NULL,
    "razonSocialComprador" VARCHAR(300) NOT NULL,
    "direccionComprador" VARCHAR(300),
    "emailComprador" VARCHAR(150),
    "telefonoComprador" VARCHAR(20),
    "clienteId" INTEGER,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "subtotal0" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal15" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotalNoObjetoIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "propina" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles" JSONB NOT NULL,
    "pagos" JSONB NOT NULL,
    "infoAdicional" JSONB,
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
    "cobrada" BOOLEAN NOT NULL DEFAULT false,
    "fechaCobro" TIMESTAMP(3),
    "vendedor" VARCHAR(200),
    "observaciones" TEXT,
    "emisorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facturas_compra" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "emisorId" INTEGER,
    "tipoIdentificacionProveedor" VARCHAR(2) NOT NULL,
    "identificacionProveedor" VARCHAR(20) NOT NULL,
    "razonSocialProveedor" VARCHAR(300) NOT NULL,
    "nombreComercialProveedor" VARCHAR(300),
    "direccionProveedor" VARCHAR(300),
    "numeroFactura" VARCHAR(17) NOT NULL,
    "numeroAutorizacion" VARCHAR(49),
    "claveAcceso" VARCHAR(49),
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "subtotal0" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal15" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles" JSONB NOT NULL,
    "pagos" JSONB NOT NULL,
    "origenRegistro" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "registraInventario" BOOLEAN NOT NULL DEFAULT false,
    "creaProductos" BOOLEAN NOT NULL DEFAULT false,
    "movimientosInventario" INTEGER NOT NULL DEFAULT 0,
    "egresoCajaRegistrado" BOOLEAN NOT NULL DEFAULT false,
    "xmlOrigen" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "facturas_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_credito" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numeroNC" VARCHAR(17) NOT NULL,
    "secuencial" VARCHAR(9) NOT NULL,
    "facturaId" INTEGER,
    "numeroFacturaAfectada" VARCHAR(17) NOT NULL,
    "claveAccesoFacturaAfectada" VARCHAR(49),
    "tipoIdentificacionComprador" VARCHAR(2) NOT NULL,
    "identificacionComprador" VARCHAR(20) NOT NULL,
    "razonSocialComprador" VARCHAR(300) NOT NULL,
    "direccionComprador" VARCHAR(300),
    "motivoModificacion" TEXT NOT NULL,
    "fechaEmisionDocSustento" TIMESTAMP(3) NOT NULL,
    "totalSinImpuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles" JSONB NOT NULL,
    "estadoSri" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_FIRMA',
    "numeroAutorizacion" VARCHAR(49),
    "fechaAutorizacion" TIMESTAMP(3),
    "mensajesSri" JSONB,
    "xmlGenerado" TEXT,
    "xmlFirmado" TEXT,
    "xmlAutorizado" TEXT,
    "pdfUrl" VARCHAR(500),
    "emisorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_credito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retenciones" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numeroRetencion" VARCHAR(17) NOT NULL,
    "secuencial" VARCHAR(9) NOT NULL,
    "rucEmisor" VARCHAR(13) NOT NULL,
    "periodoFiscal" VARCHAR(7) NOT NULL,
    "tipoIdentificacionProveedor" VARCHAR(2) NOT NULL,
    "identificacionProveedor" VARCHAR(20) NOT NULL,
    "razonSocialProveedor" VARCHAR(300) NOT NULL,
    "tipoDocSustento" VARCHAR(2) NOT NULL,
    "numeroDocSustento" VARCHAR(17) NOT NULL,
    "fechaEmisionDocSustento" TIMESTAMP(3) NOT NULL,
    "impuestos" JSONB NOT NULL,
    "totalRetenido" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "estadoSri" VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE_FIRMA',
    "numeroAutorizacion" VARCHAR(49),
    "fechaAutorizacion" TIMESTAMP(3),
    "mensajesSri" JSONB,
    "xmlGenerado" TEXT,
    "xmlFirmado" TEXT,
    "xmlAutorizado" TEXT,
    "pdfUrl" VARCHAR(500),
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "emisorId" INTEGER,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retenciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones_compra" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "claveAcceso" VARCHAR(49) NOT NULL,
    "numeroLiquidacion" VARCHAR(17) NOT NULL,
    "secuencial" VARCHAR(9) NOT NULL,
    "rucEmisor" VARCHAR(13) NOT NULL,
    "tipoIdentificacionProveedor" VARCHAR(2) NOT NULL,
    "identificacionProveedor" VARCHAR(20) NOT NULL,
    "razonSocialProveedor" VARCHAR(300) NOT NULL,
    "direccionProveedor" VARCHAR(300),
    "subtotal0" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "subtotal15" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalIva" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "importeTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles" JSONB NOT NULL,
    "pagos" JSONB NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
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
    "emisorId" INTEGER,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquidaciones_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_venta" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "numeroNota" VARCHAR(17) NOT NULL,
    "secuencial" INTEGER NOT NULL,
    "rucEmisor" VARCHAR(13) NOT NULL,
    "razonSocialEmisor" VARCHAR(300) NOT NULL,
    "tipoIdentificacion" VARCHAR(2) NOT NULL,
    "identificacion" VARCHAR(20) NOT NULL,
    "razonSocial" VARCHAR(300) NOT NULL,
    "direccion" VARCHAR(300),
    "email" VARCHAR(150),
    "clienteId" INTEGER,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalDescuento" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "detalles" JSONB NOT NULL,
    "formaPago" VARCHAR(50) NOT NULL DEFAULT 'Efectivo',
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "observaciones" TEXT,
    "anulada" BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" TEXT,
    "pdfUrl" VARCHAR(500),
    "emisorId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notas_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periodos_contables" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "codigo" VARCHAR(7) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "fechaInicio" TIMESTAMP(3) NOT NULL,
    "fechaFin" TIMESTAMP(3) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'ABIERTO',
    "observacion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "periodos_contables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_cuentas" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "nivel" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "naturaleza" VARCHAR(20) NOT NULL,
    "codigoPadre" VARCHAR(20),
    "aceptaMovimiento" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "plan_cuentas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asientos_contables" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "numero" VARCHAR(20) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "referencia" VARCHAR(100),
    "facturaId" INTEGER,
    "cajaId" INTEGER,
    "totalDebe" DECIMAL(14,2) NOT NULL,
    "totalHaber" DECIMAL(14,2) NOT NULL,
    "cerrado" BOOLEAN NOT NULL DEFAULT false,
    "usuarioId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asientos_contables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asientos_contables_detalle" (
    "id" SERIAL NOT NULL,
    "asientoId" INTEGER NOT NULL,
    "cuentaId" INTEGER NOT NULL,
    "descripcion" TEXT,
    "debe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "haber" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "asientos_contables_detalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL DEFAULT 1,
    "usuarioId" INTEGER,
    "accion" VARCHAR(100) NOT NULL,
    "tabla" VARCHAR(100),
    "registroId" INTEGER,
    "datosAntes" JSONB,
    "datosNuevos" JSONB,
    "ip" VARCHAR(45),
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_ruc_key" ON "empresas"("ruc");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_username_key" ON "usuarios"("username");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "usuarios_empresaId_idx" ON "usuarios"("empresaId");

-- CreateIndex
CREATE INDEX "clientes_empresaId_idx" ON "clientes"("empresaId");

-- CreateIndex
CREATE INDEX "clientes_identificacion_idx" ON "clientes"("identificacion");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_empresaId_identificacion_key" ON "clientes"("empresaId", "identificacion");

-- CreateIndex
CREATE INDEX "productos_servicios_empresaId_idx" ON "productos_servicios"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "productos_servicios_empresaId_codigoPrincipal_key" ON "productos_servicios"("empresaId", "codigoPrincipal");

-- CreateIndex
CREATE UNIQUE INDEX "configuracion_sistema_empresaId_key" ON "configuracion_sistema"("empresaId");

-- CreateIndex
CREATE INDEX "cajas_diarias_empresaId_idx" ON "cajas_diarias"("empresaId");

-- CreateIndex
CREATE INDEX "cajas_diarias_estado_idx" ON "cajas_diarias"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "cajas_diarias_empresaId_fechaOperacion_key" ON "cajas_diarias"("empresaId", "fechaOperacion");

-- CreateIndex
CREATE INDEX "caja_movimientos_cajaId_idx" ON "caja_movimientos"("cajaId");

-- CreateIndex
CREATE INDEX "caja_movimientos_empresaId_idx" ON "caja_movimientos"("empresaId");

-- CreateIndex
CREATE INDEX "caja_movimientos_tipo_idx" ON "caja_movimientos"("tipo");

-- CreateIndex
CREATE INDEX "movimientos_inventario_empresaId_idx" ON "movimientos_inventario"("empresaId");

-- CreateIndex
CREATE INDEX "movimientos_inventario_productoId_idx" ON "movimientos_inventario"("productoId");

-- CreateIndex
CREATE INDEX "movimientos_inventario_tipo_idx" ON "movimientos_inventario"("tipo");

-- CreateIndex
CREATE INDEX "configuracion_sri_empresaId_idx" ON "configuracion_sri"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_claveAcceso_key" ON "facturas"("claveAcceso");

-- CreateIndex
CREATE INDEX "facturas_empresaId_idx" ON "facturas"("empresaId");

-- CreateIndex
CREATE INDEX "facturas_estadoSri_idx" ON "facturas"("estadoSri");

-- CreateIndex
CREATE INDEX "facturas_fechaEmision_idx" ON "facturas"("fechaEmision");

-- CreateIndex
CREATE INDEX "facturas_identificacionComprador_idx" ON "facturas"("identificacionComprador");

-- CreateIndex
CREATE INDEX "facturas_compra_empresaId_idx" ON "facturas_compra"("empresaId");

-- CreateIndex
CREATE INDEX "facturas_compra_fechaEmision_idx" ON "facturas_compra"("fechaEmision");

-- CreateIndex
CREATE INDEX "facturas_compra_identificacionProveedor_idx" ON "facturas_compra"("identificacionProveedor");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_compra_empresaId_identificacionProveedor_numeroFac_key" ON "facturas_compra"("empresaId", "identificacionProveedor", "numeroFactura");

-- CreateIndex
CREATE UNIQUE INDEX "notas_credito_claveAcceso_key" ON "notas_credito"("claveAcceso");

-- CreateIndex
CREATE INDEX "notas_credito_empresaId_idx" ON "notas_credito"("empresaId");

-- CreateIndex
CREATE INDEX "notas_credito_estadoSri_idx" ON "notas_credito"("estadoSri");

-- CreateIndex
CREATE UNIQUE INDEX "retenciones_claveAcceso_key" ON "retenciones"("claveAcceso");

-- CreateIndex
CREATE INDEX "retenciones_empresaId_idx" ON "retenciones"("empresaId");

-- CreateIndex
CREATE INDEX "retenciones_estadoSri_idx" ON "retenciones"("estadoSri");

-- CreateIndex
CREATE INDEX "retenciones_fechaEmision_idx" ON "retenciones"("fechaEmision");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_compra_claveAcceso_key" ON "liquidaciones_compra"("claveAcceso");

-- CreateIndex
CREATE INDEX "liquidaciones_compra_empresaId_idx" ON "liquidaciones_compra"("empresaId");

-- CreateIndex
CREATE INDEX "liquidaciones_compra_estadoSri_idx" ON "liquidaciones_compra"("estadoSri");

-- CreateIndex
CREATE INDEX "liquidaciones_compra_fechaEmision_idx" ON "liquidaciones_compra"("fechaEmision");

-- CreateIndex
CREATE INDEX "notas_venta_empresaId_idx" ON "notas_venta"("empresaId");

-- CreateIndex
CREATE INDEX "notas_venta_fechaEmision_idx" ON "notas_venta"("fechaEmision");

-- CreateIndex
CREATE UNIQUE INDEX "notas_venta_empresaId_secuencial_key" ON "notas_venta"("empresaId", "secuencial");

-- CreateIndex
CREATE INDEX "periodos_contables_empresaId_idx" ON "periodos_contables"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "periodos_contables_empresaId_codigo_key" ON "periodos_contables"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "plan_cuentas_empresaId_idx" ON "plan_cuentas"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "plan_cuentas_empresaId_codigo_key" ON "plan_cuentas"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "asientos_contables_empresaId_idx" ON "asientos_contables"("empresaId");

-- CreateIndex
CREATE INDEX "asientos_contables_fecha_idx" ON "asientos_contables"("fecha");

-- CreateIndex
CREATE INDEX "auditoria_empresaId_idx" ON "auditoria"("empresaId");

-- CreateIndex
CREATE INDEX "auditoria_accion_idx" ON "auditoria"("accion");

-- CreateIndex
CREATE INDEX "auditoria_fecha_idx" ON "auditoria"("fecha");

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos_servicios" ADD CONSTRAINT "productos_servicios_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_sistema" ADD CONSTRAINT "configuracion_sistema_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cajas_diarias" ADD CONSTRAINT "cajas_diarias_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cajas_diarias" ADD CONSTRAINT "cajas_diarias_usuarioAperturaId_fkey" FOREIGN KEY ("usuarioAperturaId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cajas_diarias" ADD CONSTRAINT "cajas_diarias_usuarioCierreId_fkey" FOREIGN KEY ("usuarioCierreId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "cajas_diarias"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caja_movimientos" ADD CONSTRAINT "caja_movimientos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "productos_servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_inventario" ADD CONSTRAINT "movimientos_inventario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_sri" ADD CONSTRAINT "configuracion_sri_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas_compra" ADD CONSTRAINT "facturas_compra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas_compra" ADD CONSTRAINT "facturas_compra_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_credito" ADD CONSTRAINT "notas_credito_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_credito" ADD CONSTRAINT "notas_credito_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retenciones" ADD CONSTRAINT "retenciones_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retenciones" ADD CONSTRAINT "retenciones_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones_compra" ADD CONSTRAINT "liquidaciones_compra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones_compra" ADD CONSTRAINT "liquidaciones_compra_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_venta" ADD CONSTRAINT "notas_venta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_venta" ADD CONSTRAINT "notas_venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_venta" ADD CONSTRAINT "notas_venta_emisorId_fkey" FOREIGN KEY ("emisorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables" ADD CONSTRAINT "asientos_contables_facturaId_fkey" FOREIGN KEY ("facturaId") REFERENCES "facturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables" ADD CONSTRAINT "asientos_contables_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "cajas_diarias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables" ADD CONSTRAINT "asientos_contables_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables_detalle" ADD CONSTRAINT "asientos_contables_detalle_asientoId_fkey" FOREIGN KEY ("asientoId") REFERENCES "asientos_contables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asientos_contables_detalle" ADD CONSTRAINT "asientos_contables_detalle_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "plan_cuentas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
