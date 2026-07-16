# AELA ERP — Sesión 2026-07-16

## Resumen ejecutivo

Reporte del cliente **PUCHAICELA**: el sistema "no está clasificando el IVA 5% y 15%".
Investigación encontró que el problema **no** está en el backend de facturas/compras
normales (que ya clasifica bien 0/5/12/15 desde el commit `e15c737` del 2026-07-15), sino
en dos formularios de captura manual y en el PDF del ATS, que quedaron desactualizados
tras ese cambio.

---

## Bug 1 — `FormCompra.jsx` (Factura de compra manual)

El select de IVA por línea solo ofrecía **0% y 15%** — no era posible elegir 5% ni 12% al
registrar una compra manual. Además, el resumen en pantalla metía cualquier línea con IVA
> 0% (5%, 12% o 15%) bajo un único total "Subtotal 15%".

**Nota importante**: el backend (`backend/routes/compras.js`) sí clasificaba correctamente
5/12/15 al guardar — el bug era solo de captura y visualización en el formulario, no de
persistencia. Aun así, sin la opción 5% en el select, un usuario nunca podía registrar
correctamente una compra con ese IVA.

**Corregido** (`frontend/src/components/Compras/FormCompra.jsx`):
- Select de IVA: agregadas opciones 5% y 12%
- Resumen: bucket separado `subtotal5`/`subtotal12`/`subtotal15`, con filas condicionales
  en pantalla (solo se muestran si tienen monto > 0)

---

## Bug 2 — `FormLiquidacion.jsx` + `liquidaciones_compra` (más grave)

Liquidación de compra (documento tipo 03, para proveedores no obligados a facturar) tenía
el mismo problema pero más profundo — **nunca existió soporte real para 5% en toda la
cadena**:

1. **Frontend**: select solo 0%/15%; `calcLinea` calculaba IVA solo si `porcentajeIva === 15`
   (una línea a 5% o 12% guardaba IVA = 0).
2. **Schema/BD**: la tabla `liquidaciones_compra` nunca tuvo columna `subtotal5` (sí tenía
   `subtotal12` desde ayer, pero tampoco se estaba persistiendo — ver Bug 2b).
3. **`backend/utils/sri.js` → `generarXMLLiquidacionCompra`**: el reducer de líneas solo
   sumaba `ivaPct === 0|12|15`, ignorando `=== 5` por completo. Una línea al 5% quedaba
   fuera de `totalSinImpuestos`/`importeTotal` y el XML nunca generaba el bloque
   `<totalImpuesto>` con `codigoPorcentaje=5` — el valor del documento real enviado al SRI
   quedaba subestimado.
4. **`backend/routes/liquidacionesCompra.js`** (POST /): solo persistía `subtotal0` y
   `subtotal15` — **tampoco guardaba `subtotal12`** pese a que `sri.js` ya lo calculaba
   (bug independiente, arrastrado desde la migración de ayer, nunca conectado end-to-end).

**Corregido**:
- Nueva migración `backend/prisma/migrations/20260716000000_subtotal5_liquidaciones_compra/`
  — `ADD COLUMN "subtotal5"`. Sin backfill: como el formulario nunca permitió 5%/12% ni el
  cálculo de IVA los soportaba, no puede haber datos previos en ese rango que reubicar.
- `backend/prisma/schema.prisma`: campo `subtotal5` en `liquidaciones_compra`.
- `backend/scripts/applySchemaFixes.js`: `ADD COLUMN IF NOT EXISTS "subtotal5"` para que
  llegue también a las BDs de cada tenant (no solo la principal — mismo patrón que ayer).
- `backend/utils/sri.js`: `generarXMLLiquidacionCompra` ahora acumula `subtotal5`, la
  incluye en `totalSinImpuestos`/`importeTotal`, genera el bloque XML `codigoPorcentaje=5`,
  y la retorna en `totales`.
- `backend/routes/liquidacionesCompra.js`: el POST ahora persiste `subtotal5` **y**
  `subtotal12` (antes ninguno de los dos llegaba a la BD correctamente).
- `frontend/FormLiquidacion.jsx`: select con 5%/12% agregadas; `calcLinea` calcula IVA con
  el porcentaje real de la línea (no hardcoded a 15%); resumen con filas condicionales
  5%/12%; etiqueta "IVA 15%" → "IVA" (ya no es solo 15%).

---

## Bug 3 — ATS: reportes y PDF nunca sumaban el 5% de liquidaciones

Aun antes de que existiera la columna en BD, el código de ATS ya tenía los campos `bt5`/
`iva5` declarados para liquidaciones pero **nunca los llenaba** — quedaban en 0 aunque el
resto del sistema sí soportara 5%.

**Corregido** (`backend/routes/ats.js`):
- `vLiq.bt5`/`vLiq.iva5` ahora se acumulan desde `l.subtotal5`
- `vTotBt5`/`vTotIva5` (totales combinados ventas) ahora suman también la parte de
  liquidaciones (antes solo tomaban de facturas)
- **PDF talón resumen** — la fila `LIQUIDACIÓN DE COMPRA` tenía **hardcodeado `'0.00'`** en
  las columnas "BI T.5%" e "IVA 5%" en vez de usar el valor real calculado. Este es
  probablemente el síntoma más visible que vio el cliente en el documento impreso.
- `select` de liquidaciones en `/preview` ampliado con `subtotal5: true`

**Frontend** (`frontend/src/components/Facturacion/ATS.jsx`): la tabla de "Liquidaciones de
Compra emitidas" no tenía columna "Base 5%" (sí la tenía la tabla de Facturas). Agregada,
con su columna en el `tfoot` de totales.

---

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `backend/prisma/migrations/20260716000000_subtotal5_liquidaciones_compra/migration.sql` | Nuevo — `ADD COLUMN subtotal5` |
| `backend/prisma/schema.prisma` | `subtotal5` en modelo `liquidaciones_compra` |
| `backend/scripts/applySchemaFixes.js` | `ADD COLUMN IF NOT EXISTS subtotal5` para tenants |
| `backend/utils/sri.js` | `generarXMLLiquidacionCompra`: subtotal5 en cálculo, XML y retorno |
| `backend/routes/liquidacionesCompra.js` | POST persiste `subtotal5` y `subtotal12` |
| `backend/routes/declaraciones.js` | F104: `liqSubtotal5` en compras.liquidaciones |
| `backend/routes/ats.js` | `vLiq.bt5`/`iva5`, PDF fila liquidación sin hardcode, select con subtotal5 |
| `frontend/src/components/Compras/FormCompra.jsx` | Select IVA 5%/12%, resumen por tarifa |
| `frontend/src/components/Facturacion/FormLiquidacion.jsx` | Select IVA 5%/12%, `calcLinea` genérico, resumen por tarifa |
| `frontend/src/components/Facturacion/ATS.jsx` | Columna "Base 5%" en tabla de liquidaciones |

---

## Verificado en este entorno

- `node -c` sin errores en los 5 archivos backend editados
- `npx prisma validate` — schema válido
- `npx vite build` — build de frontend exitoso sin errores

## 🔴 Pendiente de verificar en producción / navegador

1. **Registrar una compra manual con línea al 5%** (FormCompra) → el select debe ofrecer
   la opción y el resumen debe mostrar "Subtotal 5%" por separado.
2. **Emitir una liquidación de compra con línea al 5%** (FormLiquidacion) → el IVA de esa
   línea debe calcularse (no quedar en 0), el resumen debe mostrar "Subtotal 5%", y el XML
   generado debe incluir el bloque `codigoPorcentaje=5`.
3. **Migración `20260716000000_subtotal5_liquidaciones_compra`** aplicada en Railway (BD
   principal vía `prisma migrate deploy`) y en las BDs de tenants (vía `applySchemaFixes.js`
   al arrancar) — confirmar en logs que no hay error `P2022` para `liquidaciones_compra`.
4. **PDF ATS con una liquidación al 5%** → columna "IVA 5%" en la fila "LIQUIDACIÓN DE
   COMPRA" debe mostrar el valor real, no "0.00".
5. Confirmar con el cliente (Puchaicela) si el reporte original de "IVA 5%/15% no se
   clasifica" era sobre compras normales, liquidaciones, o el PDF del ATS — para saber cuál
   de los tres bugs corregidos era el que estaban viendo.
