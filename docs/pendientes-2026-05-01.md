# Pendientes AELA ERP — Sesión 2026-05-01

## ✅ Completado hoy

### Rebrand SCFI → AELA (cierre total)
- **Service Worker** (`frontend/public/sw.js`): caches renombrados `aela-app-v2`, `aela-api-v1`, sync tag `aela-sync-queue`, mensaje `AELA_SYNC_NOW`.
- **PWA Manifest** (`frontend/public/manifest.json`): nombre "AELA ERP", short_name "AELA ERP", descripción actualizada, theme_color `#7C3AED`.
- **Landing `ant/`** (`landing/ant/index.html` + `style.css` + `main.js`): branding completo AELA, email `info@aela.ec`.
- **Variables de entorno** (`.env` + `.env.example`): `AELA_EDITION`, `AELA_DOMINIO_BASE`, `AELA_TENANT_SLUG`, `email.js` usa `AELA_DOMINIO_BASE`.
- **`package.json` raíz**: nombre `aela-erp`, lock files regenerados.
- **`backend/middleware/tenant.js`**: comentario `scfi.ec` eliminado.
- **0 referencias SCFI** en todo el código fuente (archivos `.js/.jsx/.json/.prisma/.toml`).

### Bases de datos renombradas (CRÍTICO completado)
- `scfi_db` → **`aela_db`** (6.799.463 contribuyentes SRI intactos).
- `scfi_master` → **`aela_master`** (1 tenant activo).
- `.env` y `.env.example` actualizados con nuevas URLs.
- Verificado: backend conecta correctamente a `aela_db`.

### Importación catastro SRI
- **6.799.463 contribuyentes** cargados en tabla `contribuyentes_sri` desde 25 archivos CSV provinciales.
- 108 errores menores (duplicados entre archivos), 0 pérdidas de datos.

### POS — Modal cliente con datos incompletos (#4)
- Modal `👤 Datos del cliente` se abre automáticamente al detectar campos vacíos (dirección, teléfono, email).
- Se abre también cuando el SRI requiere datos manuales (`requiereDatosManuales`).
- Botón "Editar" junto al aviso ⚠ para apertura manual posterior.
- Los datos modificados en el modal se guardan al emitir el documento.

### POS — Campo teléfono en notas de venta (#5)
- Campo `telefono VARCHAR(30)` agregado al modelo `notas_venta` en Prisma.
- Migración `20260501220516_add_telefono_notas_venta` aplicada a `aela_db`.
- Ruta `POST /notas-venta` acepta y guarda `telefono`.
- Recibo PDF de notas de venta incluye teléfono en sección Información Adicional.

### Timeout de sesión por inactividad
- 25 minutos de inactividad → toast de aviso "Tu sesión se cerrará en 5 minutos".
- 30 minutos → cierre automático con mensaje "Sesión cerrada por inactividad 🔒".
- Se resetea con cualquier interacción (mouse, teclado, clic, scroll, touch).
- Implementado en `AuthContext.jsx` con `useRef` + event listeners.

### Seguridad — dbPass cifrado (AES-256-GCM)
- Nuevo módulo `backend/utils/cifrado.js` con funciones `cifrar()` / `descifrar()`.
- Formato: `enc:<iv_hex>:<tag_hex>:<ciphertext_hex>` (compatible hacia atrás: texto plano sin prefijo sigue funcionando).
- `provisionarTenant.js`: cifra la contraseña antes de guardar en BD master.
- `prismaTenant.js`: descifra antes de construir la URL de conexión.
- Tenant existente `ferreteria-demo-sa` migrado a contraseña cifrada.
- `DB_ENCRYPT_KEY` (64 hex chars) agregada a `.env`.

### Seguridad — JWT_SECRET renovado
- `JWT_SECRET` cambiado de `scfi_jwt_secret_cambiar_en_produccion` a clave aleatoria de 48 bytes.
- Esto cierra sesión a todos los usuarios activos (deben volver a iniciar sesión).

### Manual de usuario
- `docs/manual-usuario.md` creado — cubre todos los módulos de AELA ERP.

---

## ⏳ Pendientes — Continuar próxima sesión

### 1. Railway — Actualizar variables en panel de producción
Acceder al panel de Railway y renombrar/agregar:
```
AELA_EDITION=full
AELA_DOMINIO_BASE=app.aela.ec
AELA_TENANT_SLUG=<slug-si-es-mono>
DB_ENCRYPT_KEY=<misma-clave-del-env-local>
JWT_SECRET=<mismo-valor-del-env-local>
```
> ⚠ Sin esto, el backend en producción no arranca correctamente.

### 2. SMTP — Configurar proveedor de email
Completar en `.env` (producción) y Railway:
```
SMTP_HOST=smtp.gmail.com   # o Resend, SendGrid, etc.
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@aela.ec
SMTP_PASS=<contraseña-app>
SMTP_FROM="AELA ERP <noreply@aela.ec>"
```
El email de bienvenida a nuevos tenants ya está implementado en `utils/email.js`, solo falta la config.

### 3. Pasarela de pagos (Medium/Pro)
Integrar PayPhone o Stripe para cobro de suscripciones de planes pagos.
- Ruta sugerida: `routes/pagos.js`
- Webhook para activar tenant tras pago exitoso
- Panel de facturación en el backoffice SaaS

### 4. Backoffice SaaS (CorpSimtelec)
Panel de administración para CorpSimtelec para gestionar todos los tenants:
- Listado de tenants (activo/suspendido/vencido)
- Cambiar plan, extender vencimiento, suspender
- Ver métricas por tenant (último acceso, comprobantes emitidos)
- Acceso superadmin separado del login normal

### 5. Despliegue a producción
- Backend → Railway (ya tiene `railway.toml` configurado)
- Frontend → Vercel o Railway static
- DNS → Cloudflare (`*.aela.ec` → backend, `app.aela.ec` → frontend)
- Certificados TLS → automáticos vía Cloudflare

### 6. Sección `/ayuda` en la app
Integrar el manual de usuario dentro del sistema (ruta `/ayuda`) con versión HTML del manual. Opción: enlace de descarga PDF desde la interfaz.

### 7. Verificar plan_cuentas en BD por texto "SCFI" (ya verificado: 0 registros)
Confirmado en sesión 2026-05-01: ningún registro de `plan_cuentas` contiene "SCFI". ✅

---

## ⚠️ Notas técnicas importantes

| Tema | Detalle |
|------|---------|
| BD activa | `aela_db` y `aela_master` en PostgreSQL local |
| Catastro SRI | 6.799.463 contribuyentes en `contribuyentes_sri` |
| dbPass | Todos los tenants nuevos y existentes usan AES-256-GCM |
| JWT | Nueva clave — todos los usuarios deben re-iniciar sesión |
| Inactividad | 30 min → logout automático (25 min → aviso previo) |
| Tenant demo | `ferreteria-demo-sa` en `aela_master`, BD `aela_ferreteria_demo_sa` |
