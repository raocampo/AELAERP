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
