# AELA ERP — Estado y pendientes al 2026-05-03

---

## ✅ Completado en esta sesión (2026-05-02 / 05-03)

| # | Tarea | Estado |
|---|-------|--------|
| 1 | Buzón SRI — Descarga automática (nueva pestaña + backend) | ✅ |
| 2 | Service Worker — fix "Response body is already used" | ✅ |
| 3 | Vercel — frontend desplegado correctamente | ✅ |
| 4 | Vercel — fix "cd frontend: No such file or directory" | ✅ |
| 5 | Buzón SRI — fix logout involuntario (401→422) | ✅ |
| 6 | Landing page — URL dinámica localhost/producción | ✅ |

---

## 🚀 Próximos pasos INMEDIATOS para que el sistema funcione en producción

### PASO 1 — Variables de entorno en Vercel (CRÍTICO)

El frontend ya está compilado pero **sin variables de entorno las API calls fallan**.

1. Ir a [vercel.com](https://vercel.com) → proyecto **aelaerp** → **Settings** → **Environment Variables**
2. Agregar estas 3 variables:

```
VITE_API_URL      = https://<TU-URL>.up.railway.app/api
VITE_EDITION      = full
VITE_MODO_EMPRESA = monoempresa
```

> La URL de Railway: Railway → servicio AELAERP → Settings → Domains

3. Ir a **Deployments** → clic en los tres puntos del último deploy → **Redeploy**
   (Vite embebe las variables en el bundle en tiempo de build, necesita rebuild)

---

### PASO 2 — Actualizar FRONTEND_URL en Railway

1. Railway → servicio AELAERP → **Variables**
2. Cambiar: `FRONTEND_URL=https://aelaerp.vercel.app` (URL real que da Vercel)
3. Railway redesplegará automáticamente — el CORS quedará correcto

---

### PASO 3 — Verificar backend en producción

Abrir en el navegador:
```
https://<TU-URL>.up.railway.app/api/health
```
Debe responder:
```json
{ "ok": true, "status": "healthy" }
```

---

### PASO 4 — Primer ingreso al sistema en producción

Si la BD de Railway está limpia (sin datos):
1. Abrir `https://aelaerp.vercel.app/bootstrap`
2. Completar el formulario: nombre empresa, RUC, correo admin, contraseña
3. El sistema crea la empresa y el primer usuario administrador

Si la BD ya tiene datos (migrada desde local):
- Ingresar directamente en `/login` con tus credenciales actuales

---

### PASO 5 — Landing page: actualizar URL y desplegar

**Archivo a editar:** `landing/main.js` línea 13

```js
// Cambiar 'https://aelaerp.vercel.app' por la URL real que da Vercel
const APP_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:5174'
  : 'https://aelaerp.vercel.app';  // ← URL real aquí
```

**Opciones para desplegar la landing:**

| Opción | Cómo |
|--------|------|
| **Vercel (recomendado)** | New Project → importar AELAERP → Root Directory: `landing` → Framework: Other → Deploy |
| GitHub Pages | repo → Settings → Pages → source: main, folder: /landing |
| Netlify | Drag & drop la carpeta `landing/` en netlify.com |

La landing ya tiene todo en HTML/CSS/JS estático — no necesita build.

---

## 🏢 Pruebas con otras empresas

### Modo actual: `monoempresa`
El sistema está configurado para **una sola empresa** por instalación. Ideal para:
- Una empresa que usa AELA para su propia gestión
- Demostrar el sistema a un cliente específico

### Para dar acceso a otras empresas (modo SaaS)

**Opción A — Un deploy por empresa (recomendado para clientes)**
Cada cliente tiene su propio deploy en Vercel + su propia BD en Railway:
1. Fork / nuevo proyecto Vercel apuntando al mismo repo
2. En Railway: nuevo servicio Postgres para esa empresa
3. Variables de entorno distintas por cliente: `VITE_API_URL`, `DATABASE_URL`
4. Cada empresa accede a su propia URL: `empresa1.vercel.app`, `empresa2.vercel.app`

**Opción B — Modo multiempresa (multi-tenant)**
Un solo backend, múltiples empresas con BDs separadas:
1. En Vercel: cambiar `VITE_MODO_EMPRESA=multiempresa`
2. En Railway: cambiar `MODO_EMPRESA=multi`
3. El backend crea automáticamente una BD `aela_{slug}` por empresa
4. Los tenants se crean via `/bootstrap` con un slug único: `aela-empresa1`, `aela-empresa2`
5. Cada empresa accede via subdominio o slug en la URL

> ⚠ El modo multiempresa requiere que el usuario de PostgreSQL en Railway tenga
> permisos `CREATEDB`. Verificar antes de activar.

---

## 📋 Pendientes técnicos por prioridad

### 🔴 Alta prioridad

| # | Pendiente | Detalle |
|---|-----------|---------|
| 1 | **Variables Vercel + Redeploy** | Sin esto, la app en producción no funciona |
| 2 | **FRONTEND_URL en Railway** | Sin esto, el CORS bloquea las peticiones del frontend |
| 3 | **Primer usuario en producción** | Usar `/bootstrap` o migrar BD local |

### 🟡 Media prioridad

| # | Pendiente | Detalle |
|---|-----------|---------|
| 4 | **Landing page desplegada** | Actualmente solo existe localmente |
| 5 | **URL real en landing/main.js** | Reemplazar `aelaerp.vercel.app` por URL real |
| 6 | **Dominio personalizado** | Vincular `app.aela.ec` a Vercel y `api.aela.ec` a Railway (opcional) |
| 7 | **Renombrar BDs PostgreSQL** | `scfi_dev` → `aela_dev`, `scfi_master` → `aela_master` (solo local) |

### 🟡 Media prioridad — NUEVA EMPRESA (segunda empresa de prueba)

> Documentado 2026-05-03. Hacer en la próxima sesión.

#### Crear empresa 2 con dominio y BD limpios (monoempresa independiente)

Cada empresa = su propio stack aislado: Vercel + Railway backend + Railway Postgres.

**Paso a paso:**

**1. Railway — Nuevo proyecto para empresa 2**
- railway.app → **New Project** → **Deploy from GitHub repo** → `raocampo/AELAERP`
- Root Directory: `backend`
- Agregar un servicio **PostgreSQL** nuevo dentro del mismo proyecto
- Variables de entorno del nuevo backend:
```
DATABASE_URL      = ${{Postgres.DATABASE_URL}}     ← enlazar al nuevo Postgres
JWT_SECRET        = <generar nuevo, diferente al de empresa 1>
DB_ENCRYPT_KEY    = <generar nuevo, diferente al de empresa 1>
AELA_EDITION      = full
MODO_EMPRESA      = mono
NODE_ENV          = production
FRONTEND_URL      = https://<URL-vercel-empresa2>.vercel.app
```
- Railway despliega y genera URL tipo `aelaerp-empresa2.up.railway.app`

**2. Vercel — Nuevo proyecto para empresa 2**
- vercel.com → **New Project** → importar `raocampo/AELAERP`
- Root Directory: `frontend`
- Limpiar Build & Output Settings (dejar vacío)
- Variables de entorno:
```
VITE_API_URL      = https://aelaerp-empresa2.up.railway.app/api
VITE_EDITION      = full
VITE_MODO_EMPRESA = monoempresa
```
- Deploy → Vercel da URL tipo `aelaerp-empresa2.vercel.app`

**3. Actualizar FRONTEND_URL en Railway empresa 2**
- Railway → nuevo backend → Variables → `FRONTEND_URL=https://aelaerp-empresa2.vercel.app`

**4. Primer acceso empresa 2**
- Abrir `https://aelaerp-empresa2.vercel.app/bootstrap`
- Llenar datos: RUC, razón social, correo admin, contraseña
- BD limpia, sin datos de empresa 1

**5. Dominio personalizado (opcional)**
- Vercel → proyecto empresa2 → Settings → Domains → agregar `app.empresa2.com`
- Railway → proyecto empresa2 → Settings → Domains → agregar `api.empresa2.com`

> ⚠ JWT_SECRET y DB_ENCRYPT_KEY de cada empresa DEBEN ser distintos entre sí
> para que las sesiones y datos cifrados de una empresa no sean válidos en la otra.

---

### 🟠 Prioridad media — Macro Empresa (una instalación, subsidiarias, un admin)

> Documentado 2026-05-03. Escenario DISTINTO al SaaS multi-tenant.

**Concepto:** Un único administrador gestiona múltiples empresas filiales/subsidiarias dentro
de una misma instalación (mismo Vercel, mismo Railway, misma BD principal).  
El admin puede **cambiar de empresa activa** sin cerrar sesión — como un contador que lleva
varias empresas desde un solo panel.

**Diferencia clave vs SaaS multi-tenant:**

| | SaaS multi-tenant | Macro Empresa |
|--|---|---|
| Quién lo usa | Empresas sin relación entre sí | Un admin que gestiona subsidiarias |
| BDs | Una por tenant (aislada) | Puede compartir o ser filiales de una BD raíz |
| Acceso cruzado | ❌ Imposible por diseño | ✅ El admin ve todas; usuarios solo la suya |
| Login | Cada empresa su URL / slug | Un solo login, selector de empresa en UI |
| Facturación | Cada empresa paga su plan | La macro empresa centraliza |

---

**Arquitectura propuesta (Macro Empresa):**

**1. BD — Tabla `empresas` con jerarquía**
```sql
-- Agregar campos a tabla empresas (Prisma schema):
parentEmpresaId  Int?           -- null = empresa raíz; ID = subsidiaria
esMatriz         Boolean  @default(false)
```

**2. Tabla `usuario_empresas` — acceso multi-empresa por usuario**
```sql
model UsuarioEmpresa {
  id         Int      @id @default(autoincrement())
  usuarioId  Int
  empresaId  Int
  rol        String   -- puede ser diferente por empresa
  activa     Boolean  @default(false)  -- empresa actualmente seleccionada
  usuario    Usuario  @relation(fields: [usuarioId], references: [id])
  empresa    Empresa  @relation(fields: [empresaId], references: [id])
}
```

**3. Backend — endpoint para cambiar empresa activa**
```js
// POST /auth/cambiar-empresa
// Body: { empresaId }
// Verifica que el usuario tenga acceso a esa empresa
// Devuelve nuevo JWT con empresaId actualizado
// O: actualiza campo activa en usuario_empresas y devuelve empresa activa
```

**4. JWT incluye empresaId activo**
```js
// backend/routes/auth.js — token al hacer login o al cambiar empresa:
{ id, email, username, rol, empresaId }
```

**5. Middleware — resuelve empresa desde JWT (no desde tenant/subdominio)**
```js
// Para macro empresa: req.empresaId = decoded.empresaId
// El middleware de tenant puede coexistir:
// Si hay X-Tenant-Slug → SaaS mode
// Si no → busca empresaId del JWT → macro empresa mode
```

**6. Frontend — Company Switcher en el header/sidebar**
```jsx
// Componente <EmpresaSwitcher />
// Muestra: empresa activa (nombre + RUC)
// Dropdown: lista de empresas a las que el usuario tiene acceso
// Al seleccionar: POST /auth/cambiar-empresa → actualiza token → recarga datos
```

---

**Orden de implementación sugerido:**

1. `prisma/schema.prisma` → agregar `parentEmpresaId`, `esMatriz`, tabla `UsuarioEmpresa`
2. Migración Prisma + seed de empresas subsidiarias
3. `backend/routes/auth.js` → incluir `empresaId` en JWT
4. `backend/middleware/empresaContext.js` → nuevo middleware resuelve empresa desde JWT
5. `backend/routes/auth.js` → nuevo endpoint `POST /cambiar-empresa`
6. `frontend/src/context/AuthContext.jsx` → guardar `empresaId` activo, exponer `cambiarEmpresa()`
7. `frontend/src/components/Layout/EmpresaSwitcher.jsx` → nuevo componente UI
8. Agregar `<EmpresaSwitcher />` en Sidebar o TopBar

> ⚠ Este escenario NO requiere múltiples deploys ni múltiples BDs.
> Todo corre en la misma instancia. La separación es lógica (por empresaId),
> no física (por base de datos).

---

### 🟠 Prioridad media — Multiempresa nativo (un solo deploy, varias empresas)

> Implementar en sesión futura cuando se quiera operar como SaaS.

**Qué falta implementar (3 cambios de código):**

**1. JWT incluye tenantSlug** — `backend/routes/auth.js` línea 29:
```js
// Cambiar esto:
{ id, email, username, rol }
// Por esto:
{ id, email, username, rol, tenantSlug: req.tenant?.slug || null }
```

**2. axios interceptor envía X-Tenant-Slug** — `frontend/src/services/api.js`:
```js
// En inyectarTokenEnConfig(), después de inyectar el token:
const tenantSlug = storage?.getItem('aela_tenant_slug');
if (tenantSlug) config.headers['X-Tenant-Slug'] = tenantSlug;
```

**3. Guardar tenantSlug al hacer login** — `frontend/src/context/AuthContext.jsx`:
```js
// En persistirSesion(), después de setUsuario:
if (res.data.tenantSlug) {
  localStorage.setItem('aela_tenant_slug', res.data.tenantSlug);
}
```

**Con esto:**
- Un solo Vercel, un solo Railway, múltiples empresas en BDs separadas
- Cada empresa se registra vía `/bootstrap` con su slug único
- El sistema enruta automáticamente al DB correcto por cada sesión
- En producción real: subdominio por empresa (`empresa1.aela.ec`, `empresa2.aela.ec`)
- En pruebas sin dominio: header `X-Tenant-Slug` automático desde el JWT

---

### 🟢 Baja prioridad / Futuras mejoras

| # | Pendiente | Detalle |
|---|-----------|---------|
| 8 | **Manual de usuario** | Módulos: POS, Caja, Facturación, Inventario, Clientes, Contabilidad, Bancos, Declaraciones |
| 9 | **Modal cliente incompleto en POS** | Actualmente muestra ⚠ — propuesta: abrir modal para crear cliente |
| 10 | **Teléfono en notas_venta** | Agregar campo al schema Prisma |
| 11 | **Descarga masiva SRI automática** | El SRI no tiene API pública documentada; feature lista para cuando se encuentre el endpoint correcto |
| 12 | **Plan de cuentas** | Verificar que no quede texto "SCFI" en tabla `plan_cuentas` de BD |
| 13 | **PWA — verificar manifest** | Probar instalación como app en móvil en producción |

---

## 🔗 URLs del sistema (completar con reales)

| Componente | URL |
|------------|-----|
| Frontend (Vercel) | `https://aelaerp.vercel.app` ← verificar en Vercel → Domains |
| Backend (Railway) | `https://________.up.railway.app` ← verificar en Railway → Domains |
| Landing page | pendiente de desplegar |
| API health check | `https://________.up.railway.app/api/health` |

---

## 🏗 Arquitectura en producción

```
[Usuario]
    │
    ▼
[Landing page]  ──────────────────────────────────────────────────
(HTML estático)   "Acceder" → aelaerp.vercel.app
    │
    ▼
[Vercel — Frontend React/Vite]
 aelaerp.vercel.app
 Root Dir: frontend/
 Env vars: VITE_API_URL, VITE_EDITION, VITE_MODO_EMPRESA
    │
    │ POST /api/auth/login
    │ GET  /api/productos
    │ ...
    ▼
[Railway — Backend Node/Express]
 xxxxxxxx.up.railway.app
 Env vars: DATABASE_URL, JWT_SECRET, FRONTEND_URL, AELA_EDITION
    │
    ▼
[Railway — PostgreSQL]
 Base de datos: scfi_dev (monoempresa)
                aela_{slug} (por cada tenant en modo multi)
```

---

## 📦 Estado del repositorio

Repo: `github.com/raocampo/AELAERP` — rama `main`

Últimos commits relevantes:
```
bcd6f45  fix: vercel.json raiz sin buildCommand
059b6f7  fix: mensaje de error claro cuando SRI no tiene API publica
61967e4  fix: cambiar 401->422 en sri-portal/consultar
f80651d  fix: vercel build path + SW clone race condition
785049f  feat: descarga masiva SRI + vercel.json en frontend/
```
