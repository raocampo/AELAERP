# AELA ERP — Estado y pendientes al 2026-05-04

---

## ✅ Completado en esta sesión (2026-05-04)

| # | Tarea | Commit |
|---|-------|--------|
| 1 | Fix Railway: `nodejs_20` faltante en nixpacks causaba "npm: command not found" | `e31b723` |
| 2 | `backend/start.sh` — script arranque con logs diagnóstico y `prisma db push` | `dcf9c63` |
| 3 | Fix `railway.toml` startCommand → `sh start.sh` | `dcf9c63` |
| 4 | Importar clientes desde Excel — backend + plantilla + modal frontend | `8f6a8dd` |
| 5 | Importar proveedores desde Excel — backend + plantilla + modal frontend | `8f6a8dd` |
| 6 | Fix descarga plantilla con token JWT (api.get blob en vez de window.open) | `d2801b6` |
| 7 | Modal importar Excel — estilos correctos con clases modal-form existentes | `d2801b6` |

---

## 🔴 Inmediatos — Para que producción funcione

### PASO 1 — Verificar que Railway redespliegó con el fix

Abrir en el navegador:
```
https://aelaerp-production.up.railway.app/api/health
```
Debe responder:
```json
{ "ok": true, "status": "healthy" }
```

Si no responde: Railway → servicio AELAERP → Deployments → ver logs del último deploy.
Buscar `"AELA ERP — Iniciando backend..."` para confirmar que el `start.sh` corrió.

---

### PASO 2 — Primer usuario en producción (si BD aún vacía)

Una vez que `/api/health` responda OK:
```
https://aelaerp.vercel.app/bootstrap
```
Completar: RUC empresa, razón social, usuario admin, contraseña.

---

### PASO 3 — Cargar catastro SRI en producción

Sin esto la búsqueda de RUC/cédula en producción depende de la API online del SRI
(que puede estar caída o lenta). El catastro local es instantáneo y offline.

**Obtener DATABASE_PUBLIC_URL:**
Railway → servicio **Postgres** → pestaña **Connect** → "Public Network" → copiar URL.

**Ejecutar desde PowerShell local** (tarda 30-60 min):
```powershell
$env:DATABASE_URL = "postgresql://postgres:PASSWORD@roundhouse.proxy.rlwy.net:PORT/railway"
cd "d:\Users\USUARIO\Documents\MEGA\TRABAJOSWEBYSISTEMAS\PROYECTOSWEB\SCFI\backend"
node scripts/importarCatastroSRI.js ..\docs\datosRuc
```

El script muestra progreso provincia por provincia. Si se interrumpe, se puede volver a correr —
usa `skipDuplicates: true` y no duplica registros.

Verificar cuántos quedaron importados:
```powershell
node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); p.contribuyentes_sri.count().then(n=>console.log(n+' registros')).finally(()=>p['\$disconnect']()); "
```

---

## 🟡 Media prioridad

### Variables de entorno — verificar en Vercel y Railway

**Vercel** → proyecto aelaerp → Settings → Environment Variables:
```
VITE_API_URL      = https://aelaerp-production.up.railway.app/api
VITE_EDITION      = full
VITE_MODO_EMPRESA = monoempresa
```
Si se cambian → Deployments → Redeploy (Vite embebe las vars en build time).

**Railway** → servicio AELAERP → Variables:
```
FRONTEND_URL = https://aelaerp.vercel.app   ← CORS
NODE_ENV     = production
```

---

### SMTP — configurar envío de emails

Opciones recomendadas:
- **Resend** (resend.com) — plan gratuito 3.000 emails/mes, fácil de configurar
- **Gmail SMTP** — requiere contraseña de aplicación

Variables a agregar en Railway:
```
SMTP_HOST     = smtp.resend.com
SMTP_PORT     = 587
SMTP_USER     = resend
SMTP_PASS     = re_xxxxxxxxxxxxx
SMTP_FROM     = noreply@aela.ec
```

---

## 🟠 Pendientes técnicos futuros

### Funcionalidades

| # | Feature | Detalle |
|---|---------|---------|
| 1 | **Macro Empresa** | Admin gestiona subsidiarias desde una sola sesión. Arquitectura completa documentada en `pendientes-2026-05-03.md` |
| 2 | **Multiempresa SaaS nativo** | 3 cambios de código documentados en `pendientes-2026-05-03.md` |
| 3 | **Segunda empresa de prueba** | Nuevo stack Railway+Vercel aislado, documentado en `pendientes-2026-05-03.md` |
| 4 | **Dominio personalizado** | `app.aela.ec` → Vercel, `api.aela.ec` → Railway (Cloudflare) |
| 5 | **Manual de usuario** | POS, Caja, Facturación, Inventario, Clientes, Contabilidad, Bancos, Declaraciones |

### BD local

| # | Tarea | Detalle |
|---|-------|---------|
| 6 | **Renombrar BDs locales** | `scfi_dev` → `aela_dev`, `scfi_master` → `aela_master` |

---

## 📦 Nuevos archivos/endpoints esta sesión

### Backend

| Archivo/Endpoint | Descripción |
|-----------------|-------------|
| `backend/start.sh` | Script arranque Railway con diagnóstico |
| `backend/utils/importarExcel.js` | Parseo xlsx + generación plantillas |
| `GET /api/clientes/plantilla-excel` | Descarga plantilla clientes |
| `POST /api/clientes/importar-excel` | Importar clientes desde xlsx |
| `GET /api/proveedores/plantilla-excel` | Descarga plantilla proveedores |
| `POST /api/proveedores/importar-excel` | Importar proveedores desde xlsx |

### Lógica de importación Excel

- **Encabezados flexibles** — `ruc`, `cedula`, `id` → se mapean a `identificacion`. Sin distinción mayúsculas/tildes.
- **tipoIdentificacion automático** — 13 dígitos = RUC (04), 10 dígitos = Cédula (05), otro = Exterior (08).
- **skipDuplicates** — si la identificación ya existe en la BD, se omite sin error.
- **Respuesta** — `{ resumen: {creados, omitidos, errores}, resultados: [{fila, identificacion, razonSocial, estado, motivo}] }`

---

## 🏗 Arquitectura de deploy actual

```
[Usuario]
    │
    ▼
[Vercel — Frontend React/Vite]
 aelaerp.vercel.app
 Env: VITE_API_URL, VITE_EDITION=full, VITE_MODO_EMPRESA=monoempresa
    │
    ▼
[Railway — Backend Node/Express]
 aelaerp-production.up.railway.app
 Start: cd backend && sh start.sh
 Env: DATABASE_URL, JWT_SECRET, DB_ENCRYPT_KEY, FRONTEND_URL,
      AELA_EDITION, MODO_EMPRESA, NODE_ENV
    │
    ▼
[Railway — PostgreSQL]
 tablas: empresas, usuarios, clientes, proveedores, facturas,
         contribuyentes_sri (catastro SRI — pendiente cargar en prod),
         puntos_emision, ...
```
