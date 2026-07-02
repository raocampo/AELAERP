# AELA ERP — Sesión 2026-07-02

## Resumen ejecutivo

Sesión enfocada en dos frentes: (1) corrección de bugs multi-tenant en retenciones y
declaraciones, y (2) implementación completa de importación masiva de facturas históricas
desde Excel para manejo de contabilidad de años anteriores.

Commits pusheados: `e893afa`, `2d3bd20`

---

## ✅ Completado hoy

### Fix 1 — Retenciones fallaban para sub-empresas (`e893afa`)

**Problema:** `ListaRetenciones.jsx` y `FormRetencion.jsx` usaban `axios` directo sin el
header `X-Tenant-Slug`. El backend sin ese header cae a `BD_principal`, donde empresas
como PUPUCHAICELA no existen → `requiereModulo` obtiene config null → 403 → "Error al
cargar retenciones".

**Fix:** Los tres componentes de retenciones migrados a `api` service (que añade
`X-Tenant-Slug` automáticamente):
- `ListaRetenciones.jsx` — lista, PDF, XML, reenviar, anular
- `FormRetencion.jsx` — catálogos, búsqueda compras, guardar, PDF descarga

**Mismo patrón que:** Declaraciones.jsx (sesión 2026-06-29)

### Fix 2 — Declaraciones: selector de año solo mostraba 2024-2026 (`e893afa`)

**Problema:** Array hardcodeado `[anioActual, anioActual-1, anioActual-2]` — solo 3 años.

**Fix:** `Array.from({ length: anioActual - 2019 }, (_, i) => anioActual - i)` →
genera dinámicamente desde el año actual hasta 2020 (7 años en 2026, y se expande
solo cada año nuevo).

**Archivo:** `frontend/src/components/Declaraciones/Declaraciones.jsx` línea 104

### Feature — Importar facturas históricas desde Excel (`2d3bd20`)

Módulo completo nuevo para cargar facturas de ventas de años anteriores (contabilidad
atrasada, migración desde sistemas anteriores).

**Acceso:** Menú Ventas → "Importar históricas" → `/facturas/importar-historicas`

**Flujo de 4 pasos en el UI:**
1. Instrucciones + explicación de estados
2. Drag-and-drop del archivo Excel
3. Vista previa con validación fila por fila (errores resaltados antes de importar)
4. Resultado con detalle de importadas y errores

**Estados asignados automáticamente:**
- `AUTORIZADO` — si se proporciona `numero_autorizacion` (49 dígitos del SRI)
- `HISTORICO` (nuevo) — sin autorización; solo para registros contables, nunca se envía al SRI

**IVA histórico soportado:** 0% / 5% / 12% / 14% / 15%

**Columnas del Excel (plantilla descargable desde el UI):**

| Campo | Requerido | Descripción |
|-------|-----------|-------------|
| `fecha_emision` | Sí | DD/MM/AAAA |
| `tipo_id` | Sí | RUC / CEDULA / PASAPORTE / CONSUMIDOR |
| `identificacion` | Sí* | RUC o cédula del cliente |
| `razon_social` | Sí | Nombre del cliente |
| `descripcion` | No | Default: "Servicios / productos varios" |
| `subtotal_sin_iva` | No* | Base 0% |
| `subtotal_con_iva` | No* | Base gravada (al menos uno de estos dos) |
| `iva_porcentaje` | No | 0, 12, 14, 15 (default 15) |
| `iva_total` | No | Se calcula si está vacío |
| `forma_pago` | No | EFECTIVO / TRANSFERENCIA / TARJETA / CREDITO / CHEQUE |
| `email` | No | Email del cliente |
| `numero_factura` | No | `001-001-000000001` — respeta numeración original |
| `numero_autorizacion` | No | 49 dígitos → queda como AUTORIZADO |
| `observaciones` | No | Notas internas |

**Lógica de clave de acceso:**
- Con `numero_autorizacion` → usa como `claveAcceso` (ya es la misma cosa en el SRI)
- Con `numero_factura` → parsea establecimiento/secuencial y genera clave por el algoritmo SRI
- Sin ninguno → asigna siguiente secuencial automático y genera clave

**Campo `origenRegistro` nuevo en tabla `facturas`:**
- `MANUAL` (default — todas las emitidas normalmente)
- `IMPORTACION` (facturas cargadas por este módulo)
- Aplicado en `applySchemaFixes.js` para Railway + en `schema.prisma` para Prisma

**Archivos nuevos/modificados:**

| Archivo | Cambio |
|---------|--------|
| `backend/utils/importarFacturasHistoricas.js` | NUEVO — parseo Excel, validación, plantilla XLSX |
| `backend/routes/facturas.js` | 3 nuevos endpoints (plantilla, preview, ejecutar) |
| `backend/prisma/schema.prisma` | Campo `origenRegistro` en modelo `facturas` |
| `backend/scripts/applySchemaFixes.js` | ALTER TABLE facturas ADD COLUMN origenRegistro |
| `frontend/src/components/Facturacion/ImportarFacturasHistoricas.jsx` | NUEVO — UI 4 pasos |
| `frontend/src/components/Facturacion/ImportarFacturasHistoricas.css` | NUEVO — estilos |
| `frontend/src/App.jsx` | Lazy import + ruta `/facturas/importar-historicas` |
| `frontend/src/components/Layout/Layout.jsx` | Item de menú "Importar históricas" |
| `frontend/src/components/Facturacion/ListaFacturas.jsx` | Badge `HISTORICO` + filtro por estado |

---

## 🔴 PENDIENTES CRÍTICOS — Verificar desde casa

### 1. Probar la importación con un archivo real

Preparar un Excel con 5-10 filas reales de facturas históricas de LSAC o PUPUCHAICELA:
- Algunas con `numero_autorizacion` (copiar de facturas ya autorizadas SRI)
- Algunas sin autorización (solo contabilidad)
- Algunas con IVA 12% (facturas 2019-2021)
- Una con errores deliberados para confirmar que preview los detecta

Verificar:
1. Vista previa muestra filas válidas e inválidas correctamente
2. Importar → aparecen en `/facturas?estado=HISTORICO`
3. Aparecen en el resumen de Declaraciones (F104) con sus subtotales y período correcto
4. Badge "Histórica" en azul visible en la lista de facturas

### 2. Confirmar que Railway ejecutó `applySchemaFixes.js` para crear `origenRegistro`

El columna `origenRegistro` debe existir en la tabla `facturas`. Railway debería correr
el script al hacer deploy. Si la importación devuelve error Prisma sobre esa columna:
- Railway → Dashboard → AELA backend → pestaña "Settings" o "Variables"
- Confirmar que el startup script corre `node backend/scripts/applySchemaFixes.js`
- O ejecutar manualmente desde la consola de Railway: `node scripts/applySchemaFixes.js`

### 3. Pendientes de sesión anterior (2026-07-01) — aún sin confirmar

Estos quedaron pendientes desde ayer:

**a) Importar ZIP en PUPUCHAICELA (45 documentos)**
El fix `ec0b57a` (cambio `prisma.$transaction` → `req.prisma.$transaction`) debe haber
resuelto el FK violation. Verificar con los 45 archivos ZIP del Buzón SRI.
Si sigue fallando, revisar Railway Logs buscando: `[Buzón]`

**b) Scraper SRI — login**
Confirmar que el build de Railway incluye el hash MD5+SHA-512 (`a581579`).
Log esperado al arrancar: `[SRI] sriScraper.js build 2026-07-01 — incluye hash MD5+SHA-512`
Si NO aparece → redeploy manual en Railway con "Clear build cache".

**c) Gestión de Empresas — tipoContribuyente / repLegal / contadora**
Editar cualquier empresa jurídica, llenar los 3 campos y guardar. Recargar y verificar
que persisten. Fix fue `3abddae`.

---

## 🟡 PENDIENTES PRÓXIMAS SESIONES (backlog)

### Funcionalidades pendientes

**AyudaSistema.jsx — actualizar sección multiempresa/Admin Macro**
La sección de ayuda no refleja el flujo actual multiempresa de LSAC con sub-empresas
(PUPUCHAICELA, MONCAYO, VIPACONSTRUCTORES). Debe documentar:
- Cómo cambiar entre empresas desde el header
- Qué módulos están disponibles por empresa
- Cómo el administrador macro gestiona sub-empresas

**Declaraciones — incluir facturas HISTORICO en los cálculos**
Actualmente `backend/routes/declaraciones.js` filtra facturas por `estadoSri`. Verificar
que el estado `HISTORICO` está incluido en los WHERE de F104/F103/F101, o agregarlo.
Si no se incluye, las facturas importadas no aparecen en declaraciones.

```javascript
// Verificar/agregar en backend/routes/declaraciones.js:
where: {
  empresaId: req.empresa.id,
  estadoSri: { in: ['AUTORIZADO', 'HISTORICO'] },  // <-- asegurar HISTORICO
  anulada: false,
}
```

**Importar facturas históricas — mejoras v2**
- Importar facturas de COMPRA históricas (mismo patrón, distinto endpoint)
- Soporte para múltiples líneas de detalle por factura (segunda hoja del Excel)
- Validación de duplicados por `numero_autorizacion` antes de mostrar el preview
- Exportar las facturas con errores a un Excel de "rechazadas" para que el usuario las corrija

### App móvil

**Logos reales AELA:**
- App icon: 1024×1024 px, fondo sólido (no transparente), guardar en `assets/`
- Splash screen: 512×512 px mínimo
- Reemplazar placeholders en `app.json` (campos `icon` y `splash.image`)

**EAS (Expo Application Services):**
- `eas login` con la cuenta de Expo (crear si no existe)
- `eas build:configure`
- Primer build APK: `eas build -p android --profile preview`
- Aprox. 10-15 min en los servidores de Expo

**Bluetooth ESC/POS (impresora térmica):**
- Librería: `react-native-bluetooth-escpos-printer` o `react-native-thermal-receipt-printer-image-qrcode`
- Integrar en POS (PuntoVenta.jsx) y en pantalla de factura
- Requiere permiso `BLUETOOTH_CONNECT` en `app.json`

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (BD_principal + tenant lsac)
```

**Multi-tenant:** El header `X-Tenant-Slug` en cada request determina qué BD usa el
backend. El `api` service de frontend lo añade automáticamente. Componentes que usen
`axios` directo (sin el `api` service) rompen en sub-empresas.

**Patrón multi-tenant corregido (referencia para futuras pantallas):**
```js
// ❌ Mal — rompe para PUPUCHAICELA, MONCAYO, etc.
import axios from 'axios';
const API = import.meta.env.VITE_API_URL || 'http://localhost:5600/api';
const token = localStorage.getItem('token');
const { data } = await axios.get(`${API}/ruta`, { headers: { Authorization: `Bearer ${token}` } });

// ✅ Bien — X-Tenant-Slug se añade automáticamente
import api from '../../services/api';
const { data } = await api.get('/ruta');
```

**Multer rompe AsyncLocalStorage:**
Rutas con `upload.single()` o `upload.array()` deben usar `req.prisma.$transaction()`
en vez de `prisma.$transaction()`. El objeto `req.prisma` siempre tiene el cliente del
tenant correcto, independientemente del AsyncLocalStorage.

**Estado HISTORICO:**
Nuevo estado en `facturas.estadoSri`. No hay proceso background que lo procese.
Verificar que `backend/routes/declaraciones.js` lo incluye en los filtros WHERE.

---

## Commits de hoy

| Commit | Descripción |
|--------|-------------|
| `e893afa` | fix: retenciones y declaraciones usan api service (tenant multi-empresa) |
| `2d3bd20` | feat: importar facturas históricas desde Excel (contabilidad atrasada) |
