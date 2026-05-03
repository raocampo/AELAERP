# Puesta en Marcha

## 1. Requisitos

- Node.js 18 o superior
- PostgreSQL
- NPM

## 2. Base de datos

Crear una base PostgreSQL, por ejemplo:

- Base: `aela_db`
- Esquema: `public`

Configurar `DATABASE_URL` en `backend/.env`.

Si la contrasena contiene caracteres especiales como `@`, usar URL encoding:

```env
DATABASE_URL="postgresql://postgres:clave%40segura@localhost:5432/aela_db"
```

## 3. Backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run db:migrate:safe
npm run catastro:import
npm run dev
```

API por defecto:
- `http://localhost:5600`

## 4. Frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Aplicacion por defecto:
- `http://localhost:5174`

## 5. Configuracion inicial

Al entrar por primera vez:

1. Abrir `/login`
2. Completar el bootstrap inicial
3. Registrar:
   - empresa
   - primer administrador
4. El sistema genera automaticamente:
   - configuracion SRI base
   - configuracion del sistema base
   - plan de cuentas base

## 6. Despues del bootstrap

Se recomienda revisar:

1. `Configuracion SRI`
2. `Configuracion del Sistema`
3. `Usuarios`
4. `Contabilidad`

En `Configuracion del Sistema` ya puedes definir:

- tipo de sistema: `full` o `lite`
- modo de operacion: `monoempresa` o `multiempresa`
- modulos activos: caja, POS, inventario, contabilidad, retenciones, liquidaciones y ATS

En `Contabilidad` ya existe una base inicial de plan de cuentas por empresa y el contador puede:

- editar cuentas existentes
- crear nuevas cuentas
- desactivar cuentas
- reinstalar o sincronizar la base AELA sin tener que cargar datos manualmente en la base

## 7. Comandos utiles

### Backend

```powershell
npm run dev
npm run db:backup
npm run db:migrate:dev:safe -- --name nombre_del_cambio
npm run db:migrate:safe
npm run catastro:import
npm run catastro:replace
npm run prisma:generate
npm run prisma:studio
```

Notas:
- `db:migrate:safe` hace backup con `pg_dump`, aplica `prisma migrate deploy` y restaura el backup si la migracion falla.
- `db:migrate:dev:safe` se usa cuando estas creando una migracion local nueva.
- `catastro:import` lee por defecto `docs/datosRuc`.
- `catastro:replace` hace backup y recarga completamente la tabla `contribuyentes_sri`.

### Frontend

```powershell
npm run dev
npm run build
```

## 8. Problemas comunes

### Prisma no encuentra `DATABASE_URL`

Verificar que exista `backend/.env` y no solo `.env.example`.

### Puerto `5600` ocupado

Hay otra instancia del backend corriendo. Cerrar el proceso o reiniciar `nodemon`.

### Vite no resuelve dependencias

Instalar dependencias faltantes dentro de `frontend`.

### No aparecen tablas

Confirmar:
- que se ejecuto `npm run db:migrate:safe`
- que el cliente esta mirando la base correcta
- que se refresco el esquema `public`
