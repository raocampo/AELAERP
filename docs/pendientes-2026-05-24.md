# AELA ERP — Pendientes al 2026-05-24
## Para continuar mañana en la oficina

---

## ✅ Completado en esta sesión

| # | Tarea | Commit |
|---|-------|--------|
| 1 | Multi-tenant auth — `resolverTenant` aplicado globalmente en `app.js` | `4c02310` |
| 2 | `routes/auth.js` usa `req.prisma` en todas las rutas (bootstrap, login, etc.) | `4c02310` |
| 3 | `middleware/auth.js` usa `req.prisma \|\| prisma` (fallback mono/multi) | `4c02310` |
| 4 | Provisioning sin `psql` — usa `pg` Client directo (Railway no tiene psql) | `a549226` |
| 5 | Credenciales tenant: mismo servidor Railway, no localhost/random-pass | `54e2f73` |
| 6 | Schema `aela_master` aislado — `prisma migrate deploy` no lo destruye más | `7db7a10` |
| 7 | `@prisma/client-master` generado en `postinstall` de Railway | `b4951f5` |
| 8 | URL de acceso sin prefijo: `/:slug` en lugar de `/acceso/:slug` | `8a40d3c` |
| 9 | `registro.html` muestra preview `aela.corpsimtelec.com/slug` correcto | `8a40d3c` |
| 10 | Email de bienvenida usa `APP_BASE_URL/slug` (path-based) | `8a40d3c` |
| 11 | Lista completa de slugs reservados en `registro.js` | `2fed6c8` |

---

## 🔴 PRIORIDAD 1 — Validar en Railway (hacer primero)

### 1.1 — Verificar variables de entorno en Railway

Abrir Railway → proyecto AELA → Backend → Variables. Confirmar que existen:

| Variable | Valor esperado |
|----------|----------------|
| `DATABASE_MASTER_URL` | misma URL que `DATABASE_URL` (o la BD master si es separada) |
| `DATABASE_ADMIN_URL` | misma URL que `DATABASE_URL` (para crear BDs) |
| `MODO_EMPRESA` | `multi` |
| `APP_BASE_URL` | `https://aela.corpsimtelec.com` |
| `DB_ENCRYPT_KEY` | 64 chars hex (para cifrar dbPass de tenants) |
| `CORS_EXTRA_ORIGINS` | `https://aela.corpsimtelec.com` |

> Si `DATABASE_MASTER_URL` y `DATABASE_ADMIN_URL` no existen, agregar ambas
> con el mismo valor que `DATABASE_URL`. El schema `aela_master` las separa internamente.

### 1.2 — Disparar redeploy en Railway y revisar logs de arranque

Después de confirmar/agregar variables, hacer **Redeploy** y revisar que los logs digan:

```
--- Aplicando migraciones de schema tenant (prisma migrate deploy) ---
✅ Migraciones aplicadas

--- Inicializando BD master (migrateMaster.js) ---
[migrateMaster] Schema aela_master listo (N tablas)

--- Corrigiendo credenciales de tenants (fixTenantCredentials.js) ---
[fixTenants] N tenants corregidos (o "nada que corregir")

Server corriendo en puerto 5600
```

Si algún paso falla, revisar el log completo y resolver antes de continuar.

### 1.3 — Probar flujo completo de registro

1. Abrir `landing/registro.html` (o Cloudflare Pages si está desplegada)
2. Registrar una empresa de prueba con slug personalizado (ej: `empresaprueba`)
3. Verificar que el polling muestra progreso y finalmente el botón "🚀 Ir a mi sistema"
4. Abrir `https://aela.corpsimtelec.com/empresaprueba`
5. Debe redirigir a `/login` sin `?tenant=` en la URL
6. El login debe detectar el slug y mostrar pantalla de **bootstrap** (crear primer usuario)
7. Crear el usuario administrador y entrar al sistema

---

## 🔴 PRIORIDAD 2 — Empresa de prueba en estado "error"

La empresa registrada como `raslaef@gmail.com` quedó en estado `error` o `provisioning`
por los bugs de credenciales que ya están corregidos.

**Opciones (elegir una):**

**A) Eliminar y re-registrar** (más simple):
```sql
-- Conectar a la BD en Railway (psql o DBeaver)
SET search_path TO aela_master;
DELETE FROM tenants WHERE "emailContacto" = 'raslaef@gmail.com';
```
Luego registrar de nuevo desde la landing.

**B) Forzar re-provisioning** desde el backend:
```js
// Ejecutar en Railway Console o localmente apuntando a Railway:
const { provisionarTenant } = require('./utils/provisionarTenant');
// ... con los datos del tenant existente
```

**C) Revisar estado actual** primero:
```
GET https://aelaerp-production.up.railway.app/api/registro/estado/raslaef%40gmail.com
```
Si responde `estado: 'activo'` el problema ya se resolvió con el fix de credenciales.

---

## 🟡 PRIORIDAD 3 — SMTP (emails de bienvenida)

Sin esto el cliente no recibe el link de acceso por correo. El sistema funciona,
pero la experiencia es incompleta.

**Servicio recomendado: Resend.com** (plan gratuito 3.000 emails/mes)

1. Crear cuenta en [resend.com](https://resend.com)
2. Agregar dominio `corpsimtelec.com` y verificarlo (registro DNS TXT en Cloudflare)
3. Obtener API Key
4. Agregar en Railway → Variables:
   ```
   SMTP_HOST     = smtp.resend.com
   SMTP_PORT     = 587
   SMTP_USER     = resend
   SMTP_PASS     = re_XXXXXXXXXXXXXXXXXXXXXXXXX
   SMTP_FROM     = AELA ERP <info@corpsimtelec.com>
   SMTP_SOPORTE  = soporte@corpsimtelec.com
   ```
5. Hacer Redeploy
6. Registrar una empresa de prueba y verificar que llega el email

---

## 🟡 PRIORIDAD 4 — Prueba bootstrap de primera empresa

Cuando un cliente llega al login por primera vez (BD recién provisionada, sin usuarios):

- La pantalla debe mostrar el formulario de **bootstrap** (crear empresa + primer administrador)
- Actualmente el bootstrap se llama con `X-Tenant-Slug` → crea registros en la BD del tenant

**Verificar que:**
1. `GET /api/auth/bootstrap-status` con `X-Tenant-Slug: empresaprueba` responde `{ necesitaBootstrap: true }`
2. `POST /api/auth/bootstrap` crea empresa y usuario admin correctamente en la BD del tenant
3. El login posterior usa ese usuario y devuelve JWT válido

Si hay problemas, revisar `routes/auth.js` líneas ~bootstrap y los logs de Railway.

---

## 🟢 PRIORIDAD 5 — Landing page desplegada en Cloudflare Pages

La landing actual está en `/landing` pero puede no estar desplegada o tener URL desactualizada.

**Verificar:**
1. La landing está disponible en alguna URL pública
2. El botón "Registrar empresa" en `index.html` apunta a `registro.html`
3. En `registro.html` la variable `API_URL` en producción es:
   ```js
   const API_URL = 'https://aelaerp-production.up.railway.app';
   ```
   (ya está correcto, confirmar)

---

## 🟢 PRIORIDAD 6 — Limpieza y robustez del provisioning

Revisar `backend/utils/provisionarTenant.js` para:

- [ ] El tenant queda en estado `error` cuando `prisma migrate deploy` falla — confirmar que el estado se actualiza correctamente en la BD master
- [ ] Si la BD del tenant ya existe (re-registro) — verificar que el `CREATE DATABASE` no falla (ya tiene check `IF NOT EXISTS`)
- [ ] Logs de provisioning visibles en Railway para diagnóstico

---

## 🔲 Pendientes futuros (no urgentes)

- [ ] **Panel admin SaaS**: ver todos los tenants, estado, plan, último acceso, forzar re-provisioning
- [ ] **Pasarela de pagos**: PayPhone o Stripe para planes Medium/Pro
- [ ] **Catastro SRI**: descargar CSVs del SRI y cargar en Railway (ver `pendientes-2026-05-18.md`)
- [ ] **2FA** para administradores
- [ ] **Logs de auditoría** de acciones críticas
- [ ] **Tests e2e** con Playwright (registro → provisioning → login → factura)

---

## Contexto técnico para retomar rápido

### URLs del proyecto
| Servicio | URL |
|----------|-----|
| Frontend (Vercel) | https://aela.corpsimtelec.com |
| Backend (Railway) | https://aelaerp-production.up.railway.app |
| Landing (Cloudflare) | (confirmar URL) |
| Repo GitHub | https://github.com/raocampo/AELAERP |

### Archivos clave del flujo multi-tenant
```
backend/
  app.js                        ← resolverTenant aplicado globalmente
  middleware/tenant.js           ← resuelve BD por X-Tenant-Slug header
  middleware/auth.js             ← usa req.prisma || prisma
  routes/auth.js                 ← todas las rutas usan req.prisma
  routes/registro.js             ← registro público + slugs personalizados
  utils/provisionarTenant.js     ← CREATE DATABASE + prisma migrate
  scripts/migrateMaster.js       ← crea schema aela_master con pg directo
  scripts/fixTenantCredentials.js ← fix one-time de tenants con localhost
  config/prismaMaster.js         ← auto-agrega schema=aela_master a la URL
  start.sh                       ← orden: migrate deploy → migrateMaster → server

frontend/
  src/App.jsx                    ← ruta /:slug (catch-all para tenant slugs)
  src/components/Tenant/AccesoTenant.jsx ← guarda slug en localStorage
  src/components/Auth/Login.jsx  ← maneja 503 TENANT_PROVISIONING/TENANT_ERROR

landing/
  registro.html                  ← formulario con slug personalizado + polling
```

### Cómo probar localmente con Railway
```powershell
# Apuntar el backend local a la BD de Railway
$env:DATABASE_URL = "postgresql://postgres:PASSWORD@roundhouse.proxy.rlwy.net:PORT/railway"
$env:DATABASE_MASTER_URL = $env:DATABASE_URL
$env:DATABASE_ADMIN_URL = $env:DATABASE_URL
$env:MODO_EMPRESA = "multi"
$env:APP_BASE_URL = "http://localhost:5174"  # para pruebas locales
cd backend
node server.js
```
