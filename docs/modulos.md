# Modulos

## Autenticacion y usuarios

- login por usuario o correo
- bootstrap inicial si no existen usuarios
- roles:
  - administrador
  - supervisor
  - contador / financiero
  - facturador
  - operador

## Empresas

- gestion de empresas en modo multiempresa
- consulta de RUC en SRI
- configuracion inicial por empresa

## Configuracion SRI

Incluye:
- datos del emisor
- ambiente
- establecimiento
- punto de emision
- certificado
- datos tributarios

No incluye:
- planes del sistema
- caja
- POS
- inventario

## Configuracion del sistema

Permite definir:
- tipo de sistema: `lite`, `medium` o `pro`
- modo operativo: `monoempresa` o `multiempresa`
- caja diaria
- POS
- inventario
- compras
- contabilidad
- retenciones
- liquidaciones
- ATS
- talento humano (RRHH) — disponible desde Medium

## Navegacion — Sidebar

El sidebar usa un diseño de grupos colapsables:

- **Items independientes** (siempre visibles): Dashboard, POS
- **Ventas**: Facturas, Notas de Venta, Caja Diaria, Notas de Debito, Guias de Remision
- **Compras**: Compras, Buzon SRI
- **Inventario**: Productos, Control de Inventario
- **Clientes y Proveedores**: Clientes, Proveedores
- **Tributario**: Retenciones, Liquidaciones, ATS, Declaraciones, Reportes Tributarios
- **Contabilidad**: Contabilidad, Bancos
- **Talento Humano**: Resumen, Empleados, Departamentos, Cargos, Nomina, Ausencias
- **Configuracion**: Config SRI, Config Sistema
- **Administracion**: Usuarios, Empresas

Items bloqueados por plan o modulo desactivado muestran un candado visual. El grupo activo se abre automaticamente al navegar.

## Facturacion

- emision de facturas
- consulta y detalle
- integracion con configuracion SRI
- asientos automaticos al autorizar

## Notas de venta

- documento operativo para escenarios compatibles con Lite
- ideal para operacion simplificada

## Caja diaria

- apertura
- movimientos manuales
- ingresos y egresos
- resumen del dia
- cierre y diferencias

## POS

- venta rapida
- uso del catalogo de productos
- integra caja e inventario
- lectura por codigo de barras usando `codigoPrincipal` o `codigoAuxiliar`
- busqueda manual por nombre o codigo

## Inventario

- productos inventariables
- control de stock
- movimientos automaticos desde ventas
- soporte opcional de stock negativo
- plantilla Excel para carga masiva
- importacion desde Excel o archivos compatibles
- importacion desde XML de compra
- importacion desde clave de acceso / autorizacion SRI cuando el XML autorizado este disponible

## Compras

- registro formal de facturas de compra
- maestro de proveedores separado y reutilizable desde compras
- listado de compras con filtros por proveedor, fecha y numero
- detalle individual de compra con cabecera, totales, pagos y lineas registradas
- detalle con retenciones vinculadas y acceso directo para emitirlas
- precarga desde XML
- precarga desde clave de acceso / autorizacion del SRI
- creacion automatica de productos faltantes
- actualizacion opcional de costos en productos existentes
- entrada opcional a inventario desde la compra
- egreso opcional de caja desde la compra
- restriccion en AELA Lite desde frontend y backend

## Proveedores

- maestro de proveedores separado del encabezado de compras
- consulta opcional al SRI para precarga de datos
- activacion y desactivacion de proveedores
- busqueda rapida desde el formulario de compras
- vinculacion opcional entre la compra registrada y el proveedor maestro

## Retenciones

- emision y consulta
- busqueda de compras para precargar proveedor y documento sustento
- vinculacion opcional con compras para acumular retencion IVA y renta en la factura registrada
- bloqueable por configuracion del sistema

## Liquidaciones de compra

- emision y consulta
- bloqueable por configuracion del sistema

## ATS

- vista previa
- exportacion
- bloqueable por configuracion del sistema

## Contabilidad

- periodos contables
- plan de cuentas editable
- plan de cuentas base AELA
- asientos manuales
- asiento inicial
- mayor
- mayorizacion
- balance de comprobacion
- estado de resultados
- balance general

## Plan de cuentas base

El sistema instala automaticamente un plan de cuentas base al crear la primera empresa o una nueva empresa.

Ese plan:
- es editable
- se puede complementar
- se puede volver a sincronizar desde el modulo de contabilidad
- sirve como punto de partida para que el contador lo adapte a la realidad de la empresa

## Talento Humano (RRHH)

Disponible desde plan **Medium**. Se activa desde Configuracion del Sistema con el toggle `talentoHumanoHabilitado`.

### Maestros

**Departamentos**
- CRUD de departamentos por empresa
- contador de empleados asignados
- desactivacion protegida (no se puede desactivar si tiene empleados activos)

**Cargos**
- CRUD de cargos por empresa
- vinculacion opcional a un departamento

**Empleados**
- datos personales: cedula/pasaporte, nombres, apellidos, email, telefono, direccion, fecha de nacimiento, sexo, estado civil
- datos laborales: tipo de contrato, fecha de ingreso, salario base, departamento, cargo
- configuracion IESS: codigo de afiliacion, porcentaje de aporte (9.45% personal / 11.15% patronal)
- flags: `afiliadoIESS`, `tieneRenta`, `fondosReserva` (este ultimo habilita el calculo tras 1 año)
- estado activo/inactivo con fecha y motivo de salida

### Nomina / Rol de Pagos

- una nomina por mes/año por empresa
- estados: `BORRADOR` → `PROCESADA` → `PAGADA`
- al crear, calcula automaticamente todos los empleados activos con los siguientes conceptos:

**Ingresos:**
- salario base
- horas extras suplementarias (valor hora × 1.25)
- horas extras extraordinarias (valor hora × 1.50)
- otros ingresos (libre)

**Descuentos:**
- aporte personal IESS (9.45%)
- impuesto a la renta (ingreso manual)
- prestamos IESS (ingreso manual)
- anticipos (ingreso manual)
- otros descuentos (libre)

**Informativos (no descuentos del mes):**
- decimo tercer sueldo proporcional (salario/12)
- decimo cuarto sueldo proporcional (SBU/12, SBU = $460 para 2024)
- fondos de reserva proporcional (salario/12, solo si aplica)

**Aporte patronal IESS: 11.15%** (costo empresa, informativo)

Flujo:
1. Crear nomina → calculo automatico base
2. Editar detalles individuales (horas extras, bonos, descuentos especiales)
3. Procesar (estado PROCESADA)
4. Marcar como Pagada (estado PAGADA, bloqueada para edicion)

### Ausencias / Vacaciones

Tipos disponibles:
- Vacacion
- Permiso Personal
- Enfermedad
- Maternidad
- Paternidad
- Licencia

Flujo:
- registro con fechas inicio/fin (calculo automatico de dias)
- aprobacion por supervisor o admin
- historial por empleado

### Permisos

| Permiso | Roles |
|---------|-------|
| `rrhh.ver` | admin, supervisor, contador |
| `rrhh.gestionar` | admin, supervisor |
| `rrhh.nomina` | admin, contador |

### Rutas frontend

| Ruta | Componente | Permiso |
|------|------------|---------|
| `/talento-humano` | TalentoHumanoHub | rrhh.ver |
| `/talento-humano/empleados` | ListaEmpleados | rrhh.ver |
| `/talento-humano/empleados/:id` | FormEmpleado | rrhh.ver |
| `/talento-humano/empleados/nuevo` | FormEmpleado | rrhh.gestionar |
| `/talento-humano/departamentos` | Departamentos | rrhh.gestionar |
| `/talento-humano/cargos` | Cargos | rrhh.gestionar |
| `/talento-humano/nomina` | Nomina | rrhh.nomina |
| `/talento-humano/ausencias` | Ausencias | rrhh.ver |

### API backend

Todas las rutas bajo `/api/talento-humano`. Protegidas con `soloMediumOPro` y autenticacion JWT.

```
GET    /departamentos
POST   /departamentos
PUT    /departamentos/:id
DELETE /departamentos/:id

GET    /cargos
POST   /cargos
PUT    /cargos/:id

GET    /empleados
GET    /empleados/:id
POST   /empleados
PUT    /empleados/:id

GET    /nomina
GET    /nomina/:id
POST   /nomina
PUT    /nomina/:nominaId/detalle/:empleadoId
PATCH  /nomina/:id/estado
DELETE /nomina/:id

GET    /ausencias
POST   /ausencias
PATCH  /ausencias/:id/aprobar
DELETE /ausencias/:id

GET    /dashboard
```
