# AELA

AELA ERP — Comprobantes Fiscales para Ecuador.

El proyecto combina:
- facturacion electronica SRI
- notas de venta para escenarios Lite
- caja diaria
- POS
- inventario
- contabilidad
- configuracion tributaria y operativa por empresa
- soporte monoempresa y multiempresa

## Stack

- Backend: Node.js, Express, Prisma, PostgreSQL
- Frontend: React, Vite, React Router, Axios
- Autenticacion: JWT
- Reportes: PDFKit y exportaciones CSV

## Estructura

- `backend/`: API, Prisma, reglas de negocio y utilidades SRI
- `frontend/`: aplicacion web React
- `docs/`: documentacion funcional y tecnica del sistema

## Modos y ediciones

AELA maneja dos conceptos distintos:

- `Tipo de sistema`
  - `full`: habilita contabilidad, ATS, retenciones y liquidaciones
  - `lite`: orientado a operacion simplificada y deshabilita modulos avanzados
- `Modo de operacion`
  - `monoempresa`: una sola empresa operativa
  - `multiempresa`: permite administrar varias empresas dentro del sistema

Ambos se pueden configurar desde la pantalla `Configuracion del Sistema`.

## Flujo inicial

1. Configurar base de datos y variables de entorno.
2. Ejecutar Prisma para crear tablas.
3. Levantar backend y frontend.
4. Entrar a `/login`.
5. Registrar la primera empresa y el primer administrador.
6. El sistema crea automaticamente:
   - configuracion base SRI
   - configuracion base del sistema
   - plan de cuentas base editable

## Arranque rapido

### Backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run db:migrate:safe
npm run catastro:import
npm run dev
```

### Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

## Variables de entorno

### Backend

Archivo: `backend/.env`

Variables principales:
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `PORT`
- `NODE_ENV`
- `AELA_EDITION`
- `MODO_EMPRESA`
- `FRONTEND_URL`
- `SMTP_*`

### Frontend

Archivo: `frontend/.env`

Variables principales:
- `VITE_API_URL`
- `VITE_EDITION`
- `VITE_MODO_EMPRESA`

Nota:
- hoy la edicion y el modo pueden arrancar desde `.env`, pero la configuracion operativa persistida del sistema pasa a ser la referencia principal dentro de la aplicacion.

## Documentacion disponible

- [Indice de documentacion](docs/README.md)
- [Puesta en Marcha](docs/puesta-en-marcha.md)
- [Arquitectura](docs/arquitectura.md)
- [Modulos](docs/modulos.md)
- [API principal](docs/api.md)
- [Estado del Proyecto](docs/estado-proyecto.md)

## Estado funcional actual

El sistema ya incluye:
- bootstrap inicial de empresa y administrador
- usuarios con roles
- configuracion SRI separada de configuracion operativa
- gestion de clientes, proveedores, productos y empresas
- caja diaria y cierre
- POS basico
- inventario
- compras con importacion desde XML o autorizacion SRI
- retenciones con vinculacion opcional a compras y precarga del documento sustento
- contabilidad con plan de cuentas, asientos y reportes base

## Calidad y pruebas

Comandos base recomendados:

### Backend

```powershell
cd backend
npm test
npm run db:backup
npm run db:migrate:dev:safe -- --name nombre_del_cambio
npm run catastro:import
```

Notas de seguridad para Prisma:
- No usar `prisma db push --accept-data-loss` sobre bases con datos.
- `db:migrate:safe` crea backup con `pg_dump`, ejecuta migraciones y restaura automáticamente si la migración falla.
- `catastro:import` carga por defecto los CSV oficiales de `docs/datosRuc` en `contribuyentes_sri`.

### Frontend

```powershell
cd frontend
npm test
npm run lint
npm run build
```

Además, el repositorio ya incluye un workflow base de CI en `.github/workflows/ci.yml` para ejecutar estas validaciones automáticamente en `push` y `pull_request`.

La cobertura automatizada ya valida una base inicial de:
- utilidades críticas de backend
- permisos y restricciones por plan
- helpers de sesión y acceso en frontend
- reglas base del flujo compra -> retención

También quedó saneado el frontend operativo para dejar `npm run lint` sin warnings, incluyendo:
- separación del hook `useAuth` del provider para evitar exports mixtos
- estabilización de `useEffect` y callbacks en caja, declaraciones, facturación, retenciones, notas de venta e inventario
- limpieza de variables y capturas sin uso en componentes y utilidades offline
- carga diferida por rutas en `App.jsx` para reducir el peso del arranque inicial
- eliminación del warning de Vite por import mixto de `offlineDB` en la cola offline

## Seguimiento

Para ver claramente:
- lo implementado
- lo validado
- lo pendiente
- los riesgos operativos

revisar [Estado del Proyecto](docs/estado-proyecto.md).

## Observaciones

- La configuracion de produccion SRI debe validarse cuidadosamente antes de emitir comprobantes reales.
- El plan de cuentas base es un punto de partida y el contador puede editarlo segun la necesidad de la empresa.
