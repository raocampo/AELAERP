# Pendientes AELA ERP — Sesión 2026-05-02

## ✅ Completado hoy

### Seguridad — historial git limpiado
- `git filter-branch` eliminó `usuario: raocampo` / `clave: Ra078965412` de todos los commits
- `git push -f origin main` — historial limpio en GitHub

### Secuenciales iniciales por punto de emisión
- Nueva tabla `puntos_emision` en `aela_db` (migración `20260502201011_add_puntos_emision`)
- Campos: `secInicialFactura`, `secInicialNotaCredito`, `secInicialNotaDebito`,
  `secInicialRetencion`, `secInicialLiquidacion`, `secInicialGuiaRemision`, `secInicialNotaVenta`
- Lógica: `max(últimoEnBD, secuencialInicial) + 1`
- Rutas actualizadas: facturas, notas crédito, notas débito, retenciones,
  liquidaciones, guías de remisión, notas de venta
- Nueva ruta `GET/PUT /api/puntos-emision` + `GET /api/puntos-emision/activo`
- Modal funcional en Configuración SRI → "🔢 Configurar secuenciales iniciales"
- Nuevo util `backend/utils/secuenciales.js`

### Service Worker
- Versión bumpeada a `aela-app-v3` / `aela-api-v2` (invalida caché viejo)
- SW nuevo se activa inmediatamente con `SKIP_WAITING`

### Railway — endpoint de health
- Agregado `GET /api/health` en `backend/app.js`
- Pusheado al repo (commit `51171da`)

---

## ⏳ Pendientes — Continuar desde casa

### 1. Railway — Configurar variables de entorno (PRIORITARIO)

#### Situación actual
- PostgreSQL en Railway: **Online** ✅
- AELAERP service: falla en **Healthcheck** (le faltaba `/api/health` — ya corregido)
- Las variables de entorno del backend **aún no están configuradas**

#### Pasos a seguir
1. En Railway, hacer clic en el servicio **AELAERP** (no en Postgres)
2. Ir a pestaña **Variables**
3. Hacer clic en **Raw Editor**
4. Pegar el siguiente bloque completo y guardar:

```
JWT_SECRET=j4LNTaT3W6c3fKf4EaEqWY3q0P3n8t9baRdH2GMBWoIzOytuowsnXMPiHZTlmNWF
DB_ENCRYPT_KEY=d7c50fc9fbab007145d9d2c4986ef0e9b61f21f1fd13c6f1c8127d48a71dbcb0
DATABASE_MASTER_URL=${{Postgres.DATABASE_URL}}
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
AELA_EDITION=full
MODO_EMPRESA=mono
NODE_ENV=production
FRONTEND_URL=https://placeholder.vercel.app
```

> ⚠ `${{Postgres.DATABASE_URL}}` es la sintaxis exacta de Railway — copiar tal cual.
> El `DATABASE_URL` principal lo inyecta Railway automáticamente desde el plugin Postgres.

5. Hacer clic en **Update Variables** → Railway redesplegará

#### Cómo vincular Postgres al backend (si DATABASE_URL no aparece en AELAERP)
- Ir al servicio Postgres → Variables
- Hacer clic en los **tres puntos (⋮)** a la derecha de `DATABASE_URL`
- Seleccionar **"Share Variable"** o ir directamente a AELAERP → Variables → New Variable
  y escribir: `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`

---

### 2. Vercel — Desplegar frontend

#### Pasos
1. Ir a [vercel.com](https://vercel.com) → **New Project**
2. Importar repositorio `raocampo/AELAERP` desde GitHub
3. Vercel detecta `vercel.json` en la raíz automáticamente (build: `frontend/dist`)
4. En **Environment Variables** agregar:

```
VITE_API_URL=https://<URL-RAILWAY>.railway.app/api
VITE_EDITION=full
VITE_MODO_EMPRESA=mono
```

> La URL de Railway la encuentras en: AELAERP service → Settings → Domains

5. Hacer clic en **Deploy**

---

### 3. Actualizar FRONTEND_URL en Railway

Una vez que Vercel dé la URL del frontend:
- Ir a Railway → AELAERP → Variables
- Cambiar `FRONTEND_URL=https://placeholder.vercel.app` por la URL real de Vercel
- Railway redesplegará automáticamente (CORS quedará correcto)

---

### 4. Verificar que el backend funciona en producción

Abrir en el navegador:
```
https://<URL-RAILWAY>.railway.app/api/health
```
Debe responder:
```json
{"ok": true, "status": "healthy", "ts": 1234567890}
```

Si responde → el backend está listo.

---

### 5. Crear el primer usuario administrador en producción

Una vez el backend esté online, conectarse a la BD de Railway y ejecutar:

```sql
-- Conectar via: Railway → Postgres → Data → Query
INSERT INTO empresas (ruc, "razonSocial", plan) 
VALUES ('1103568240001', 'Corp Simtelec', 'pro')
ON CONFLICT DO NOTHING;
```

O mejor: usar el script de provisioning existente desde la máquina local apuntando a la BD de Railway.

---

## ⚠️ Notas técnicas importantes

| Tema | Detalle |
|------|---------|
| `railway.toml` | Está en la raíz del repo, apunta a `backend/` |
| Build command | `cd backend && npm install && npx prisma generate && npx prisma generate --schema=./prisma/schema-master.prisma` |
| Start command | `cd backend && npx prisma migrate deploy && node server.js` |
| Health endpoint | `GET /api/health` → `{"ok": true}` |
| Puerto | Railway inyecta `PORT` automáticamente; el backend ya lo usa (`process.env.PORT \|\| 5600`) |
| `DATABASE_MASTER_URL` | En mono empresa = mismo valor que `DATABASE_URL` |
| JWT_SECRET | Debe ser el mismo que en local para no invalidar sesiones |
| DB_ENCRYPT_KEY | Debe ser el mismo que en local para descifrar `dbPass` de tenants existentes |

---

## Estado del repo en GitHub

Últimos commits:
```
51171da fix: agregar endpoint /api/health para Railway healthcheck
1527e6a fix: modal secuenciales y actualización automática del Service Worker
be26546 feat: secuenciales iniciales por punto de emisión
31341a2 chore: limpiar credenciales de frontend/.env.example
```
