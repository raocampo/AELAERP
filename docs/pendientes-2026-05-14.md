# Pendientes y avances — AELA ERP — 2026-05-14

## ✅ Completado en esta sesión

### Correcciones de bugs (Macro Empresa)
- **`AdminEmpresasRoute`**: Cambiado de `!modoMulti || !tienePermiso(...)` a solo `!tienePermiso(...)` en `App.jsx`. El admin ahora puede acceder a `/empresas` en modo monoempresa.
- **Sidebar**: Eliminado `soloMulti: true` del ítem "Empresas" en `Layout.jsx`. El enlace siempre es visible para el admin.
- **Backend `POST /api/empresas`**: Eliminado el bloqueo por `modoOperacion !== 'multiempresa'`. El admin puede crear filiales en cualquier modo.
- **`GestionEmpresas.jsx`**: Guard simplificado a solo verificar permiso `empresas.gestionar`.

### Nuevas funcionalidades
- **`esMatriz` y `parentEmpresaId`** ahora se persisten en `POST /api/empresas`.
- **Gestión de usuarios por empresa** (`usuario_empresas`):
  - `GET /api/empresas/:id/usuarios` — lista usuarios con acceso
  - `POST /api/empresas/:id/usuarios` — asigna usuario con rol
  - `DELETE /api/empresas/:id/usuarios/:usuarioId` — remueve acceso
  - Panel expandible "👥 Usuarios" en `GestionEmpresas.jsx`
- **SMTP test endpoint**: `POST /api/configuracion-sistema/test-email`
- **Botón "Enviar email de prueba"** en `ConfiguracionSistema.jsx` con instrucciones de configuración
- **Script `scripts/renombrarBDs.ps1`**: renombra `scfi_dev → aela_dev` y `scfi_master → aela_master`

### Multiempresa SaaS (verificado — ya estaba implementado)
- JWT incluye `tenantSlug` ✅
- `api.js` envía header `X-Tenant-Slug` ✅
- `AuthContext.jsx` guarda `tenantSlug` en localStorage ✅

---

## 📋 Instrucciones pendientes de ejecutar (no requieren código)

### Punto 3: Cargar Catastro SRI en Railway
```powershell
$env:DATABASE_URL = "postgresql://postgres:PASSWORD@roundhouse.proxy.rlwy.net:PORT/railway"
cd "d:\Users\USUARIO\...\backend"
node scripts/importarCatastroSRI.js ..\docs\datosRuc
```

### Punto 5: Configurar SMTP en Railway
Variables a agregar en Railway → servicio AELAERP → Variables:
```
SMTP_HOST     = smtp.gmail.com
SMTP_PORT     = 587
SMTP_SECURE   = false
SMTP_USER     = tucorreo@gmail.com
SMTP_PASS     = contraseña-de-app-gmail
SMTP_FROM     = AELA ERP <tucorreo@gmail.com>
SMTP_SOPORTE  = soporte@tudominio.com
```
Alternativa recomendada: **Resend.com** (gratuito hasta 3,000/mes):
```
SMTP_HOST = smtp.resend.com
SMTP_PORT = 587
SMTP_USER = resend
SMTP_PASS = re_XXXXXXXXXXXXXXXX  (API key de resend.com)
```

### Punto 8: Segunda empresa de prueba (Macro Empresa local)
Ver `docs/pendientes-2026-05-03.md` — sección "Crear empresa 2".

### Punto 9: Dominio personalizado
- `app.aela.ec` → Vercel: Settings → Domains → Add Domain
- `api.aela.ec` → Railway: Settings → Domains → Custom Domain
- En Cloudflare DNS: CNAME records apuntando a las URLs dadas por Vercel/Railway

### Renombrar BDs locales
```powershell
.\scripts\renombrarBDs.ps1 -PgUser postgres -PgPassword tuContraseña
```
Luego actualizar `backend/.env`:
```
DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/aela_dev
```

---

## 🔲 Pendientes futuros

- [ ] Manual de usuario: completar secciones Bancos, Declaraciones/ATS, Talento Humano (Nómina completa), sección Admin
- [ ] Multiempresa SaaS: middleware de routing por subdominio (cuando se requiera)
- [ ] Tests automatizados (unitarios/e2e)
- [ ] CI/CD con GitHub Actions
- [ ] Migración de datos históricos
