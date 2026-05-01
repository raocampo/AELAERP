# API principal

## Autenticacion

- `GET /api/auth/bootstrap-status`
- `POST /api/auth/bootstrap`
- `POST /api/auth/login`
- `GET /api/auth/perfil`

## Configuracion del sistema

- `GET /api/configuracion-sistema`
- `PUT /api/configuracion-sistema`

Campos principales:
- `tipoSistema`
- `modoOperacion`
- `cajaDiariaHabilitada`
- `posHabilitado`
- `inventarioHabilitado`
- `comprasHabilitadas`
- `contabilidadHabilitada`
- `retencionesHabilitadas`
- `liquidacionesHabilitadas`
- `atsHabilitado`

## Empresas

- `GET /api/empresas`
- `GET /api/empresas/mi-empresa`
- `GET /api/empresas/consultar-sri/:ruc`
- `GET /api/empresas/estadisticas`
- `POST /api/empresas`
- `PUT /api/empresas/:id`

## Usuarios

- `GET /api/usuarios`
- `POST /api/usuarios`
- `PUT /api/usuarios/:id`

## Clientes

- `GET /api/clientes`
- `POST /api/clientes`
- `PUT /api/clientes/:id`

## Productos e inventario

- `GET /api/productos`
- `POST /api/productos`
- `PUT /api/productos/:id`
- `GET /api/productos/importacion/plantilla`
- `POST /api/productos/importacion/excel`
- `POST /api/productos/importacion/xml`
- `POST /api/productos/importacion/autorizacion`
- `GET /api/inventario/resumen`
- `GET /api/inventario/movimientos`
- `POST /api/inventario/movimientos`

## Caja

- `GET /api/caja/resumen`
- `GET /api/caja/historial`
- `POST /api/caja/apertura`
- `POST /api/caja/movimientos`
- `POST /api/caja/cierre`

## Compras

- `GET /api/compras`
- `GET /api/compras/:id`
- `POST /api/compras`
- `POST /api/compras/importar/xml`
- `POST /api/compras/importar/autorizacion`

Notas:
- `GET /api/compras/:id` devuelve tambien proveedor maestro vinculado y retenciones no anuladas asociadas cuando existan.

## Proveedores

- `GET /api/proveedores`
- `GET /api/proveedores/buscar`
- `GET /api/proveedores/sri/:identificacion`
- `GET /api/proveedores/:id`
- `POST /api/proveedores`
- `PUT /api/proveedores/:id`

## Facturacion

- `GET /api/facturas`
- `POST /api/facturas`
- `GET /api/facturas/:id`
- `POST /api/facturas/:id/anular`
- `POST /api/facturas/:id/nota-credito`

## Notas de venta

- `GET /api/notas-venta`
- `POST /api/notas-venta`
- `GET /api/notas-venta/:id`
- `POST /api/notas-venta/:id/anular`

## Retenciones

- `GET /api/retenciones/catalogos/impuestos`
- `GET /api/retenciones`
- `GET /api/retenciones/compras/buscar`
- `GET /api/retenciones/compras/:compraId/preload`
- `POST /api/retenciones`
- `GET /api/retenciones/:id`
- `GET /api/retenciones/:id/pdf`
- `GET /api/retenciones/:id/xml`
- `POST /api/retenciones/:id/reenviar`
- `POST /api/retenciones/:id/anular`

Notas:
- `POST /api/retenciones` acepta `compraId` opcional para precargar proveedor y documento sustento desde una compra existente.
- Cuando una retencion se vincula a una compra, el backend sincroniza los acumulados `retencionIVA` y `retencionRenta` de esa compra.

## Liquidaciones

- `GET /api/liquidaciones`
- `POST /api/liquidaciones`
- `GET /api/liquidaciones/:id`
- `POST /api/liquidaciones/:id/anular`

## ATS

- `GET /api/ats/preview`
- `GET /api/ats/exportar`

## Contabilidad

- `GET /api/contabilidad/periodos`
- `POST /api/contabilidad/periodos`
- `PUT /api/contabilidad/periodos/:id`
- `GET /api/contabilidad/plan-cuentas`
- `POST /api/contabilidad/plan-cuentas`
- `PUT /api/contabilidad/plan-cuentas/:id`
- `DELETE /api/contabilidad/plan-cuentas/:id`
- `POST /api/contabilidad/importar-plan`
- `POST /api/contabilidad/plan-cuentas/semilla`
- `GET /api/contabilidad/asientos`
- `POST /api/contabilidad/asiento-inicial`
- `POST /api/contabilidad/asientos`
- `GET /api/contabilidad/asientos/:id`
- `PUT /api/contabilidad/asientos/:id`
- `POST /api/contabilidad/asientos/:id/cerrar`
- `POST /api/contabilidad/asientos/:id/anular`
- `GET /api/contabilidad/mayor/:cuentaId`
- `GET /api/contabilidad/mayorizacion`
- `GET /api/contabilidad/consultas/resumen`
- `GET /api/contabilidad/reportes/diario`
- `GET /api/contabilidad/reportes/mayor`
- `GET /api/contabilidad/reportes/estados`
- `GET /api/contabilidad/balance-comprobacion`
- `GET /api/contabilidad/estado-resultados`
- `GET /api/contabilidad/balance-general`

## Notas

- Todas las rutas protegidas usan JWT Bearer.
- Las rutas avanzadas pueden quedar bloqueadas por:
  - rol
  - tipo de sistema
  - modulo deshabilitado
