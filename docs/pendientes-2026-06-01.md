# AELA ERP — Pendientes al 2026-06-01
## Sesión de trabajo: correcciones críticas en producción

---

## ✅ Completado en esta sesión

### 1. Error 500 al firmar y enviar facturas (crítico — bloqueaba producción)

**Causa:** 6 columnas de impresora térmica POS existían en `schema.prisma` pero no en la BD de Railway. Prisma fallaba al hacer `findUnique` en `configuracion_sistema`.

**Columnas faltantes:**
```
impresoraIp, impresoraPuerto, impresoraAncho
impresoraHabilitada, cajaDineroHabilitada, impresionAutoMobile
```

**Fixes aplicados:**
- Migración `20260601000000_add_impresora_termica_pos` con `ADD COLUMN IF NOT EXISTS`
- Script `backend/scripts/applySchemaFixes.js` — aplica el ALTER TABLE directo via `pg` al arrancar, antes de Prisma (garantiza que las columnas existan aunque `migrate deploy` falle)
- Script `backend/scripts/baselineMigrations.js` — resuelve el error `P3005` de Prisma creando el historial `_prisma_migrations` cuando la BD fue inicializada con `db push`
- `backend/start.sh` actualizado para ejecutar los scripts en orden

**Commits:** `b044dfa`, `cb8dfc0`, `9a9d15e`

---

### 2. Error P3005 en `prisma migrate deploy` (Railway)

**Causa:** La BD de Railway fue creada con `prisma db push` y nunca tuvo `_prisma_migrations`. Prisma rechazaba correr `migrate deploy` con error P3005.

**Fix:** `baselineMigrations.js` detecta si `_prisma_migrations` existe; si no, marca todas las migraciones históricas como aplicadas (`prisma migrate resolve --applied`) para que deploys futuros funcionen normalmente.

---

### 3. Fecha incorrecta en facturas (mostraba día anterior)

**Causa:** Prisma serializa `DateTime` como `"2026-06-01T00:00:00.000Z"`. Al construir `new Date()` con ese string en Ecuador (UTC-5), se convertía a 31 de mayo a las 19:00.

**Fix:** `frontend/src/utils/fecha.js` — `parseFechaLocal` extrae la parte `YYYY-MM-DD` de cualquier ISO timestamp y la trata como fecha local, igual que ya hacía con strings de solo fecha.

**Afecta:** facturas, notas de venta, compras, retenciones, liquidaciones, notas de crédito/débito — cualquier campo que use `formatFechaCorta` o `formatFechaLarga`.

**Commit:** `e00a1fa`

---

### 4. Tenant mprq mostraba datos de corpsimtelec (multi-tenant crítico)

Problema complejo resuelto en múltiples capas. Causa raíz: el sistema SaaS multi-tenant tenía el routing de BD incompleto.

#### 4a. AccesoTenant no limpiaba sesión anterior

**Causa:** Al navegar a `/mprq` estando logueado en corpsimtelec, el token anterior quedaba en localStorage y se reutilizaba.

**Fix:** `frontend/src/components/Tenant/AccesoTenant.jsx` — detecta cambio de slug y limpia todas las claves de sesión antes de guardar el nuevo slug.

**Commit:** `f2870dd`

#### 4b. JWT de un tenant podía usarse en otro

**Causa:** `proteger` en `auth.js` no validaba que `decoded.tenantSlug` coincidiera con `req.tenant?.slug`.

**Fix:** `backend/middleware/auth.js` — validación de `TENANT_MISMATCH` antes de buscar el usuario. Token de corpsimtelec (`tenantSlug=null`) rechazado al acceder con slug `mprq`.

**Commit:** `1724e39`

#### 4c. CORS no declaraba explícitamente el header X-Tenant-Slug

**Fix:** `backend/app.js` — agregado `allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Slug']` al CORS.

**Commit:** `31b817e`

#### 4d. `empresas.js` usaba prisma global en todas sus rutas

**Causa:** Todas las rutas de `empresas.js` (`/mi-empresa`, `/mis-empresas`, `/estadisticas`, etc.) usaban `prisma` global (BD de corpsimtelec) en vez de `req.prisma` (BD del tenant).

**Fix:** Agregado middleware `router.use` + reemplazados todos los `prisma.` por `req.prisma.`.

**Commit:** `0fe4d02`

#### 4e. Todas las demás rutas del backend usaban prisma global

**Causa raíz del problema sistémico:** Los 20+ archivos de rutas (`facturas.js`, `usuarios.js`, `clientes.js`, `compras.js`, etc.) todos importan `prisma` como constante de módulo y la usan directamente, ignorando `req.prisma`.

**Fix arquitectónico:** `backend/config/prisma.js` convertido a Proxy con `AsyncLocalStorage`. Ahora el módulo `prisma` devuelve automáticamente el cliente del tenant activo para cada request.

`backend/app.js` activa el contexto tras `resolverTenant`:
```javascript
app.use((req, _res, next) => {
  if (req.prisma && req.prisma !== prismaModule._globalClient) {
    prismaModule.runWithClient(req.prisma, next);
  } else {
    next();
  }
});
```

Resultado: sin cambiar ninguna ruta, `require('../config/prisma')` automáticamente devuelve el cliente correcto para cada request.

**Commit:** `7e772ef`

---

### 5. Verificación de tenants

| Tenant | BD | Estado | Verificación |
|--------|-----|--------|-------------|
| `loja-torneos-y-competencia` | `aela_loja_torneos_y_competencia` | activo | Endpoint `/api/registro/estado/` devuelve `{ estado: "activo" }` ✅ |
| `mprq` | `aela_mprq` | activo | empresa: Miryan Patricia Ramon Quezada / usuario: mpramon ✅ |
| corpsimtelec | BD principal `railway` | activo | acceso directo sin slug ✅ |

**CONSORCIO VIAL UCHUCAY** (empresa id=2 en BD principal): verificado que es una empresa legítima de corpsimtelec en modo multiempresa, no una contaminación de datos.

---

## 🔴 Pendientes urgentes

### 1. Verificar que el fix de AsyncLocalStorage funciona en producción

Tras el último deploy, probar que mprq muestra datos correctos:
- Dashboard: $0 ventas, 0 facturas, 0 productos (BD limpia)
- Usuarios: solo `mpramon`
- Config SRI: debe estar vacío (no datos de corpsimtelec)
- Facturas: lista vacía

Si algo aún muestra datos de corpsimtelec, revisar Railway logs para errores del Proxy.

### 2. Configurar mprq para operación real

El cliente `mprq` (Miryan Patricia Ramon Quezada) necesita:
1. Ingresar a `aela.corpsimtelec.com/mprq` con usuario `mpramon`
2. Ir a **Configuración SRI** → ingresar sus datos reales (RUC, establecimiento, etc.)
3. Cargar su certificado `.p12`
4. Configurar punto de emisión
5. Probar con una factura en ambiente de pruebas SRI antes de producción

### 3. Logging de diagnóstico pendiente de eliminar

`backend/middleware/tenant.js` tiene logs `[tenant] ...` temporales para diagnóstico. Eliminar tras confirmar que el fix funciona.

---

## 🟡 Pendientes medios

### 4. App móvil — assets reales

Reemplazar PNGs de placeholder azul sólido en `mobile/assets/` por logo AELA real:
- `icon.png` — 1024×1024
- `adaptive-icon.png` — 1024×1024
- `splash-icon.png` — 512×512

### 5. App móvil — prueba completa en dispositivo

Flujo: Login → selector empresa → POS → cobro → recibo → imprimir

### 6. Impresora térmica — prueba real

1. Asignar IP fija en router para la impresora
2. Configurar en app móvil: tab Config → IP de impresora
3. Probar "Probar conexión"
4. Probar apertura del cajón de dinero

---

## 🟢 Backlog

| # | Tarea |
|---|-------|
| 7 | Panel admin SaaS — ver todos los tenants, estado, plan, último acceso |
| 8 | Pasarela de pagos — PayPhone o Stripe para planes Medium/Pro |
| 9 | Impuesto a la Renta en nómina (tabla progresiva LORTI) |
| 10 | App móvil — ESC/POS Bluetooth directo (requiere Expo dev build) |
| 11 | App móvil — escáner de código de barras con `expo-camera` |
| 12 | Tests e2e — Playwright (web) y `@testing-library/react-native` (móvil) |
| 13 | BDs locales — renombrar `scfi_dev` → `aela_dev` |
| 14 | Manual de usuario — módulos POS, Caja, Facturación, Inventario |

---

## Arquitectura actual del sistema

### Infraestructura en producción
| Servicio | URL |
|----------|-----|
| Frontend (Vercel) | https://aela.corpsimtelec.com |
| Backend (Railway) | https://aelaerp-production.up.railway.app |
| PostgreSQL (Railway) | postgres.railway.internal:5432 |
| Repo GitHub | https://github.com/raocampo/AELAERP |

### BDs en PostgreSQL Railway
| BD | Uso |
|----|-----|
| `railway` | BD principal — corpsimtelec (acceso directo sin slug) |
| `aela_mprq` | Tenant mprq — Miryan Patricia Ramon Quezada |
| `aela_loja_torneos_y_competencia` | Tenant loja-torneos |

### Schema `aela_master` (dentro de BD `railway`)
Tabla `tenants`: catálogo de todos los tenants SaaS con sus credenciales cifradas.

### Flujo multi-tenant (request)
```
Cliente → aela.corpsimtelec.com/mprq
  ↓
AccesoTenant: guarda slug, limpia sesión anterior
  ↓
/login con X-Tenant-Slug: mprq
  ↓
resolverTenant → busca "mprq" en aela_master.tenants
  ↓
getTenantPrisma → crea/reutiliza PrismaClient para aela_mprq
  ↓
runWithClient(req.prisma, next) → activa contexto AsyncLocalStorage
  ↓
Cualquier ruta: require('../config/prisma') → Proxy → aela_mprq ✓
```

### Archivos modificados en esta sesión
```
backend/prisma/migrations/20260601000000_add_impresora_termica_pos/migration.sql
backend/scripts/applySchemaFixes.js          ← ALTER TABLE directo al arrancar
backend/scripts/baselineMigrations.js        ← baseline de _prisma_migrations
backend/start.sh                             ← orden de arranque actualizado
backend/config/prisma.js                     ← Proxy + AsyncLocalStorage (context-aware)
backend/app.js                               ← CORS headers + runWithClient middleware
backend/middleware/auth.js                   ← validación TENANT_MISMATCH
backend/middleware/tenant.js                 ← logs de diagnóstico (temp)
backend/routes/empresas.js                   ← usa req.prisma en todas las rutas
frontend/src/utils/fecha.js                  ← parseFechaLocal maneja ISO timestamps
frontend/src/components/Tenant/AccesoTenant.jsx  ← limpia sesión al cambiar tenant
```
