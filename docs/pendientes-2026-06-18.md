# AELA ERP — Pendientes 2026-06-18

## Sesión de hoy — resumen ejecutivo

Se revisaron bugs reportados en producción y se implementaron 6 fixes más una nueva feature (Forma de pago).
Deploy pusheado como commit `c18d9e9` → Railway + Vercel en marcha automáticamente.

---

## ✅ Completado esta sesión (commit `c18d9e9`)

### 1. applySchemaFixes.js — SQL independientes
**Problema:** si cualquier `ALTER TABLE` anterior lanzaba error, el `for` loop salía y `CREATE TABLE proformas` nunca se ejecutaba → proformas daba 500 en producción.
**Fix:** cada SQL ahora corre en su propio `try/catch`; si uno falla se loguea como advertencia y los demás continúan.

### 2. proformas.js — expone error real
**Problema:** el catch devolvía `"Error al crear proforma"` genérico — imposible saber la causa desde el frontend.
**Fix:** devuelve `err.message` real → el toast mostrará el error exacto de PostgreSQL.

### 3. AuthContext.jsx — refrescar lista de empresas en startup
**Problema:** tras `window.location.reload()` (al cambiar empresa), el `useEffect` sólo leía `aela_empresas_disponibles` de localStorage (datos potencialmente viejos). Si una empresa fue desactivada, seguía apareciendo.
**Fix:** el `useEffect` ahora llama `cargarEmpresasDisponibles()` después de restaurar desde localStorage → lista siempre fresca de la API.

### 4. EmpresaSwitcher.jsx — filtrar empresas inactivas
**Problema:** empresas con `activo: false` aparecían en el selector; al seleccionarlas daban "No tienes acceso a esa empresa o está inactiva".
**Fix:** filtra `activo !== false` antes de renderizar. Si quedan < 2 activas, el switcher desaparece.

### 5. FormProforma.jsx — dropdown posición + forma de pago
**Problemas:**
- Dropdown de búsqueda de producto solo recalculaba posición en `onFocus`, no al escribir → si el usuario scrolleaba, la posición quedaba desfasada.
- Faltaba campo "Forma de pago".

**Fixes:**
- `calcDropdownPos(el)` se llama en `onChange` y `onFocus`; umbral subido a 240px.
- Nuevo `select` Forma de pago con opciones: Contra Entrega, 50% anticipo / 50% entrega, Prefactura, Crédito 15 días, Crédito 30 días, Transferencia bancaria.

### 6. DetalleProforma.jsx — mostrar forma de pago
- Normaliza `formapago` (lowercase de raw query) → `formaPago`
- Muestra "Forma de pago" con banda izquierda púrpura antes de observaciones
- Incluye forma de pago en el texto de WhatsApp: `Forma de pago: Contra Entrega`

### 7. applySchemaFixes.js — columna formaPago en proformas
`ALTER TABLE "proformas" ADD COLUMN IF NOT EXISTS "formaPago" VARCHAR(100)` → se aplica en el próximo deploy automáticamente.

---

## ✅ Completado por el usuario (sesión anterior — commits 2026-06-18 mañana)

| Commit | Qué resolvió |
|--------|-------------|
| `19cf60b` | FormFactura ← Proforma: pre-llena cliente+detalles; llama marcar-convertida al guardar |
| `32ed286` | Proformas 500 en prod + email + WhatsApp en DetalleProforma |
| `9cdd297` | applySchemaFixes usa DATABASE_MASTER_URL + creds tenant; dropdown scroll; Buzón SRI timeout 3 min |
| `d155dd2` | applySchemaFixes corre al provisionar tenants nuevos |
| `8a2a013` | req.prisma fallback; EmpresaSwitcher persiste en localStorage; Buzón 422 muestra mensaje |

---

## 🔴 Pendiente crítico — Buzón SRI scraper

**Estado:** el scraper Puppeteer sigue fallando en Railway con HTTP 422.
**Síntoma:** el frontend muestra el toast con el mensaje de error del job (gracias al fix de 422 del commit `8a2a013`).

**Acción pendiente:**
1. Entrar a la app → Buzón SRI → Descarga automática
2. Intentar consultar y LEER el mensaje exacto del toast rojo
3. Compartir ese mensaje para saber si el error es:
   - `BROWSER_UNAVAILABLE` → Chrome no instalado en Railway (fix: variable de entorno o Dockerfile)
   - Error de credenciales SRI → clave del portal incorrecta
   - Timeout → el portal SRI no responde (check: acceder a srienlinea.sri.gob.ec desde otro lugar)
   - Error de selector JSF → el portal cambió su HTML

**Diagnóstico disponible:** `GET /api/buzon/sri/diagnostico` en Railway devuelve si Chrome está disponible y su versión.

---

## 🟡 Pendiente — Verificación en producción

Una vez que Railway haya redesplegado (2-3 minutos), verificar:

| Check | Cómo verificar |
|-------|---------------|
| Proforma se crea sin error | Ir a Ventas → Proformas → Nueva Proforma, agregar un producto, guardar |
| Forma de pago aparece | Crear proforma con "Contra Entrega" → ver en detalle la banda púrpura |
| Botones WhatsApp / Email / Imprimir | Aparecen en el detalle de la proforma guardada |
| EmpresaSwitcher muestra 3 empresas | Iniciar sesión como Robert Ocampo → clic en selector empresas |
| Empresas inactivas no aparecen | El selector solo muestra empresas con `activo: true` |

---

## 🟢 Backlog (sin fecha)

| # | Módulo | Tarea | Notas |
|---|--------|-------|-------|
| 1 | Buzón SRI | Diagnóstico Chromium en Railway — ver error exacto del scraper | Ver sección de arriba |
| 2 | Proformas | PDF descargable (jsPDF o endpoint Puppeteer) | Actualmente solo `window.print()` |
| 3 | App Móvil | Reemplazar assets placeholder en `mobile/assets/` | icon 1024×1024, adaptive-icon 1024×1024, splash 512×512 |
| 4 | App Móvil | Cuenta EAS en expo.dev + campo `owner` en `eas.json` | Necesario para generar APK |
| 5 | App Móvil | `eas build --platform android --profile apk` | Genera APK instalable |
| 6 | App Móvil | ESC/POS directo desde celular | Requiere Expo dev build (salir de Expo Go) con `react-native-tcp-socket` |
| 7 | SaaS | Panel Super Admin (tenants, planes, stats de uso) | — |
| 8 | Pagos | Pasarela PayPhone / Stripe | — |
| 9 | Nómina | LORTI — tabla impuesto a la renta | — |
| 10 | Ayuda | AyudaSistema.jsx — sección multiempresa / Admin Macro | — |
| 11 | Tests | e2e Playwright (flujo factura, proforma, login) | — |

---

## Archivos modificados hoy

| Archivo | Cambio |
|---------|--------|
| `backend/scripts/applySchemaFixes.js` | SQL independientes + columna `formaPago` en proformas |
| `backend/routes/proformas.js` | Error real en 500; `formaPago` en CREATE y UPDATE |
| `frontend/src/context/AuthContext.jsx` | `cargarEmpresasDisponibles()` en useEffect |
| `frontend/src/components/Layout/EmpresaSwitcher.jsx` | Filtra `activo !== false` |
| `frontend/src/components/Proformas/FormProforma.jsx` | `calcDropdownPos` + campo Forma de pago |
| `frontend/src/components/Proformas/DetalleProforma.jsx` | Normaliza `formaPago` + lo muestra + WhatsApp |

---

## Contexto técnico rápido (para retomar desde casa)

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app  (push a main = redeploy auto)
Frontend: Vercel  → aela.corpsimtelec.com              (push a main = redeploy auto)
DB:       PostgreSQL en Railway
  BD principal: railway     (Corp Simtelec — sin tenant slug)
  BD tenant:    aela_mprq   (Miryan Patricia Ramon Quezada)
```

**Stack:**
- Backend: Node.js / Express / Prisma (schema) + `$queryRawUnsafe` para tablas custom (proformas, tabla_utilidades)
- Frontend: React 18 + Vite + React Router v6 + React Hot Toast
- Multi-tenant: AsyncLocalStorage Proxy en `config/prisma.js` + `X-Tenant-Slug` header
- Admin Macro: usuario con `rol base = 'admin'` tiene acceso implícito a TODAS las empresas

**Patrón para agregar columnas a tablas fuera de Prisma:**
→ Agregar `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` en `backend/scripts/applySchemaFixes.js` array `FIXES`
→ Se aplica automáticamente en el próximo deploy (start.sh llama `node scripts/applySchemaFixes.js`)
