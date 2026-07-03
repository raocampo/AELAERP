# AELA ERP — Sesión 2026-07-03

## Resumen ejecutivo

Sesión con dos frentes: (1) auditoría sistemática de aislamiento multi-tenant en todo el
backend y frontend pendiente, y (2) módulo completo de Plan de Cuentas — importación
inteligente, reemplazo, Supercias NIIF, arrastre de archivos y diagnóstico de formato.

Commits pusheados: `4d1e3a4`, `4b5b59e`, `bb2ea49`, `2a03852`, `3340ac8`, `9ef752e`

---

## ✅ Completado hoy

### Fix 1 — Auditoría multi-tenant sistemática (`4d1e3a4`)

Se revisaron y corrigieron TODOS los componentes pendientes con el bug de axios directo
y el bug de multer + AsyncLocalStorage.

**Backend corregido:**
- `backend/routes/facturas.js` — `getConfigSRI()` y `getConfigSRIEditable()` aceptan
  parámetro `db` opcional; rutas `/configuracion/logo`, `/firma`, `/sello`, `/certificado`
  ahora usan `req.prisma` en lugar del cliente global
- `backend/routes/clientes.js` — endpoint importar-excel usa `req.prisma`
- `backend/routes/proveedores.js` — endpoint importar-excel usa `req.prisma`
- `backend/routes/productos.js` — importacion/excel y importacion/xml usan
  `req.prisma.$transaction` (crítico: multer rompe AsyncLocalStorage)

**Frontend corregido (migración axios → api service):**
- `ListaLiquidaciones.jsx` y `FormLiquidacion.jsx`
- `ListaNotasDebito.jsx` y `FormNotaDebito.jsx`
- `ATS.jsx`
- `ReportesTributarios.jsx`

**Descubrimiento:** `declaraciones.js` NO filtra facturas por `estadoSri` → HISTORICO
ya incluido automáticamente en todos los cálculos del F104.

---

### Feature — Plan de Cuentas: importación avanzada (`4b5b59e`, `bb2ea49`, `2a03852`, `3340ac8`)

#### Reemplazar plan completo

Modo `reemplazar=true` en `POST /api/contabilidad/plan-cuentas/importar/ejecutar`:
- Elimina cuentas del plan actual que NO estén en el Excel importado
- Elimina en orden inverso (hijos antes que padres) para respetar FK
- Cuentas con movimientos en `asientos_contables_detalle` → NO se eliminan → van a `noEliminadas`
- Cuentas referenciadas en otras tablas → captura error FK → van a `noEliminadas`
- La respuesta incluye `eliminadas` (número) y `noEliminadas` (lista con razón)

#### Estado del sistema

Nuevo `GET /api/contabilidad/plan-cuentas/estado`:
```json
{ "planVacio": false, "tieneMovimientos": true, "totalCuentas": 86, "totalAsientos": 124 }
```
Determina si es el primer arranque, un plan sin uso, o un sistema en operación.

#### UI contextual — banner 3 estados

- **Inicio desde cero** (azul): ofrece instalar Plan AELA base o Plan NIIF Supercias
- **Plan sin movimientos** (verde): permite reemplazar el plan sin restricciones
- **En operación** (amarillo): solo permite agregar o eliminar cuentas sin movimientos

#### Drag & drop en importador

- Zona dropzone acepta arrastre directo de archivos .xlsx / .xls
- Feedback visual: escala 1.01, sombra verde, cambio de color al arrastrar
- Validación de extensión al soltar (rechaza PNG, PDF, etc.)
- Detección del `dragLeave` real ignorando hijos del dropzone

#### Auto-detección de formato externo

Si el Excel tiene columnas `Parent` y `Esdetalle` (formato de otro sistema contable):
- Se detecta automáticamente y transforma al formato AELA antes de parsear
- El código padre se extrae del campo `Parent`: `"NOMBRE CUENTA 1010101"` → `"1010101"`
- Ciclos en parent lookup detectados con `Set computing` (previene stack overflow)
- Tipos mapeados: `ACTIVOS→ACTIVO`, `PASIVOS→PASIVO`, `PATRIMONIO NETO→PATRIMONIO`, etc.

#### Plan de Cuentas NIIF — Superintendencia de Compañías (`3340ac8`)

308 cuentas del Catálogo Único de Cuentas (CUC) Supercias implementadas:
- Fuente: `docs/pdf/PLAN DE CUENTAS.pdf` (PDF oficial Supercias Ecuador)
- Script generador: `backend/scripts/generar_plan_supercias.js` (de uso único)
- Archivo resultante: `backend/utils/planCuentasSupercias.js`
- Endpoint: `POST /api/contabilidad/plan-cuentas/semilla-supercias`
- Mapeo SIGNO N (contra-cuentas) → naturaleza `CREDITO`; P/D → deriva del tipo
- Tipos: 1xx→ACTIVO, 2xx→PASIVO, 3xx→PATRIMONIO, 41/42/43→INGRESO, 51xx→COSTO, 52xx→GASTO
- Cuando el plan está vacío, el UI ofrece la elección: Plan AELA base vs Plan NIIF Supercias

---

### Fix — Detección automática de fila de encabezado en importación (`9ef752e`)

**Problema:** Archivos Excel con una fila de título arriba (ej. "PLAN DE CUENTAS —
CONSORCIO VIAL UCHUBAMBA") antes de los headers reales → `sheet_to_json` tomaba el
título como la única columna → todas las filas: código `undefined`, "Nombre requerido".

**Fix en `backend/utils/importarPlanCuentas.js`:**
- `parsearBuffer` ahora usa `{ header: 1 }` para obtener arrays crudos
- Escanea las primeras 10 filas para encontrar la primera que contenga un alias conocido
- Usa esa fila como encabezado, y las siguientes como datos
- Retorna `{ rows, columnas }` en lugar de solo `rows`

**NORM_MAP ampliado:** +20 aliases (no_cuenta, num_cuenta, denominacion, tipo_cuenta,
clasificacion_cuenta, padre, cta_mayor, cuentacontable, etc.)

**Diagnóstico visible en frontend:**
- Cuando todas las filas fallan, aparece cuadro amarillo:
  *"No se reconocieron las columnas del archivo. Columnas detectadas en tu Excel: X · Y · Z"*
- Guía al usuario a comparar con las columnas esperadas o descargar la plantilla

**Fix adicional:** eliminado `}` sobrante en `ContabilidadHub.css` (.conta-dropzone-hint)
que generaba error de sintaxis CSS silencioso.

---

### Documentación — Principios de diseño ERP contable

El usuario compartió 5 principios fundamentales para el diseño del módulo contable.
Guardados en `memory/feedback_erp_contabilidad_design.md` y resumidos aquí:

1. **Cuentas de control (no "cuentitis")** — El detalle por cliente/proveedor va en la
   tabla de entidades vinculada por ID, NO creando una cuenta por cada cliente.
2. **Tabla de mapeo SRI** — Enlazar código de retención/IVA → cuenta contable destino;
   asiento automático al registrar facturas de compra/venta.
3. **POS + inventario permanente** — Cada venta genera 2 asientos automáticos: uno de
   venta (Caja vs Ingresos + IVA) y uno de costo (Costo de Ventas vs Inventario).
4. **Centros de costo como dimensión** — Un solo plan de gastos (5.02.xx) con campo
   `centro_costo` dimensional; nunca duplicar cuentas por sucursal.
5. **Provisiones RRHH automáticas** — Al cerrar nómina, generar asiento de provisión
   para décimos, fondos de reserva e IESS patronal según ley ecuatoriana.

---

## 🔴 PENDIENTES CRÍTICOS — Verificar desde casa

### 1. Confirmar importación plan de cuentas con el Excel del Consorcio Vial

Volver a subir el mismo archivo Excel en:
`Contabilidad → Plan de Cuentas → Importar plan de cuentas desde Excel`

**Resultado esperado:**
- Si el archivo tenía fila de título arriba: ahora debe detectar las columnas reales
- Si las columnas tienen nombres distintos (ej. "Cuenta", "Denominación"): el cuadro
  amarillo mostrará exactamente los nombres detectados
- Compartir captura o los nombres de columnas detectados para ajuste final si sigue fallando

### 2. Confirmar pendientes sesión 2026-07-02 (aún sin verificar)

**a) Importar facturas históricas en producción**
- Verificar que Railway ejecutó `applySchemaFixes.js` y creó la columna `origenRegistro`
- Subir un Excel de prueba con 5-10 facturas históricas reales

**b) Buzón SRI ZIP/XML para PUPUCHAICELA**
- Confirmar que `ec0b57a` resolvió el FK violation al importar los 45 documentos ZIP

**c) Scraper SRI login**
- Log esperado al arrancar Railway: `[SRI] sriScraper.js build 2026-07-01 — incluye hash MD5+SHA-512`

**d) Gestión de Empresas — campos tipoContribuyente/repLegal/contadora**
- Editar cualquier empresa, llenar los 3 campos, guardar, recargar y verificar persistencia

---

## 🟡 PENDIENTES PRÓXIMAS SESIONES (backlog)

### Contabilidad — ERP design (alta prioridad)

**Tabla `sri_mapeo_cuentas`** (Alta)
- Nueva tabla: código retención SRI / porcentaje IVA → cuenta contable destino
- Asiento automático al registrar factura de compra o venta
- UI en Configuración → Contabilidad para gestionar el mapeo
- Afecta: `backend/routes/facturas.js`, `backend/routes/compras.js`

**POS → asientos contables automáticos** (Alta)
- Al cerrar cada venta POS: generar 2 asientos automáticos en tiempo real
- Requiere `precio_costo` disponible en líneas del pedido
- Integrar con `crearAsientoContable()` ya existente en `backend/utils/contabilidad.js`

**Centros de costo dimensionales** (Media)
- Agregar campo `centroCostoId` (nullable FK) en `asientos_contables_detalle`
- Nueva tabla `centros_costo` (id, nombre, codigo, empresaId, activo)
- UI para gestionar centros y asignarlos en registro de transacciones
- Filtros por centro de costo en reportes contables

**Módulo Nómina → asientos de provisión automáticos** (Baja)
- Al procesar nómina mensual: generar asiento de Gasto + Pasivo para cada empleado
- Provisiones: décimo tercero (1/12), décimo cuarto (SBU/12), fondos de reserva (8.33%)
- Afecta: `backend/routes/talento-humano.js` y la función de cierre de nómina

### General

- **AyudaSistema.jsx** — sección multiempresa/Admin Macro
- **App móvil**: logos reales (icon 1024×1024, splash 512×512), EAS build, APK
- **App móvil**: Bluetooth ESC/POS, escáner código de barras
- **Importar facturas de COMPRA históricas** (mismo patrón que ventas)
- **Panel admin SaaS** (tenants, planes, stats)
- **Pasarela de pagos** PayPhone/Stripe

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (railway + aela_lsac + aela_mprq)
```

**Archivos clave contabilidad:**

| Archivo | Responsabilidad |
|---------|----------------|
| `backend/routes/contabilidad.js` | Todos los endpoints contables |
| `backend/utils/importarPlanCuentas.js` | Parser Excel + auto-detección formato |
| `backend/utils/planCuentasBase.js` | Plan AELA base (para instalación inicial) |
| `backend/utils/planCuentasSupercias.js` | 308 cuentas CUC Supercias NIIF |
| `backend/utils/contabilidad.js` | `crearAsientoContable()` y utilidades |
| `frontend/src/components/Contabilidad/ContabilidadHub.jsx` | UI principal contabilidad |
| `frontend/src/components/Contabilidad/ContabilidadHub.css` | Estilos del módulo |

---

## Commits de hoy

| Commit | Descripción |
|--------|-------------|
| `4d1e3a4` | fix: auditoría sistemática multi-tenant en backend y frontend |
| `4b5b59e` | feat: reemplazar plan completo + endpoint estado + UI contextual |
| `bb2ea49` | feat: auto-detectar formato Excel externo + protección ciclos |
| `2a03852` | feat: drag & drop en importador plan de cuentas |
| `3340ac8` | feat: plan de cuentas NIIF Supercias 308 cuentas + semilla endpoint |
| `9ef752e` | fix: detección automática fila de encabezado + NORM_MAP ampliado + diagnóstico columnas |
