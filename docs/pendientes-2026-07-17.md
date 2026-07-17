# AELA ERP — Sesión 2026-07-17

## 🟢 PARA RETOMAR MAÑANA DESDE LA OFICINA — checklist rápido

Todo lo de esta sesión ya está en `main` (commit `07b572b`), verificado localmente contra
`scfi_dev`, pero **nada de esto ha tocado producción todavía**. Orden sugerido:

1. **Desplegar a Railway** (backend) — el deploy normal ya corre `prisma migrate deploy` +
   `applySchemaFixes.js` al arrancar, así que las migraciones `subtotalNoObjeto` y
   `tipoComprobante`, y el fix de `negocioPopular`, deberían aplicarse solos. Revisar logs
   de arranque en Railway para confirmar que no hay `P2022` (columna faltante) en ninguna
   BD de tenant.
2. **Desplegar frontend a Vercel** — cambios en `FormCompra.jsx` y `ATS.jsx`.
3. **Preguntar al cliente tres cosas puntuales** (no se pudieron confirmar sin hablar con él):
   - ¿Su reporte de "otras compras exentas/no objeto" era sobre **compras manuales**
     (`FormCompra`, ya cubierto) o sobre una **carga masiva/Excel histórica** (NO cubierto
     esta sesión — ver punto 1 de pendientes abajo)?
   - ¿Tiene marcado **"Negocio Popular"** en Configuración SRI de su empresa? Si no, las
     notas de venta que él **emite** no le van a aparecer en el ATS (es el gate
     intencional) y hay que activarlo con él.
   - ¿Tiene compras viejas ya registradas con una nota de venta de proveedor, que quedaron
     mal clasificadas como factura antes de este fix? Si son pocas, se corrigen editándolas
     una por una; si son muchas, avisar para armar un script puntual.
4. **Probar en producción con datos reales del cliente**:
   - Registrar una compra con la nueva opción de línea "No objeto / Exento", generar el
     talón resumen ATS del mes y confirmar que la columna "No Obj." ya no sale en 0.00.
   - Registrar una compra marcada como **"🧾 Nota de Venta (proveedor RIMPE)"** y confirmar
     que en el talón resumen aparece como fila separada `02 NOTA DE VENTA` en COMPRAS.
   - Si el cliente es Negocio Popular, generar el ATS de un mes con notas de venta
     **emitidas** por él y confirmar que aparecen en VENTAS.
5. Ver la sección **"🔴 Pendiente de verificar en producción"** al final de este documento
   para el detalle completo de los puntos abiertos.

**Actualización misma noche**: el cliente aclaró que las notas de venta que le importan no
son solo las que él emite (RIMPE Negocio Popular, Feature 2) sino también las que **recibe
de sus proveedores** y registra como compra — esas también deben ir al ATS correctamente
clasificadas. Ver **Feature 3** más abajo, ya implementada y verificada igual que las otras
dos.

---

## Resumen ejecutivo

Reporte del cliente: **"el sistema no clasifica las otras compras como exentas o no
objeto de Iva. también debe haber una configuración para el talón resumen salgan
[también] las de rimpe que son notas de venta."**

Se investigó contra la documentación oficial del SRI (Ficha Técnica del Anexo
Transaccional Simplificado, descargada por el cliente y por esta sesión) para
confirmar que ambos reclamos correspondían a huecos reales — no a percepciones —
y se implementaron las dos features.

---

## Investigación SRI (antes de tocar código)

### 1. "No objeto de IVA" / "Exento" ≠ tarifa 0%

La Ficha Técnica del ATS (tabla de campos de `detalleCompras`/`detalleVentas`)
confirma **3 campos mutuamente distintos** por documento:

| Campo XML       | Significado                                  |
|------------------|-----------------------------------------------|
| `baseNoGraIva`   | Base Imponible **No objeto de IVA**            |
| `baseImponible`  | Base Imponible **tarifa 0%** IVA               |
| `baseImpGrav`    | Base Imponible tarifa IVA **diferente de 0%**  |

Y el propio manual advierte: *"los campos Base Imponible No objeto de IVA, Base
Imponible Tarifa 0% y Base Imponible tarifa IVA diferente de 0% no pueden tener
a la vez registrado 0.00"* — son categorías separadas, no intercambiables.

`backend/utils/sri.js` ya tenía el mapeo de códigos SRI (tabla 17) preparado pero
nunca conectado a nada:
```js
const IVA_CODIGO = {
  0: '0', 5: '5', 12: '2', 15: '4',
  'noObjeto': '6', 'exento': '7',   // ← definidos, jamás usados
};
```
Confirmado: el sistema nunca tuvo forma de capturar "no objeto"/"exento" en
compras — toda base sin IVA caía en `subtotal0` (tarifa 0%), una categoría legal
distinta. El PDF del talón resumen ya tenía la columna **"No Obj."** dibujada
desde la sesión del 2026-07-14 (`a816eb0`), pero **hardcodeada a `'0.00'`** en
todas las filas — el mismo patrón de bug que "IVA 5%" tuvo hasta ayer.

### 2. Notas de Venta (RIMPE Negocio Popular) nunca entraban al ATS

Confirmado con la Ficha Técnica (Tabla 4 — Tipos de comprobante autorizados):
"Nota o boleta de venta" es tipo de comprobante **código `02`**, aceptado en el
ATS. El manual también aclara: *"Las notas de venta que no tienen desglosado el
IVA, pero son productos o servicios gravados... deben desglosar la base
imponible gravada, base imponible tarifa 0% y el IVA"* — es obligación del
emisor reportarlas, no un adorno opcional.

En el código: `notas_venta` (módulo RIMPE Negocio Popular, ver
`backend/routes/notasVenta.js`) nunca aparecía en `ats.js` — ni en `/preview`,
ni en `/exportar` (XML), ni en `/exportar/pdf` (talón resumen). Una empresa
Negocio Popular que solo emite notas de venta declaraba un ATS con **0 ventas**,
sin importar cuánto facturara.

`configuracion_sri.negocioPopular` ya existía como checkbox en Configuración SRI
(con el comentario en el schema: *"true = habilitado para nota de venta Lite"*)
pero solo se usaba para imprimir la leyenda RIMPE en PDFs — nunca para decidir
qué entra al ATS. Es la "configuración" que pidió el cliente: ahora sí controla
si las notas de venta se incluyen en el talón resumen.

**Decisión de diseño**: `FormNotaVenta.jsx` ya declara explícitamente *"(Nota de
venta sin IVA — RIMPE)"* y el RIDE imprime *"Documento no válido para crédito
tributario de IVA"` — es un diseño deliberado del sistema, no un descuido. Se
respetó: las notas de venta se reportan íntegramente como base imponible tarifa
0% (`baseImponible`), sin desglose de IVA. Si en la práctica el negocio popular
del cliente vende ítems que sí deberían ir a tarifa gravada, eso requiere
capturar el IVA por línea en notas de venta — cambio de alcance mayor, fuera de
esta sesión, y no lo pidió el cliente.

---

## Implementado

### Feature 1 — Clasificación "No objeto / Exento de IVA" en compras

- **Migración** `20260717000000_subtotal_no_objeto_compras`: nueva columna
  `subtotalNoObjeto` en `facturas_compra`. Sin backfill — imposible distinguir
  retroactivamente qué parte de `subtotal0` era realmente "no objeto/exento".
- `backend/scripts/applySchemaFixes.js`: mismo `ADD COLUMN IF NOT EXISTS` para
  las BDs de cada tenant (patrón ya establecido para `subtotal5`/`subtotal12`).
- `backend/prisma/schema.prisma`: campo `subtotalNoObjeto` en `facturas_compra`.
- `backend/routes/compras.js`: nuevo flag `esNoObjetoIva` por línea de detalle
  (`normalizarDetalle`); ambos endpoints de creación (POST `/` manual e
  importación Excel) enrutan esas líneas al nuevo bucket en vez de `subtotal0`,
  y nunca calculan IVA sobre ellas.
- `frontend/src/components/Compras/FormCompra.jsx`: el select de IVA por línea
  ahora incluye la opción **"No objeto / Exento"**; el resumen muestra el total
  por separado (fila condicional, solo si > 0).
- `backend/routes/declaraciones.js` (F104): `compras.subtotalNoObjeto` agregado
  al desglose — no afecta el cálculo de crédito fiscal (correcto: nunca generó
  IVA).
- `backend/routes/ats.js`: la columna **"No Obj."** de la fila COMPRAS del talón
  resumen (PDF), el `baseNoGraIva` del XML `<detalleCompras>`, y el `/preview`
  ahora usan el valor real en vez de `'0.00'` hardcodeado.
- `frontend/src/components/Facturacion/ATS.jsx`: columna "No objeto / Exento" en
  la tabla de Facturas de Compra + mini-card de resumen (condicional).

### Feature 2 — Notas de Venta RIMPE en el talón resumen ATS

- `backend/routes/ats.js` (`/preview`, `/exportar`, `/exportar/pdf`): las tres
  rutas ahora consultan `notas_venta` del período **solo si**
  `configuracion_sri.negocioPopular === true`, y las agregan:
  - `/preview`: nuevo array `notasVenta` + `totales.totalVentasNotasVenta` /
    `docNotasVenta`.
  - `/exportar` (XML): nueva entrada `<detalleVentas>` con
    `tipoComprobante = 02`, `baseImponible` = total de la nota (tarifa 0%, sin
    IVA), agrupada por cliente igual que facturas/liquidaciones.
  - `/exportar/pdf`: nueva fila `02 NOTA DE VENTA` en la sección VENTAS del
    talón, sumada al total general.
- `frontend/src/components/Facturacion/ATS.jsx`: nueva sección "Notas de Venta
  emitidas — RIMPE Negocio Popular" en el tab Ventas (condicional, solo si hay
  registros); contador de ventas y card de resumen actualizados.

### Feature 3 — Notas de Venta recibidas de proveedores, clasificadas correctamente en compras

Distinto de la Feature 2: acá el cliente **recibe** una nota de venta de un proveedor RIMPE
Negocio Popular (que no puede emitir factura) y la registra como compra propia. Hasta ahora
`facturas_compra` no tenía forma de distinguir el tipo de documento recibido — **toda compra
se reportaba al SRI como "01 FACTURA"**, sin importar el documento real. Eso es incorrecto en
dos campos del ATS:
- `tipoComprobante` debía ser `02` (Nota o boleta de venta, Tabla 4 SRI), no `01`.
- `codSustento` debía ser `02` (Costo o Gasto para IR) en vez de `01` (Crédito Tributario de
  IVA) — una nota de venta de un Negocio Popular **no da derecho a crédito tributario de
  IVA**, es solo deducible como gasto para Impuesto a la Renta.

**Implementado:**
- Nueva columna `tipoComprobante` (`'FACTURA'` default | `'NOTA_VENTA'`) en `facturas_compra`
  — migración `20260717010000_tipo_comprobante_compras`, sin backfill (todo lo existente ya
  se asumía y se seguía tratando como factura, no cambia comportamiento de nada histórico).
- `frontend/src/components/Compras/FormCompra.jsx`: nuevo select **"Tipo de comprobante"**
  (📄 Factura / 🧾 Nota de Venta) al inicio de la sección "Comprobante", con nota explicativa
  cuando se elige Nota de Venta.
- `backend/routes/compras.js`: acepta y persiste `tipoComprobante` en creación (POST `/`) y
  edición (PUT `/:id`, para corregir compras ya registradas incorrectamente como factura).
- `backend/routes/ats.js`:
  - `/exportar` (XML): `codSustento` y `tipoComprobante` del `<detalleCompras>` ahora
    dependen del tipo real del documento.
  - `/exportar/pdf`: la sección COMPRAS del talón ahora separa **dos filas** —
    `01 FACTURA` y `02 NOTA DE VENTA` — cada una con su propio desglose de bases/IVA, y el
    `TOTAL` suma ambas.
- `frontend/src/components/Facturacion/ATS.jsx`: columna "Tipo" con badge por fila en la
  tabla de compras, badge de conteo "🧾 N Notas de Venta (RIMPE)" en el título de la sección
  cuando aplica.

---

## Verificado (HTTP real contra `scfi_dev`, no solo `node -c`)

1. `npx prisma migrate deploy` — aplicó la nueva migración limpiamente. **Nota**:
   de paso se encontraron y resolvieron 2 migraciones de sesiones anteriores que
   habían quedado en estado "fallido" en la BD local (`20260708000000_caja_chica`
   y `20260712000000_declaraciones_credito_iva`) — sus tablas ya existían
   (ejecutadas pero nunca marcadas como completas, probablemente por un proceso
   interrumpido); se resolvieron con `prisma migrate resolve --applied` tras
   confirmar que las tablas eran correctas. No relacionado con esta sesión, pero
   bloqueaba verificar contra la BD local.
2. `POST /api/compras` con una línea `esNoObjetoIva: true` → `subtotalNoObjeto`
   se persistió correctamente ($50), separado de `subtotal0` ($0) y sin generar
   IVA.
3. `GET /api/ats/preview` → la compra de prueba refleja `subtotalNoObjeto: "50"`.
4. `GET /api/ats/exportar` (XML) → `<baseNoGraIva>50.00</baseNoGraIva>` real en
   `<detalleCompras>`.
5. `GET /api/ats/exportar/pdf` → columna "No Obj." de la fila COMPRAS muestra
   `50.00` real (antes: siempre `0.00`).
6. Con `negocioPopular = true` (temporal, restaurado al terminar) + una nota de
   venta de prueba ($30): apareció en `/preview` (`notasVenta`, `docNotasVenta:
   1`), en el XML (`tipoComprobante>02`, `baseImponible>30.00`) y en el PDF
   (fila `02 NOTA DE VENTA` con `30.00`).
7. Datos de prueba eliminados y `negocioPopular` restaurado a su valor original
   (`false`) al finalizar.
8. `npx prisma validate`, `node -c` en los 4 archivos backend editados,
   `npx vite build` del frontend — todo limpio.
9. `POST /api/compras` con `tipoComprobante: "NOTA_VENTA"` → persistió correctamente; el
   listado (`GET /compras`) devuelve `tipoComprobante: "NOTA_VENTA"`; el XML del ATS generó
   `<codSustento>02</codSustento>` y `<tipoComprobante>02</tipoComprobante>` reales; el PDF
   del talón mostró la fila separada `02 NOTA DE VENTA` en la sección COMPRAS con el monto
   correcto ($80.00). Datos y proveedores de prueba eliminados al terminar.

## 🔴 Pendiente de verificar en producción

1. Confirmar con el cliente si su reporte de "otras compras" era sobre compras
   manuales (`FormCompra`) o importadas (Excel/XML histórico) — la importación
   masiva de compras históricas (`importarComprasHistoricas.js`) **no** se tocó
   en esta sesión (sigue sin soporte para "no objeto/exento"; agrupa todo lo no
   gravado en `subtotal0`). Si el cliente carga compras masivas con este
   escenario, es un follow-up.
2. Confirmar si el cliente que reportó RIMPE/notas de venta tiene
   `negocioPopular` marcado en Configuración SRI — si no, no verá el cambio
   (es el gate intencional).
3. Migraciones `20260717000000_subtotal_no_objeto_compras` y
   `20260717010000_tipo_comprobante_compras` pendientes de aplicar en Railway
   (`prisma migrate deploy`) y en BDs de tenants (`applySchemaFixes.js` al
   arrancar) — confirmar sin error `P2022` en logs.
4. Si las notas de venta de este cliente en la práctica sí venden productos
   gravados (no solo tarifa 0%), el tratamiento actual (todo a "Base 0%") es una
   simplificación deliberada — revisar con la contadora si es correcto para su
   caso o si se necesita captura de IVA por línea en notas de venta (cambio de
   alcance mayor).
5. Las compras ya registradas **antes de hoy** con una nota de venta de
   proveedor (si las hay) quedaron con `tipoComprobante = 'FACTURA'` por
   default — no se puede backfillear automáticamente porque no hay forma de
   distinguirlas retroactivamente. Si el cliente identifica compras viejas mal
   clasificadas, se corrigen una por una editándolas (el PUT `/:id` ya acepta
   `tipoComprobante`) o pidiendo un script puntual si son muchas.
6. La importación masiva de compras históricas (Excel) y la importación desde
   XML/autorización SRI **no** tienen forma de marcar `tipoComprobante =
   NOTA_VENTA` — asumen siempre factura, correctamente (un XML autorizado por
   el SRI siempre es un comprobante electrónico real). Si el cliente necesita
   cargar notas de venta recibidas en lote, es un follow-up sobre el importador
   Excel de compras históricas.
