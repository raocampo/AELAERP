# Manual Técnico — AELA ERP
**Versión 1.0 · CorpSimtelec · Ecuador**
**Actualizado: 2026-06-02**

---

## Tabla de Contenidos

1. [Arquitectura general](#1-arquitectura-general)
2. [Infraestructura en producción](#2-infraestructura-en-producción)
3. [Variables de entorno](#3-variables-de-entorno)
4. [Base de datos](#4-base-de-datos)
5. [Sistema multi-tenant SaaS](#5-sistema-multi-tenant-saas)
6. [Marca blanca y dominios personalizados](#6-marca-blanca-y-dominios-personalizados)
7. [Autenticación y autorización](#7-autenticación-y-autorización)
8. [Facturación electrónica SRI](#8-facturación-electrónica-sri)
9. [Panel Super Admin](#9-panel-super-admin)
10. [Despliegue y migraciones](#10-despliegue-y-migraciones)
11. [App móvil](#11-app-móvil)
12. [Archivos clave del proyecto](#12-archivos-clave-del-proyecto)
13. [Solución de problemas técnicos](#13-solución-de-problemas-técnicos)

---

## 1. Arquitectura general

```
┌─────────────────────────────────────────────────────────────────┐
│                     AELA ERP — Arquitectura                     │
├───────────────┬──────────────────────────────────────────────────┤
│  FRONTEND     │  React 18 + Vite · Vercel                       │
│               │  aela.corpsimtelec.com                           │
│               │  PWA (Service Worker, modo offline)              │
├───────────────┼──────────────────────────────────────────────────┤
│  BACKEND      │  Node.js 20 + Express · Railway                  │
│               │  aelaerp-production.up.railway.app               │
│               │  Puerto 8080                                     │
├───────────────┼──────────────────────────────────────────────────┤
│  BASE DATOS   │  PostgreSQL 15 · Railway                         │
│               │  BD principal: railway (corpsimtelec)            │
│               │  BD tenants: aela_<slug> (una por cliente SaaS)  │
│               │  Schema catálogo: aela_master                    │
├───────────────┼──────────────────────────────────────────────────┤
│  APP MÓVIL    │  Expo SDK 54 + React Native 0.79                 │
│               │  TypeScript + Expo Router v5                     │
│               │  mobile/ (en desarrollo)                        │
└───────────────┴──────────────────────────────────────────────────┘
```

### Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18, Vite, React Router v6, Axios, react-hot-toast |
| Backend | Node.js 20, Express 4, Prisma ORM 5.22 |
| Base de datos | PostgreSQL 15 |
| Autenticación | JWT (jsonwebtoken), bcryptjs |
| Email | Resend API (primario) + Nodemailer Gmail (backup) |
| PDF | (generación server-side con xmlbuilder2 + firma SRI) |
| Firma electrónica | node-forge (certificados .p12) |
| App móvil | Expo SDK 54, React Native 0.79, TypeScript |

---

## 2. Infraestructura en producción

### URLs

| Servicio | URL |
|----------|-----|
| Frontend | https://aela.corpsimtelec.com |
| Backend API | https://aelaerp-production.up.railway.app |
| Panel Admin | https://aela.corpsimtelec.com/super-admin |
| Repositorio | https://github.com/raocampo/AELAERP |

### Railway (Backend)

- **Servicio:** AELAERP (Node.js)
- **PostgreSQL:** volumen persistente para certificados `.p12`
- **Start command:** `bash start.sh` (no `npm start` directo)
- **Health check:** `GET /api/health`

### Vercel (Frontend)

- **Proyecto:** aelaerp
- **Build:** `cd frontend && npm run build`
- **Output:** `frontend/dist`
- **Redirects:** `vercel.json` — dominios Vercel redirigen a `aela.corpsimtelec.com`

### Script de arranque Railway (`backend/start.sh`)

```bash
1. node scripts/applySchemaFixes.js    # ALTER TABLE columnas faltantes (idempotente)
2. node scripts/baselineMigrations.js  # crea _prisma_migrations si no existe (P3005)
3. npx prisma migrate deploy           # aplica nuevas migraciones
4. node scripts/migrateMaster.js       # crea/actualiza schema aela_master
5. node scripts/fixTenantCredentials.js # corrige tenants con dbHost=localhost
6. node server.js                      # inicia el servidor Express
```

---

## 3. Variables de entorno

### Backend (Railway)

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `DATABASE_URL` | PostgreSQL BD principal | ✅ |
| `DATABASE_MASTER_URL` | Misma URL + `?schema=aela_master` | ✅ |
| `DATABASE_ADMIN_URL` | Para provisionar nuevas BDs de tenants | ✅ |
| `JWT_SECRET` | Clave secreta JWT (≥48 bytes random) | ✅ |
| `JWT_EXPIRES_IN` | Tiempo de expiración (ej: `8h`) | Opcional |
| `NODE_ENV` | `production` | ✅ |
| `FRONTEND_URL` | `https://aela.corpsimtelec.com` | ✅ |
| `CORS_EXTRA_ORIGINS` | Dominios adicionales permitidos | Opcional |
| `MODO_EMPRESA` | `multi` para SaaS, vacío para monoinstancia | ✅ SaaS |
| `AELA_EDITION` | `full` o `lite` (edición por defecto) | Opcional |
| `AELA_DOMINIO_BASE` | `corpsimtelec.com` (para subdominios) | Opcional |
| `DB_ENCRYPT_KEY` | 64 hex chars (32 bytes AES-256-GCM) para cifrar dbPass | ✅ SaaS |
| `SUPER_ADMIN_KEY` | Clave del Panel Super Admin | ✅ |
| `SMTP_HOST` | `smtp.resend.com` | ✅ |
| `SMTP_PORT` | `587` | ✅ |
| `SMTP_USER` | `resend` | ✅ |
| `SMTP_PASS` | API Key de Resend (re_...) | ✅ |
| `SMTP_FROM` | `AELA ERP <info@corpsimtelec.com>` | ✅ |
| `SMTP_SOPORTE` | Email de soporte | ✅ |
| `SMTP_HOST_BACKUP` | `smtp.gmail.com` | Opcional |
| `SMTP_PORT_BACKUP` | `587` | Opcional |
| `SMTP_USER_BACKUP` | `corpsimtelec@gmail.com` | Opcional |
| `SMTP_PASS_BACKUP` | App Password de Gmail | Opcional |
| `SMTP_FROM_BACKUP` | `AELA ERP <corpsimtelec@gmail.com>` | Opcional |

### Frontend (Vercel)

| Variable | Descripción |
|----------|-------------|
| `VITE_API_URL` | `https://aelaerp-production.up.railway.app/api` |

---

## 4. Base de datos

### Bases de datos en Railway PostgreSQL

```
PostgreSQL server (postgres.railway.internal:5432)
├── railway              ← BD principal (corpsimtelec + schema aela_master)
│   ├── schema public    ← datos de corpsimtelec: empresas, facturas, etc.
│   └── schema aela_master ← catálogo de tenants SaaS
│       ├── tenants      ← registro de clientes
│       └── suscripciones ← historial de pagos
├── aela_mprq            ← BD del tenant mprq (Miryan Patricia Ramon)
└── aela_<slug>          ← una BD por cada cliente SaaS registrado
```

### Schema principal (público)

Modelos principales en `backend/prisma/schema.prisma`:

| Modelo | Tabla | Descripción |
|--------|-------|-------------|
| empresas | empresas | Empresas (multiempresa) |
| usuarios | usuarios | Usuarios del sistema |
| configuracion_sri | configuracion_sri | Datos SRI, certificado |
| configuracion_sistema | configuracion_sistema | Módulos, POS, impresora |
| facturas | facturas | Facturas electrónicas |
| notas_venta | notas_venta | Notas de venta |
| facturas_compra | facturas_compra | Compras registradas |
| productos_servicios | productos_servicios | Catálogo de productos |
| clientes | clientes | Catálogo de clientes |
| proveedores | proveedores | Maestro de proveedores |
| cajas_diarias | cajas_diarias | Registros de caja |
| retenciones | retenciones | Retenciones emitidas |
| nominas | nominas | Nóminas de talento humano |
| contribuyentes_sri | contribuyentes_sri | Catastro 6.7M registros |

### Migraciones

```bash
# Crear nueva migración (desarrollo)
npm run db:migrate:dev:safe -- --name nombre_del_cambio

# Aplicar migraciones en producción (lo hace Railway automáticamente)
npm run db:migrate:safe

# El script start.sh aplica mediante:
npx prisma migrate deploy
```

**Nota importante:** La BD de Railway fue inicializada con `prisma db push`. El script `baselineMigrations.js` resuelve el error P3005 creando `_prisma_migrations` automáticamente al arrancar.

---

## 5. Sistema multi-tenant SaaS

### Arquitectura multi-tenant

Cada cliente SaaS tiene su propia base de datos PostgreSQL aislada. La BD master (`aela_master`) almacena el catálogo de tenants con sus credenciales de conexión cifradas.

### Flujo de un request multi-tenant

```
1. Cliente abre: aela.corpsimtelec.com/mprq
2. AccesoTenant.jsx → guarda slug en localStorage → redirige a /login?slug=mprq
3. Login.jsx → lee ?slug de URL → guarda en localStorage
4. Llamada API incluye header: X-Tenant-Slug: mprq
5. Backend: resolverTenant middleware
   → lee X-Tenant-Slug: mprq
   → busca "mprq" en aela_master.tenants
   → descifra dbPass con AES-256-GCM
   → crea/reutiliza PrismaClient para aela_mprq
   → inyecta req.prisma = aela_mprq_client
6. runWithClient(req.prisma, next) → activa AsyncLocalStorage
7. Cualquier require('../config/prisma') en cualquier ruta
   → Proxy lee AsyncLocalStorage → devuelve aela_mprq client ✓
8. Todas las queries van a aela_mprq (datos aislados del cliente)
```

### Registro de nuevo tenant

```
POST /api/registro
  → crea registro en aela_master.tenants (estado: provisioning)
  → background: provisionarTenant()
    → CREATE DATABASE aela_<slug>
    → prisma db push contra la nueva BD
    → estado: activo
GET /api/registro/estado/:email → polling del frontend
```

### Tabla tenants (aela_master)

| Campo | Descripción |
|-------|-------------|
| `slug` | Identificador único (ej: mprq) |
| `plan` | `lite` / `medium` / `pro` |
| `estado` | `provisioning` / `activo` / `suspendido` / `vencido` / `error` |
| `dbName` | Nombre de la BD (ej: aela_mprq) |
| `dbHost` | Host PostgreSQL |
| `dbPass` | Contraseña cifrada AES-256-GCM |
| `brandConfig` | JSON: `{ dominio, logo, colores, ... }` |
| `esTrial` | Si está en período de prueba |
| `fechaVencimiento` | Fecha de vencimiento del plan |

### Pool de conexiones

`backend/config/prismaTenant.js` mantiene un pool en memoria:
```javascript
const _pool = new Map(); // slug → PrismaClient
```
Una instancia por tenant, reutilizada entre requests. TTL del cache de tenant: 5 minutos.

### Aislamiento via AsyncLocalStorage (prisma.js)

`backend/config/prisma.js` exporta un Proxy que:
1. Delega al cliente del tenant activo (almacenado en AsyncLocalStorage)
2. O al cliente global si no hay tenant activo
3. Resultado: todas las rutas existentes funcionan sin cambios

---

## 6. Marca blanca y dominios personalizados

### ¿Qué es marca blanca?

Un cliente con dominio propio accede a su sistema via `erp.miempresa.com` en vez de `aela.corpsimtelec.com/slug`. El sistema muestra el branding de su empresa.

### Cómo activarlo

**1. Configurar en Panel Super Admin:**
```
aela.corpsimtelec.com/super-admin
→ Editar tenant → Dominio personalizado: erp.miempresa.com
```
Se guarda en `tenants.brandConfig.dominio`.

**2. DNS del cliente:**
```
Tipo:  CNAME
Host:  erp (o subdominio que elijan)
Valor: cname.vercel-dns.com
TTL:   300
```

**3. Vercel:**
```
Proyecto aelaerp → Settings → Domains → + Add → erp.miempresa.com
Vercel emite SSL automáticamente
```

**4. Cómo funciona técnicamente:**
```
Usuario abre erp.miempresa.com
  → App.jsx detecta hostname ≠ aela.corpsimtelec.com
  → GET /api/auth/identificar-dominio?host=erp.miempresa.com
  → Backend busca en aela_master.tenants WHERE brandConfig.dominio = host
  → Retorna { slug: "miempresa", plan: "pro" }
  → localStorage.setItem('aela_tenant_slug', 'miempresa')
  → Todos los requests incluyen X-Tenant-Slug: miempresa ✓
```

---

## 7. Autenticación y autorización

### JWT

Los tokens JWT incluyen:
```json
{
  "id": 1,
  "email": "usuario@empresa.com",
  "username": "admin",
  "rol": "admin",
  "empresaId": 1,
  "tenantSlug": "mprq"
}
```

**Validación TENANT_MISMATCH:** `proteger` middleware verifica que `decoded.tenantSlug === req.tenant?.slug`. Un token de un tenant no puede usarse en otro.

### Roles

| Rol | Permisos |
|-----|---------|
| `admin` | Todo el sistema |
| `supervisor` | Ventas, compras, inventario, caja, RRHH (sin config) |
| `contador` | Contabilidad, ATS, retenciones, liquidaciones, nómina |
| `facturador` | Facturas, notas de venta, clientes |
| `operador` | Solo POS y notas de venta |

### Timeout de sesión

- Advertencia a los 25 minutos de inactividad
- Logout automático a los 30 minutos
- Implementado en `AuthContext.jsx` con event listeners de actividad

---

## 8. Facturación electrónica SRI

### Flujo de emisión

```
1. Usuario completa el formulario de factura
2. POST /api/facturas → genera XML según especificación SRI
3. Firma digital con certificado .p12 (node-forge)
4. POST /api/facturas/:id/enviar
   → POST al web service SRI (recepción)
   → Polling hasta 5 reintentos × 4s (autorización)
5. SRI retorna número de autorización
6. Factura queda en estado AUTORIZADA
7. Email automático al cliente con PDF adjunto (Resend)
```

### Ambientes SRI

| Ambiente | URL |
|----------|-----|
| Pruebas | `https://celcer.sri.gob.ec/...` |
| Producción | `https://cel.sri.gob.ec/...` |

Se configura en **Configuración SRI** por empresa. En producción: facturas tienen validez legal.

### Documentos soportados

- Facturas (01)
- Notas de Crédito (04)
- Notas de Débito (05)
- Notas de Venta (consumidor final)
- Liquidaciones de Compra (03)
- Retenciones (07)
- Guías de Remisión (06)

### Certificados .p12

- Se cargan en **Configuración SRI → Certificado**
- Se guardan en Railway Volume `/app/uploads/certificados/` (persistente entre deploys)
- Contraseña almacenada cifrada en la BD

---

## 9. Panel Super Admin

**URL:** `https://aela.corpsimtelec.com/super-admin`

**Autenticación:** clave `SUPER_ADMIN_KEY` (variable de entorno Railway)

**Endpoints backend** (`/api/super-admin/*`, protegidos por Bearer SUPER_ADMIN_KEY):

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/verificar` | Verifica la clave (login) |
| GET | `/stats` | Estadísticas globales |
| GET | `/tenants` | Lista todos los tenants |
| GET | `/tenants/:id` | Detalle de un tenant |
| PUT | `/tenants/:id` | Actualizar plan, estado, dominio, etc. |
| POST | `/tenants/:id/suscripciones` | Registrar pago/suscripción manual |

**Campos actualizables vía PUT:**
`plan`, `estado`, `fechaVencimiento`, `fechaActivacion`, `nombreContacto`, `emailContacto`, `telefonoContacto`, `esTrial`, `trialExpiresAt`, `autoRenovar`, `periodoFacturacion`, `dominioPersonalizado`

---

## 10. Despliegue y migraciones

### Flujo de deploy

```
git push origin main
  → Railway: redeploy automático del backend
  → Vercel: redeploy automático del frontend
```

### Crear nueva migración (desarrollo local)

```bash
cd backend
npm run db:migrate:dev:safe -- --name nombre_cambio
# Hace backup, crea migración, aplica, genera client
```

### Agregar columnas en producción

1. Agregar campo en `schema.prisma`
2. Crear migración: `npm run db:migrate:dev:safe -- --name nombre`
3. El archivo SQL generado en `prisma/migrations/` se aplica automáticamente en el próximo deploy
4. `applySchemaFixes.js` también puede usarse para cambios urgentes sin migración

### Actualizar BD master (aela_master)

Las tablas de `aela_master` se gestionan con `scripts/migrateMaster.js` (usa SQL directo, no Prisma migrations).

---

## 11. App móvil

**Ubicación:** `mobile/`
**Stack:** Expo SDK 54, React Native 0.79, TypeScript, Expo Router v5

### Cómo ejecutar

```bash
cd mobile
npm install
node scripts/generate-assets.js   # solo primera vez
npx expo start                     # escanear QR con Expo Go
```

### Módulos implementados

| Módulo | Estado |
|--------|--------|
| Auth + selector empresa | ✅ |
| POS: carrito, SRI lookup, checkout | ✅ |
| Inventario: stock, movimientos | ✅ |
| Facturación: lista + nueva | ✅ |
| Config impresora térmica WiFi | ✅ |

### Impresora térmica ESC/POS

- Configurar IP fija en el router para la impresora
- App móvil: tab Configuración → IP + Puerto (default 9100)
- Backend: `routes/impresora.js` + `utils/impresoraEscPos.js`
- `configuracion_sistema`: campos `impresoraIp`, `impresoraPuerto`, `impresoraAncho`, etc.

---

## 12. Archivos clave del proyecto

### Backend

| Archivo | Descripción |
|---------|-------------|
| `app.js` | Configuración Express, middlewares, rutas |
| `server.js` | Punto de entrada, inicia Express |
| `start.sh` | Script de arranque Railway |
| `config/prisma.js` | Proxy + AsyncLocalStorage (context-aware multi-tenant) |
| `config/prismaMaster.js` | Cliente Prisma para aela_master |
| `config/prismaTenant.js` | Pool de clientes Prisma por tenant |
| `middleware/tenant.js` | Resuelve tenant por header/subdominio/dominio |
| `middleware/auth.js` | JWT, roles, TENANT_MISMATCH |
| `middleware/edition.js` | Guards por plan (soloMediumOPro, soloPro) |
| `routes/auth.js` | Login, bootstrap, branding, identificar-dominio |
| `routes/facturas.js` | Facturas electrónicas + SRI |
| `routes/empresas.js` | CRUD empresas |
| `routes/superAdmin.js` | Panel Super Admin |
| `routes/registro.js` | Registro de nuevos tenants SaaS |
| `utils/cifrado.js` | AES-256-GCM para dbPass de tenants |
| `utils/email.js` | SMTP dual Resend + Gmail |
| `utils/colaSRI.js` | Cola de reintento para comprobantes SRI |
| `scripts/applySchemaFixes.js` | ALTER TABLE directo al arrancar |
| `scripts/baselineMigrations.js` | Baseline _prisma_migrations (P3005) |
| `scripts/provisionarTenant.js` | Crea BD + schema para nuevo tenant |

### Frontend

| Archivo | Descripción |
|---------|-------------|
| `src/App.jsx` | Rutas, detección dominio personalizado |
| `src/services/api.js` | Axios + interceptor X-Tenant-Slug + token |
| `src/context/AuthContext.jsx` | Estado de sesión, persistencia, timeout |
| `src/components/Auth/Login.jsx` | Login + bootstrap + branding |
| `src/components/Tenant/AccesoTenant.jsx` | Ruta /:slug → guarda slug y redirige |
| `src/components/SuperAdmin/PanelSuperAdmin.jsx` | Panel admin SaaS |
| `src/components/Layout/Layout.jsx` | Sidebar con branding del cliente |
| `src/utils/fecha.js` | Utilidades de fecha (evita desfase UTC) |
| `src/utils/roles.js` | Permisos por rol |
| `src/utils/sistema.js` | Capacidades por plan (lite/medium/pro) |

---

## 13. Solución de problemas técnicos

### Error 500 al firmar facturas

**Causa:** Columnas faltantes en `configuracion_sistema` (impresoraIp, etc.)
**Solución:** `applySchemaFixes.js` se ejecuta al arrancar y las agrega automáticamente.

### Error P3005 en prisma migrate deploy

**Causa:** BD sin `_prisma_migrations` (inicializada con `db push`).
**Solución:** `baselineMigrations.js` detecta y crea el historial automáticamente.

### Tenant ve datos de otro tenant

**Causa:** Alguna ruta usa `prisma` global en vez de `req.prisma`.
**Solución:** El Proxy + AsyncLocalStorage en `config/prisma.js` resuelve esto para todas las rutas. Si persiste, verificar que la ruta no tenga `const prisma = require(...)` sin usar `req.prisma`.

### TENANT_MISMATCH (401)

**Causa:** El token JWT fue emitido para un tenant diferente al del request.
**Solución normal:** Hacer logout y volver a ingresar via la URL correcta del tenant.
**Solución técnica:** Verificar que `AccesoTenant` limpió la sesión y que el frontend está enviando `X-Tenant-Slug` correcto.

### Panel Admin 503 "Panel admin no configurado"

**Causa:** `SUPER_ADMIN_KEY` no cargada por el servidor.
**Solución:** Verificar la variable en Railway → hacer Redeploy manual.

### Fecha incorrecta (día anterior) en facturas

**Causa:** `DateTime` de Prisma se serializa como UTC; Ecuador es UTC-5.
**Solución:** `parseFechaLocal` en `utils/fecha.js` extrae la parte de fecha del ISO string.

### `ERR_INSUFFICIENT_RESOURCES` en consola

**Causa:** Hook de React crea nuevos objetos en cada render, disparando `useEffect` en loop.
**Solución:** Usar `useMemo`/`useCallback` para estabilizar referencias.

### Certificado .p12 perdido tras redeploy

**Causa:** Railway filesystem es efímero.
**Solución:** Los certificados se guardan en Railway Volume montado en `/app/uploads/certificados/`. Verificar que el volumen esté adjunto al servicio.
