# AELA ERP — Pendientes 2026-06-03
## Continuación del Buzón SRI + estado general del proyecto

---

## Estado del Buzón SRI al inicio de esta sesión

### Historial de fixes (últimos 3 commits)

| Commit | Descripción | Estado |
|--------|-------------|--------|
| `e134524` | URL correcta portal JSF + `domcontentloaded` + filtro año/mes | ✅ Deploado |
| `c9e76d8` | Patrón async job para evitar timeout 60s de Railway | ✅ Deploado |
| `1137041` | Docs sesión nocturna | ✅ Deploado |

### Flujo completo del scraper (tal como está hoy)

```
Usuario → POST /api/buzon/sri/consultar
  → Respuesta inmediata: { jobId: "abc123", status: "pending" }   ← evita 60s timeout
  → Scraper corre en background (Node.js IIFE async)
       1. scraperSriLogin()
            → Navega srienlinea.sri.gob.ec/ (domcontentloaded)
            → Detecta campos #usuario / #contrasenia (JSF)
            → Hace login, retorna { cookies }
       2. scraperSriRecibidos(cookies, params)
            → _mesesEnRango(fechaDesde, fechaHasta) → [{ anio, mes }, ...]
            → Por cada mes:
                 _consultarMesJsf(page, ruc, anio, mes, tipo)
                   → select[id*="anio"], select[id*="mes"]
                   → click "Consultar"
                 _extraerFilas(page) → claves de 49 dígitos
            → _deduplicar(items)

Frontend polling cada 3 s → GET /api/buzon/sri/job/:jobId
  → { status: "pending", mensaje: "Navegando portal SRI..." }
  → ...
  → { status: "done", resultados: [...], total: N, nuevos: M }
  → Paso 2: usuario selecciona y hace clic en "Importar"
```

---

## ✅ Resuelto en esta sesión (2026-06-03)

### Fix: 401 en `cola-sri/estado` + 500 en `configuracion-sistema` para tenants — commit `0a9718c`

**Bug 1 — 401** (`usePendientesSRI` en Layout.jsx):
El `fetch()` crudo no enviaba `X-Tenant-Slug`. El middleware detectaba
`tokenSlug='mprq'` vs `requestSlug=null` → TENANT_MISMATCH → 401.
Fix: agregar `X-Tenant-Slug` desde `localStorage.aela_tenant_slug`.

**Bug 2 — 500** (`GET /api/configuracion-sistema` para mprq):
`applySchemaFixes.js` solo corría contra la BD principal (`DATABASE_URL`).
La BD `aela_mprq` no tenía las columnas nuevas de `configuracion_sistema`
(`impresoraIp`, `impresoraHabilitada`, `cajaDineroHabilitada`,
`impresionAutoMobile`, `sbuEcuador`). Prisma fallaba → 500.
Fix: el script ahora itera `aela_master.tenants` y aplica los mismos
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` a cada BD de tenant.

El fix de `applySchemaFixes.js` corre **al arrancar el servidor** (en `start.sh`).
Después del deploy de Railway, las columnas quedarán aplicadas automáticamente.

---

## 🔴 Pendientes urgentes (verificar HOY)

### 1. Probar la descarga automática en producción

**Pasos:**
1. Ir a `aela.corpsimtelec.com/buzon` → pestaña "Descarga automática SRI"
2. Hacer clic en **🔍 Diagnóstico SRI** primero:
   - `SRI-Portal` → debe ser ✅ (portal accesible)
   - `SRI-API-Movil` → ❌ 404 (normal, API muerta)
   - `Chrome` → ✅ con versión (crítico para el scraper)
3. Si Chrome ✅: ingresar RUC + clave del portal SRI y hacer clic en "Consultar portal SRI →"
4. Observar el mensaje de progreso (debe cambiar dinámicamente)
5. Esperar hasta 3 minutos

**Resultados posibles:**

| Resultado | Causa | Acción |
|-----------|-------|--------|
| Aparece lista de comprobantes ✅ | Todo funcionó | Seleccionar e importar |
| Error `"No element found for selector"` | Selectores JSF del año/mes incorrectos | Ver tarea 2 |
| Error `"credenciales incorrectas"` | RUC/clave del SRI erróneos | Verificar en srienlinea.sri.gob.ec |
| Error `"BROWSER_UNAVAILABLE"` | Chrome no encontrado | Ver tarea 3 |
| Error `"ERR_NAME_NOT_RESOLVED"` | SRI bloquea IP de Railway | Usar Importar TXT/ZIP permanentemente |
| Job no encontrado (404 en polling) | Servidor reiniciado durante el scraper | Reintentar |

---

### 2. Si fallan los selectores del formulario JSF

El formulario de `menu.jsf` tiene dropdowns de año y mes. Los selectores actuales son:
```javascript
// Año:
'select[id*="anio"]', 'select[id*="ano"]', 'select[id*="year"]'

// Mes:
'select[id*="mes"]', 'select[id*="month"]'
```

Si no funcionan, **inspeccionar el HTML real del portal**:
1. Ir a `srienlinea.sri.gob.ec/comprobantes-electronicos-internet/pages/consultas/menu.jsf`
2. DevTools → Inspector → clic en el dropdown de año
3. Copiar el `id` o `name` del elemento `<select>`
4. Actualizar `_consultarMesJsf` en `backend/utils/sriScraper.js`

Ejemplo de lo que podría verse:
```html
<!-- JSF auto-genera IDs como: -->
<select id="j_idt45:anio" name="j_idt45:anio">
<!-- o simplemente: -->
<select id="anio" name="anio">
```

Si es el primero, el selector `select[id*="anio"]` ya funciona (busca que el id *contenga* "anio").

---

### 3. Si Chrome ❌ en el diagnóstico

Verificar en Railway:
- Variables de entorno → ¿está `PUPPETEER_EXECUTABLE_PATH`?
- Si no: agregar `PUPPETEER_EXECUTABLE_PATH=chromium`
- Si sí y sigue fallando: cambiar a la ruta absoluta de Nix:
  `PUPPETEER_EXECUTABLE_PATH=/nix/var/nix/profiles/default/bin/chromium`

Alternativamente, verificar `nixpacks.toml` en la raíz del repo:
```toml
[phases.setup]
nixPkgs = ["chromium", "nodejs_20"]

[variables]
PUPPETEER_EXECUTABLE_PATH = "chromium"
PUPPETEER_SKIP_DOWNLOAD = "true"
```

---

### 4. mprq — Completar configuración del tenant

El cliente `mprq` (Miryan Patricia Ramon Quezada) tiene el tenant activo pero **sin certificado .p12**.
Sin el certificado no puede firmar ni enviar comprobantes electrónicos al SRI.

**Pasos que el cliente debe hacer:**
1. Entrar a `aela.corpsimtelec.com/mprq`
2. Configuración → SRI → subir certificado `.p12` y su clave
3. Configurar punto de emisión y establecimiento
4. Configurar datos de la empresa (RUC, razón social, dirección)

---

## 🟡 Pendientes medios

### 5. Limpiar el tenant loja-torneos-y-competencia

Si no se hizo ya, ejecutar en DBeaver (conexión a Railway):
```sql
DELETE FROM aela_master.tenants WHERE slug = 'loja-torneos-y-competencia';
DROP DATABASE IF EXISTS aela_loja_torneos_y_competencia;
```

### 6. Eliminar logs de diagnóstico temporales

En `backend/middleware/tenant.js` hay logs `[tenant]` que se agregaron durante el fix del bug
multi-tenant de 2026-06-01. Verificar si siguen ahí y eliminarlos.

### 7. App móvil — Assets y prueba

- `mobile/assets/` ya tiene: `adaptive-icon.png`, `icon.png`, `splash-icon.png`
- Pendiente: verificar que son los logos reales de AELA (no placeholders)
- Probar con `expo start` en dispositivo Android/iOS

---

## 🟢 Backlog

| # | Tarea |
|---|-------|
| 8 | Pasarela de pagos — PayPhone o Stripe |
| 9 | Impuesto a la Renta en nómina (tabla LORTI) |
| 10 | App móvil — ESC/POS Bluetooth + escáner |
| 11 | Tests e2e Playwright |
| 12 | Catastro SRI — actualización desde CSV oficial |
| 13 | Panel Super Admin — stats de uso y facturación |

---

## Arquitectura del Buzón SRI (resumen técnico completo)

```
frontend/src/components/Buzon/BuzonSRI.jsx
  consultarSriAutomatico(payload, onProgreso)
    POST /api/buzon/sri/consultar → { jobId }
    polling GET /api/buzon/sri/job/:jobId cada 3s (máx 80 intentos = 4 min)
    onProgreso(msg) → actualiza botón en tiempo real

backend/routes/buzon.js
  SCRAPER_JOBS = new Map()              ← store en memoria (no persiste entre reinicios)
  POST /sri/consultar                   ← responde en <100ms con jobId
  GET  /sri/job/:jobId                  ← devuelve pending/done/error
  GET  /sri/diagnostico                 ← verifica portal + API + Chrome
  POST /consultar                       ← preview de claves manuales
  POST /importar                        ← importación confirmada
  POST /importar-zip                    ← ZIP de XMLs
  POST /importar-xml                    ← XMLs individuales
  GET  /historial                       ← documentos importados

backend/utils/sriScraper.js
  scraperSriLogin(ruc, pass)            ← { cookies }
  scraperSriRecibidos(cookies, params)  ← { total, items[] }  (por mes)
  obtenerRecibidosScraper(params)       ← items[]
  _mesesEnRango(desde, hasta)           ← [{ anio, mes }, ...]
  _consultarMesJsf(page, ruc, anio, mes, tipo)  ← llena el form JSF

backend/utils/sriPortal.js
  autenticarSriPortal(ruc, pass)        ← token (API 404 — falla rápido en 8s)
  obtenerTodosLosRecibidos(token, ...)  ← fallback (inactivo hasta que SRI reactive)

backend/utils/sri.js
  obtenerXmlDesdeAutorizacion(clave)    ← XML del SRI para importar
```

---

## Estado de la infraestructura

| Componente | Estado | Nota |
|-----------|--------|------|
| Frontend (Vercel) | ✅ | `aela.corpsimtelec.com` |
| Backend (Railway) | ✅ | `aelaerp-production.up.railway.app` |
| PostgreSQL (Railway) | ✅ | BD principal + aela_mprq |
| Catastro SRI | ✅ | 6.7M registros |
| SMTP (Resend + Gmail) | ✅ | — |
| Certificados .p12 | ✅ | Railway Volume |
| Multi-tenant | ✅ | AsyncLocalStorage fix |
| Chromium en Railway | ❓ | Verificar con Diagnóstico SRI |
| API móvil SRI | ❌ | 404 — desactivada por el SRI |
