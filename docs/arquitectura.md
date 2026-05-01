# Arquitectura

## Vision general

AELA esta dividido en dos aplicaciones:

- `backend`: API REST con logica de negocio, acceso a datos y servicios SRI
- `frontend`: SPA React para operacion diaria y administracion

## Backend

Carpetas principales:

- `backend/server.js`: arranque del servidor y montaje de rutas
- `backend/routes/`: endpoints por modulo
- `backend/utils/`: reglas de negocio y helpers
- `backend/middleware/`: autenticacion, permisos y control de modulos
- `backend/prisma/schema.prisma`: modelo de datos

## Frontend

Carpetas principales:

- `frontend/src/App.jsx`: rutas de la aplicacion
- `frontend/src/context/`: sesion y estado global
- `frontend/src/components/`: modulos visuales
- `frontend/src/services/api.js`: cliente Axios
- `frontend/src/utils/`: utilidades compartidas

## Multiempresa

La entidad `empresas` funciona como tenant.

Relaciones principales:
- usuarios por empresa
- clientes por empresa
- productos por empresa
- comprobantes por empresa
- configuracion SRI por empresa
- configuracion del sistema por empresa
- plan de cuentas y asientos por empresa

El modo `multiempresa` se persiste en la configuracion del sistema y afecta:
- autenticacion
- seleccion de empresa activa
- gestion de nuevas empresas

## Ediciones

La edicion `full` o `lite` se refleja en:
- `empresas.plan`
- `configuracion_sistema.tipoSistema`

Efectos:
- `full`: habilita modulos avanzados
- `lite`: simplifica la operacion y limita comprobantes anuales

## Seguridad

- JWT para autenticacion
- `middleware/auth.js` carga usuario y empresa activa
- permisos basados en rol
- middleware de modulos para bloquear funciones deshabilitadas

## Contabilidad

La contabilidad se apoya en:
- `periodos_contables`
- `plan_cuentas`
- `asientos_contables`
- `asientos_contables_detalle`

Caracteristicas actuales:
- plan de cuentas editable por empresa
- plan de cuentas base instalable
- asientos manuales y de ajuste
- asientos automaticos desde documentos
- reportes de diario, mayor y estados base

## Configuracion

Se separaron dos bloques:

- `configuracion_sri`
  - RUC
  - ambiente
  - certificado
  - datos tributarios
- `configuracion_sistema`
  - tipo de sistema
  - modo de operacion
  - modulos operativos
  - caja, POS, inventario
  - modulos avanzados

## Flujo de datos

1. Usuario inicia sesion
2. Backend valida JWT
3. Backend resuelve empresa activa
4. Frontend carga empresa y configuracion del sistema
5. Las rutas y menus se adaptan segun:
   - rol
   - tipo de sistema
   - modo de operacion
   - modulos habilitados
