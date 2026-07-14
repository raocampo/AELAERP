# AELA ERP — Sesión 2026-07-13/14 (continuación — parte 4)

## Resumen ejecutivo

Continuación directa de `docs/pendientes-2026-07-13-parte3.md` (mismo hilo de trabajo,
cruzó medianoche). Esa parte ya cubrió 2 bugs críticos (CxC roto, WebServices API roto) —
**no se repiten aquí**. Esta parte cubre: 3 utilidades nuevas para cargar contabilidad
atrasada de un cliente real (Comercial S&S / Daniel Puchaicela), una pestaña de importación
nueva en Retenciones Recibidas, y **2 bugs de producción confirmados con logs reales de
Railway** mientras el cliente probaba Configuración de cuentas por referencia.

Commits: `f253e25` `57a9c63` `f3a7126` `2627c2b`.

---

## 🔴 Bugs de producción corregidos (confirmados con logs de Railway)

### A — Configuración de cuentas por referencia no guardaba (`f3a7126`)

**Síntoma reportado**: toast "Error al guardar la configuración de referencias" en
Contabilidad → Plan de Cuentas → Configuración de referencias.

**Causa raíz confirmada con logs de Railway** (`PrismaClientKnownRequestError P2000`):
la columna `codigoReferencia` era `VARCHAR(20)`, pero el catálogo de nómina/general tiene
códigos de hasta 34 caracteres:
- `INVENTARIO_TRANSFERENCIAS_TRANSITO` (34)
- `PROV_FONDOS_RESERVA_PAGAR` / `PROV_DECIMO_TERCERO_PAGAR` (25)
- `GASTO_PROV_FONDOS_RESERVA` / `GASTO_PROV_DECIMO_TERCERO` (25)
- `GASTO_APORTE_PATRONAL` (21), `GANANCIA_NETA_EJERCICIO` (23), etc.

Cualquier intento de mapear una de esas referencias a una cuenta fallaba en Postgres al
truncar. **Fix**: columna ampliada a `VARCHAR(50)` — migración `20260713020000_ampliar_codigo_referencia`
+ entrada en `applySchemaFixes.js` (para tenants existentes) + el helper de auto-reparación
que se agregó en el mismo commit. Verificado localmente con el código real más largo del
catálogo (`GANANCIA_NETA_EJERCICIO`) — guarda sin error.

**Hallazgo adicional en la misma investigación** — `PUT /configuracion-referencias/:categoria`
no tenía el mismo respaldo que `GET` para cuando la tabla aún no existe en un tenant (algunos
tenants no habían recibido el `applySchemaFixes.js` con esa tabla todavía). Ahora el PUT
también se auto-repara (crea tabla + índices si faltan) antes de guardar.

### B — `auditoria.userAgent`/`ip` faltantes en tenants antiguos (`f3a7126`)

Confirmado con logs de Railway (tenants `lsac` y `sys`): `Invalid prisma.auditoria.create()
— The column userAgent does not exist`. El modelo tenía estas columnas en `schema.prisma`
desde hace tiempo, pero `applySchemaFixes.js` nunca tuvo una entrada para ellas — los
tenants provisionados antes de que se agregaran nunca las recibieron.

`registrarAuditoria()` nunca deja que esto interrumpa la operación principal (tiene su
propio try/catch), así que no rompía nada visible para el usuario — pero sí generaba una
línea de error en los logs de Railway en **cada** acción auditada de esos tenants. Agregado
`CREATE TABLE IF NOT EXISTS` + `ALTER COLUMN IF NOT EXISTS` para ambas columnas.

---

## Features nuevos

### 1 — Tres utilidades para cargar contabilidad atrasada (`f253e25`)

Motivadas por un cliente real (Daniel Puchaicela / Comercial S&S) con contabilidad
atrasada desde junio 2023. Archivos de origen en `UtilitariosSCFI/` (fuera del repo).

**a) `backend/scripts/convertirComprasHistoricasSRI.js`** — el cliente tenía un Excel de
22 hojas (una por mes, junio 2023 – abril 2025) exportado línea-por-línea del SRI
("Comprobantes Recibidos"), con **hasta 8 layouts de columnas distintos** entre hojas
(cambia con el tiempo: aparece/desaparece "Tipo Id. Receptor", el desglose de IVA
0%/5%/15% se reporta distinto). El script:
- Normaliza encabezados con variantes de puntuación/mayúsculas.
- Agrupa líneas en facturas por: clave de acceso (si existe) → establecimiento+ptoEmi+secuencial
  (parseado de la clave de acceso, posiciones estándar del SRI) → fecha de autorización →
  fecha de emisión, en ese orden de confianza.
- Infiere la tarifa de IVA desde el monto real (no confía en catálogos de código SRI que
  cambiaron con el tiempo).
- **Por defecto combina todo en la menor cantidad de archivos posible** (límite real de
  1000 filas por importación que ya valida `routes/compras.js`) — el archivo real del
  cliente (17,034 líneas → 1983 facturas) se convirtió en **solo 2 archivos** en vez de 22.
  Flag `--por-mes` para el modo anterior (un archivo por hoja).
- No escribe en la BD — genera `.xlsx` en el formato exacto de "Importar Compras
  Históricas", para pasar por el asistente ya existente (con su propio preview).
- **Verificado**: los 2 archivos combinados pasan 0 errores contra el endpoint real
  `POST /api/compras/importar/preview`.

**b) `backend/scripts/importarRetencionesRecibidasExcel.js`** + **`backend/utils/importarRetencionesRecibidas.js`**
— no existía ninguna vía de Excel para `retenciones_recibidas` (solo XML del Buzón SRI).
El "LISTADO DE RETENCIONES" que exporta el SRI ya trae fila=comprobante con clave de
acceso real — se mapea 1:1 reutilizando `crearAsientoRetencionRecibida` (misma función que
usa el Buzón SRI). Los 3 archivos del cliente (2023/2024/2025) no necesitaron conversión —
ya vienen en el formato correcto.

**c) `backend/scripts/importarFacturasVentaXML.js`** + **`backend/utils/importarFacturasVentaXML.js`**
— el cliente tenía a mano los XML autorizados de sus 35 facturas de venta (descargados de
srienlinea.sri.gob.ec). Parsea `<factura>` con `fast-xml-parser`, infiere tarifa de IVA
desde el monto real, y crea el registro con el mismo criterio que "Importar históricas":
`estadoSri='AUTORIZADO'`, asiento vía `crearAsientoFacturaAutorizada` con fecha real,
`claveAcceso` como llave de idempotencia.

Los 3 scripts corren en modo **dry-run por defecto** (`--ejecutar` para escribir de verdad),
y usan el `DATABASE_URL` que tenga `backend/.env` en ese momento.

### 2 — Pestaña "Importar desde Excel" en Retenciones Recibidas (`57a9c63`)

La utilidad (a) de arriba se promovió a feature real de la app — ya no es solo un script:
- `backend/utils/importarRetencionesRecibidas.js` compartido entre la ruta HTTP y el script
  (una sola implementación, no dos divergentes).
- `GET/POST /api/retenciones-recibidas/importar/*` (plantilla, preview, ejecutar) — mismo
  patrón que Compras/Facturas históricas.
- Pestañas nuevas en `ListaRetencionesRecibidas.jsx`: "📋 Listado" / "⬆ Importar desde Excel"
  — mismo wizard de 4 pasos que ya existía para Compras (reutiliza su CSS).
- **Verificado end-to-end vía HTTP real** (login con JWT real, no solo `node -c`): plantilla,
  preview y ejecutar — 13 retenciones reales creadas con su asiento, limpiadas después.

### 3 — Importar Históricas (ventas) acepta XML autorizados, no solo Excel (`2627c2b`)

La utilidad (c) de arriba también se promovió a feature real — el cliente no encontraba
cómo cargar los XML porque solo existía como script.
- Toggle "📊 Desde Excel" / "🗂 Desde XML autorizados (.zip)" en `ImportarFacturasHistoricas.jsx`
  — mismo wizard, mismos pasos, cambia el origen de los datos.
- `POST /api/facturas/importar/xml-preview` y `/xml-ejecutar` — reusan
  `utils/importarFacturasVentaXML.js` + `adm-zip` para leer el `.zip` en memoria.
- `adaptarDatosXmlAPreview()` normaliza el resultado del parser XML al mismo shape que ya
  consume la tabla de vista previa — cero cambios en la tabla del frontend.
- **Verificado end-to-end vía HTTP real** con los 35 XML reales del cliente: preview 35/35
  válidas, ejecutar 35/35 importadas con `asientoOk: true`, limpiado después.

---

## 🔴 VERIFICAR MAÑANA EN PRODUCCIÓN

### Prioridad alta — pediste tú mismo las pruebas hoy
1. **Configuración de cuentas por referencia** — Contabilidad → Plan de Cuentas →
   Configuración de referencias → asignar una cuenta a una referencia de **Nómina** o
   **General** (las que tienen códigos largos, ej. "Ganancia neta del ejercicio" o
   "Aporte patronal") → Guardar. Antes fallaba siempre con estas; debe guardar sin error.
2. **Importar retenciones desde Excel** — Retenciones Recibidas → pestaña "⬆ Importar desde
   Excel" → sube uno de los 3 archivos reales del cliente (o la plantilla) → confirma que
   aparecen en el listado con su asiento contable.
3. **Importar ventas desde XML** — Ventas → Importar históricas → modo "🗂 Desde XML
   autorizados (.zip)" → sube el .zip de XML del cliente → confirma que las facturas
   aparecen con estado "Autorizado" y su asiento en el Libro Diario.
4. **Cargar la contabilidad atrasada real del cliente** — cuando confirmes que 1-3
   funcionan, usar los archivos ya generados en `UtilitariosSCFI/compras-listas-para-importar/`
   (2 lotes) + los 3 Excel de retenciones + el .zip de XML de ventas para cargar de verdad
   la contabilidad de Comercial S&S / Daniel Puchaicela. **Esto sí escribe datos reales —
   avísame antes si quieres que lo acompañe.**

### Prioridad media — heredado de `pendientes-2026-07-13-parte3.md`, aún sin confirmar
5. **Cuentas por Cobrar → Vigentes** — debe mostrar facturas reales por primera vez (bug
   `estadoSri` corregido esa parte).
6. **WebServices API con AVALAB** — generar API key de prueba desde SuperAdmin y hacer un
   POST real a `/api/ext/v1/facturas` antes de conectar AVALAB de verdad.
7. Confirmar en Railway que existen `SUPER_ADMIN_KEY`, `PAYPHONE_*`, `BANCO_*` si se van a
   usar esas funciones de pago de suscripción.

---

## Contexto técnico

```
Repo:     github.com/raocampo/AELAERP  rama: main
Commits:  f253e25 · 57a9c63 · f3a7126 · 2627c2b
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
Cliente real con contabilidad atrasada: Comercial S&S (Daniel Ramiro Puchaicela Abendaño)
  RUC/cédula 1104196546 — archivos de origen en UtilitariosSCFI/ (fuera del repo git)
```

**Archivos nuevos/modificados en esta parte:**

| Archivo | Cambio |
|---------|--------|
| `backend/prisma/schema.prisma` | `codigoReferencia` VARCHAR(20)→VARCHAR(50) |
| `backend/prisma/migrations/20260713020000_ampliar_codigo_referencia/` | Migración del cambio anterior |
| `backend/scripts/applySchemaFixes.js` | Fix `codigoReferencia`, fix tabla `auditoria` completa |
| `backend/routes/contabilidad.js` | PUT configuracion-referencias se auto-repara; catch expone `error.code` |
| `backend/scripts/convertirComprasHistoricasSRI.js` | Nuevo — conversor multi-hoja SRI → plantilla AELA |
| `backend/scripts/importarRetencionesRecibidasExcel.js` | Nuevo (CLI) — ahora usa el util compartido |
| `backend/utils/importarRetencionesRecibidas.js` | Nuevo — validación/plantilla compartida CLI+HTTP |
| `backend/routes/retenciones-recibidas.js` | +3 rutas `/importar/*` |
| `frontend/src/components/Facturacion/ImportarRetencionesRecibidas.jsx` | Nuevo — wizard de importación |
| `frontend/src/components/Facturacion/ListaRetencionesRecibidas.jsx` | +pestañas Listado/Importar |
| `frontend/src/components/Facturacion/ListaRetenciones.css` | +estilos de pestañas |
| `backend/scripts/importarFacturasVentaXML.js` | Nuevo (CLI) |
| `backend/utils/importarFacturasVentaXML.js` | Nuevo — parser de `<factura>` XML autorizado |
| `backend/routes/facturas.js` | +3 rutas `/importar/xml-*` |
| `frontend/src/components/Facturacion/ImportarFacturasHistoricas.jsx` | +modo XML (.zip) |

**Verificación**: todo lo de esta parte se probó contra `scfi_dev` real vía HTTP con JWT
real (login simulado, no solo `node -c`) — plantilla/preview/ejecutar de cada feature,
creando registros reales y sus asientos contables, limpiando después. Los 2 bugs de
producción (P2000 y auditoria) se reprodujeron localmente antes de corregir (se borró la
columna/tabla a propósito) y se confirmó que el fix los resuelve.
