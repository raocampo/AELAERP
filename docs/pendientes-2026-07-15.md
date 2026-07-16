# AELA ERP — Sesión 2026-07-15

## Resumen ejecutivo

Sesión motivada por un requerimiento real: la empresa **PUCHAICELA** lleva contabilidad del
año 2023, período en el que la tarifa de IVA en Ecuador era **12%** (no 15%). El sistema
almacenaba toda la base gravada en `subtotal15` como un único campo catch-all, lo que generaba
errores en el ATS PDF (calculaba IVA 15% sobre datos del 2023), en el F104 (montos incorrectos)
y en el XML SRI (bloque `totalImpuesto` con tarifa equivocada).

**Commit**: `e15c737` — aplicado en Railway, migración confirmada en producción.

---

## Historial de tarifas IVA Ecuador (SRI oficial)

| Período                      | Tarifa | Norma                                              |
|------------------------------|--------|----------------------------------------------------|
| Dic 2001 – May 2016          | 12%    |                                                    |
| Jun 2016 – May 2017          | 14%    | Alza temporal por terremoto de 2016                |
| Jun 2017 – 21 abr 2024       | 12%    |                                                    |
| Desde 22 abr 2024            | 15%    | Ley Orgánica de Eficiencia Económica (RO Supl 535) |
| Desde abr 2024 (selectivo)   | 5%     | Materiales de construcción, medicamentos, etc.     |

**Regla de corte en el sistema**: `fechaEmision < '2024-04-22'` → 12%; `>= '2024-04-22'` → 15%.

---

## Cambios implementados (commit `e15c737`)

### 1. Migración de base de datos
**Archivo**: `backend/prisma/migrations/20260715000000_subtotal12_iva_historico/migration.sql`

- Añade columna `subtotal12 DECIMAL(14,2) NOT NULL DEFAULT 0` a las 3 tablas:
  - `facturas`
  - `facturas_compra`
  - `liquidaciones_compra`
- **Backfill histórico**: para registros con `fechaEmision < '2024-04-22'` que tengan
  `subtotal15 > 0` → mueve el valor a `subtotal12` y pone `subtotal15 = 0`.
  Esto corrige retroactivamente todos los datos ya subidos (2023, 2024 pre-abril).

### 2. Schema Prisma
**Archivo**: `backend/prisma/schema.prisma`

Añadido `subtotal12 Decimal @default(0) @db.Decimal(14, 2)` después de `subtotal5` en los
3 modelos (`facturas`, `facturas_compra`, `liquidaciones_compra`).

### 3. Generación XML SRI (`backend/utils/sri.js`)
Función `generarXMLFactura`:
- Acumula `subtotal12` en el reducer de líneas
- Genera bloque `<totalImpuesto>` con `<codigoPorcentaje>2</codigoPorcentaje>` (código SRI
  para 12%, según tabla 17 de la ficha técnica v2.26)
- `totalSinImpuestos` incluye `subtotal12`
- `subtotal0` se emite solo cuando los 3 subtotales gravados son 0

Función `generarXMLLiquidacionCompra`: mismos cambios + corrección de `IVA_TARIFA[ivaPct] ?? 0`
(antes sin fallback, podía causar `NaN` si el porcentaje no era reconocido).

**Tabla de códigos SRI** (ficha técnica v2.26, tabla 17):
| Tarifa | codigoPorcentaje |
|--------|-----------------|
| 0%     | '0'             |
| 5%     | '5'             |
| 12%    | '2'             |
| 15%    | '4'             |

### 4. Facturas de venta (`backend/routes/facturas.js`)
- Todos los selects: `subtotal12: true`
- Crear factura: `subtotal12: totales.subtotal12 || 0`
- Importar XML histórico: split 3 vías:
  ```js
  subtotal5  = ivaPct === 5                      ? subtotalGravado : 0
  subtotal12 = (ivaPct === 12 || ivaPct === 14)  ? subtotalGravado : 0  // 14% → bucket 12%
  subtotal15 = ivaPct === 15                     ? subtotalGravado : 0
  ```
  Nota: el IVA 14% del terremoto 2016 se mapea a bucket 12% porque no hay tarifa intermedia
  en el sistema; si se necesita distinguirlo en el futuro, se requiere un campo `subtotal14`.
- Endpoint resumen: `subtotal5` y `subtotal12` incluidos en reducers `totVentas`/`totCompras`/
  `totLiq` y en el response.

### 5. Facturas de compra (`backend/routes/compras.js`)
- 2 reducers de detalle: `pct === 12 || pct === 14` → `subtotal12`
- Create compra: `subtotal12: Number(totales.subtotal12.toFixed(2))`
- Todos los selects: `subtotal12: true`
- Aggregate `_sum`: `subtotal12: true`

### 6. Declaración F104 (`backend/routes/declaraciones.js`)
- Ventas: `ventasSubtotal12` acumulado; `ventasNetas12` calculado con prorrateo de notas de
  crédito (divisor incluye `subtotal12`)
- Compras: `comprasSubtotal12` acumulado
- Liquidaciones: `liqSubtotal12` acumulado
- Response F104:
  ```js
  ventas.subtotal12, ventas.subtotalNeto12
  compras.subtotal12, compras.liquidaciones.subtotal12
  ```

### 7. ATS XML y PDF (`backend/routes/ats.js`)
- XML: `baseImpGrav = sub5 + sub12 + sub15`; `baseGravada` en compras igual
- PDF talón resumen: columnas `BI T.12%` e `IVA 12%` añadidas (ajustadas a 523px totales)
  ```
  Cod.(26) | Transacción(82) | No.Reg.(42) | BI 0%(52) | BI T.5%(47) |
  BI T.12%(52) | BI T.15%(47) | BI No Obj.(32) | IVA 5%(45) | IVA 12%(52) | IVA 15%(46)
  ```

### 8. Frontend — FormFactura.jsx
- IVA_OPCIONES: añadida opción `{ valor: 12, label: '12%' }` entre 5% y 15%
- `mapearIva`: `tarifaIva === 12 || tarifaIva === 14 → 12`
- `calcularTotales`: `sub12`, `iva12` añadidos; filas de totales condicionales para 12%/15%

### 9. Frontend — ATS.jsx
- TabVentas (facturas y liquidaciones): columna "Base 12%" con totales en tfoot
- TabCompras: mini-card condicional "Base 12%", columna "Base 12%" en tabla, tfoot

### 10. Frontend — ReportesTributarios.jsx
- Resumen ventas/compras: filas condicionales "Base 12%" (y "Base 15%" también condicional)
- Tablas facturas/compras: columna "Base 12%", tfoot

---

## Verificado en producción

```
Railway log:
  Applying migration `20260715000000_subtotal12_iva_historico`
  All migrations have been successfully applied.
```

El usuario confirmó el log de Railway con la migración aplicada exitosamente.

---

## 🔴 VERIFICAR EN PRODUCCIÓN / NAVEGADOR

Todo el código se verificó estáticamente (`node -c` + lectura). Sin acceso a navegador ni DB
real en este entorno. Verificar con los datos reales de PUCHAICELA (2023):

1. **ATS 2023** — abrir ATS período 2023 → columnas "BI T.12%" e "IVA 12%" deben mostrar
   los montos correctos (≠ 0). Las columnas "BI T.15%" e "IVA 15%" deben ser 0 para ese año.
2. **PDF talón resumen ATS 2023** — pulsar "Imprimir PDF" → las 11 columnas deben caber sin
   desbordarse. Sección A ventas debe mostrar IVA 12% correcto.
3. **F104 2023** — abrir declaración enero-diciembre 2023 → `subtotalNeto12` debe reflejar
   la base de ventas gravadas al 12%; `compras.subtotal12` debe mostrar las compras gravadas
   al 12%; los valores al 15% deben ser $0.
4. **Factura de venta 2023** — abrir una factura emitida en 2023 → el campo IVA debe mostrar
   12% y el XML generado debe tener `<codigoPorcentaje>2</codigoPorcentaje>`.
5. **Nueva factura con IVA 12%** — crear una factura de prueba con un ítem al 12% → verificar
   que el totalizador muestra "Base 12%" y "IVA 12%" con los valores correctos.
6. **Reportes tributarios 2023** — abrir Reportes → columna "Base 12%" debe aparecer con
   valores; "Base 15%" debe ser $0 para ese año.

---

## 🟡 PENDIENTES — NO implementados aún

### Alta prioridad (afectan la contabilidad)

1. **Asientos contables con IVA 12%**
   El motor contable (`backend/utils/contabilidad.js`) tiene las funciones de asiento para
   compras y ventas. Actualmente calculan el IVA como `subtotal15 * 0.15` o leer el campo
   `totalIva` directamente. Con el backfill, los registros pre-2024 ya tienen `subtotal12`
   correcto, pero hay que verificar que el campo `totalIva` guardado en la factura también
   sea correcto (se calculó al momento de emisión/importación — si se importó mal, `totalIva`
   puede estar con el valor 15% aplicado a la base 12%).

   **Acción**: revisar una factura de compra de 2023 real → comparar `totalIva` guardado vs.
   `subtotal12 * 0.12`. Si difieren, hacer UPDATE corrigiendo `totalIva` para los registros
   afectados (similar al backfill ya hecho).

2. **Contabilidad — cuadre de asientos históricos**
   El usuario indicó: _"La contabilidad debe cuadrar, realizar todo lo que se debe realizar,
   esto se hace luego de lo que estás realizando."_

   Esto implica revisar si los asientos ya generados para facturas/compras de 2023 usan el
   IVA correcto (12%). Si los asientos se generaron antes del backfill con IVA 15%:
   - Opción A: regenerar los asientos afectados (función `regenerarAsiento` ya existe)
   - Opción B: crear un script de reparación retroactiva (similar al "Generar asientos
     faltantes" del commit `3a032cf`)

   **Esto es una sesión aparte** — requiere revisar los asientos existentes contra los
   totales de cada factura.

3. **IVA 14% (terremoto 2016)** — actualmente mapeado al bucket 12% por simplificación.
   Si PUCHAICELA tiene facturas de 2016-2017 con IVA 14%, la declaración F104 las mostrará
   en "Base 12%" (incorrecto formalmente, aunque el monto de IVA sería diferente).
   Solución futura: añadir `subtotal14` si hay clientes con operaciones de ese período.

### Media prioridad

4. **Declaración F104 — excluir gastos personales** — campo `esGastoPersonal` ya existe en
   DB, el backend los filtra, falta validación visual en la UI para que el usuario sepa
   cuántos están excluidos (aviso ya existe en el endpoint, falta mostrarlo en el frontend).

5. **F104 — desglose compras vs. liquidaciones** — actualmente se muestra el total combinado.
   El contador necesita ver facturas de compra separadas de liquidaciones de compra para
   conciliar con los documentos físicos.

6. **Notas de crédito recibidas de proveedores** — vista en Buzón SRI / módulo Compras
   (la nota de crédito emitida por el proveedor a favor de la empresa).

7. **Libro de bancos** — verificar contabilización de movimientos bancarios pendientes
   (puede haber movimientos del 2023 sin asiento contable).

---

---

## Parte 2 — Correcciones 2026-07-15 (segunda mitad de sesión)

### Fix: P2022 `subtotal12` en BDs de todos los tenants (`9a8e2ca`)

**Problema**: Railway aplica `prisma migrate deploy` solo contra la BD principal. Las BDs de
cada empresa (aela_lsac, aela_mprq, etc.) no reciben las migraciones de Prisma. Al arrancar
Railway después del commit `e15c737`, los tenants arrojaban:

```
The column `liquidaciones_compra.subtotal12` does not exist in the current database.
(prisma: P2022)
```

**Solución**: Añadir las instrucciones `ADD COLUMN IF NOT EXISTS` + backfill retroactivo al
array `FIXES` de `backend/scripts/applySchemaFixes.js`. Este script corre en cada startup de
Railway y conecta contra cada tenant activo en `aela_master.tenants`.

Entradas añadidas al final de `FIXES`:

```js
// IVA 12% histórico Ecuador (pre-2024-04-22) — campo subtotal12 (2026-07-15)
`ALTER TABLE "facturas"             ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
`ALTER TABLE "facturas_compra"      ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
`ALTER TABLE "liquidaciones_compra" ADD COLUMN IF NOT EXISTS "subtotal12" DECIMAL(14,2) NOT NULL DEFAULT 0`,
// Backfill retroactivo (idempotente):
`UPDATE "facturas"             SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0`,
`UPDATE "facturas_compra"      SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0`,
`UPDATE "liquidaciones_compra" SET "subtotal12" = "subtotal15", "subtotal15" = 0 WHERE "fechaEmision" < '2024-04-22' AND "subtotal15" > 0`,
```

---

### Feat: ATS PDF — rediseño completo del talón resumen (`16ab8ec`)

**Problema**: El talón PDF del ATS era compacto y sin identidad visual. El usuario solicitó:
logo oficial del SRI, mejor uso del A4, y formato parecido al documento de referencia del SRI.

**Logo**: Copiado de `UtilitariosSCFI/ATS/LogoSRI.png` a `backend/assets/LogoSRI.png`.
Referenciado desde `ats.js` como constante `LOGO_SRI` con fallback visual si no se encuentra.

**Constantes de layout A4**:
```js
const ML = 40, PW = 515, PAGE_MAX = 802;   // márgenes y ancho útil
const ROW_H = 18, COL_H = 24, SEC_H = 22, SUB_H = 20;
```

**Helpers PDFKit** con `lineBreak: false` (previene que el texto se corte dentro de una celda):
- `colHdr(cols)` — cabecera de columnas (font 7pt, bold)
- `dataRow(cols, values, bold)` — fila de datos (font 7.5pt)
- `totRow(cols, values)` — fila de totales (font 7.5pt, bold, fondo gris)

**Columnas finales** (suma exacta = 515pt):
```
Cod.(36) | Transacción(95) | No. Reg.(38) | BI 0%(46) | BI T.5%(44) |
BI T.12%(46) | BI T.15%(44) | No Obj.(35) | IVA 5%(35) | IVA 12%(42) | IVA 15%(54)
```

**Cabecera PDF**: logo SRI (110×78pt), título "ANEXO TRANSACCIONAL SIMPLIFICADO", empresa,
período, RUC, y línea de generación con hora Ecuador.

---

### Fix: Columnas ATS PDF — texto cortado en celdas (`1431827`)

**Problema** (reportado por el usuario vía screenshot):
- "TOTA L" — la palabra "TOTAL" se partía en dos líneas en la columna Cod. (demasiado angosta)
- "13923.46" — el número se desbordaba de la columna IVA 15% (muy estrecha)
- "BI No Obj." — la cabecera se wrapeaba a 2 líneas

**Soluciones**:
- `lineBreak: false` en todos los helpers → PDFKit no intenta ajustar texto, simplemente lo corta al ancho
- Cod.: 28 → 36pt (suficiente para "TOTAL" en bold 7.5pt)
- IVA 15%: 38 → 54pt (suficiente para 8 dígitos "13923.46" + padding)
- Cabecera "BI No Obj." → renombrada a "No Obj." (7 chars) + columna 33 → 35pt

---

### Fix: Zona horaria Ecuador en todos los PDFs y logs (`9a883e7`)

**Problema**: Railway corre en servidores UTC. `new Date().toLocaleString('es-EC')` sin
timezone usaba UTC, mostrando hora incorrecta. Ejemplo: el usuario reportó
`"16/7/2026, 1:52:55 a. m."` cuando en Ecuador eran las `20:54 del 15/07/2026`.

**Impacto**: Afectaba la auditoría y el timestamp de generación de PDFs, autorización SRI.

**Solución A** — utilidades centralizadas (`backend/utils/fechas.js` nuevo):
```js
const TZ_EC = 'America/Guayaquil';
const formatFechaHora = (d = new Date()) =>
  new Date(d).toLocaleString('es-EC', { timeZone: TZ_EC });
const fechaHoyEC = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: TZ_EC }); // YYYY-MM-DD
module.exports = { TZ_EC, formatFechaHora, fechaHoyEC };
```

**Solución B** — reemplazo global en 9 archivos del backend:
`toLocaleString('es-EC')` → `toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })`

Archivos afectados:
- `backend/routes/compras.js`
- `backend/routes/configuracionSistema.js`
- `backend/routes/contabilidad.js`
- `backend/routes/facturas.js`
- `backend/routes/inventario.js`
- `backend/routes/retenciones-recibidas.js`
- `backend/routes/retenciones.js`
- `backend/utils/sri.js`
- `backend/routes/ats.js`

**IMPORTANTE — qué NO se cambió**:
`toLocaleDateString` (sin hora) **no** se modificó. Las fechas tipo `fechaEmision` se almacenan
como medianoche UTC en PostgreSQL. Añadirles timezone Ecuador las desplazaría al día anterior
(UTC 00:00 − 5h = día anterior 19:00). Solo `toLocaleString` (fecha+hora) necesita el timezone.

---

## 🔴 VERIFICAR EN PRODUCCIÓN — Parte 2

1. **ATS PDF rediseñado** — generar PDF ATS para un período con datos reales (ej. 2023):
   - Logo SRI visible en la esquina superior izquierda
   - 11 columnas caben sin corte ni wrapping
   - "TOTAL" aparece en una sola línea en la columna Cod.
   - Números grandes (ej. 92.822,77) visibles sin corte en columna IVA 15%

2. **Hora Ecuador correcta en PDFs** — tras el próximo deploy de Railway, la línea de
   generación debe mostrar hora Ecuador (UTC-5), no UTC. Verificar comparando con la hora
   local del equipo (Ecuador = servidor − 5h).

3. **Tenants sin P2022** — verificar en los logs de Railway que ningún tenant arroja el
   error `P2022` (column does not exist) al inicio.

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway
```

**Archivos modificados en esta sesión (commit `e15c737`):**

| Archivo | Cambio |
|---------|--------|
| `backend/prisma/migrations/20260715000000_subtotal12_iva_historico/migration.sql` | Nuevo — ADD COLUMN + backfill |
| `backend/prisma/schema.prisma` | `subtotal12` en 3 modelos |
| `backend/utils/sri.js` | XML bloque IVA 12% en facturas y liquidaciones |
| `backend/routes/facturas.js` | Select, create, import, resumen |
| `backend/routes/compras.js` | 2 reducers, create, select, aggregate |
| `backend/routes/declaraciones.js` | F104 con subtotal12 en ventas/compras/liquidaciones |
| `backend/routes/ats.js` | PDF con columnas IVA 12%, XML baseImpGrav |
| `frontend/src/components/Facturacion/FormFactura.jsx` | Opción 12% en select IVA, totalizador |
| `frontend/src/components/Facturacion/ATS.jsx` | Columna Base 12% en ventas y compras |
| `frontend/src/components/Facturacion/ReportesTributarios.jsx` | Fila y columna Base 12% |
