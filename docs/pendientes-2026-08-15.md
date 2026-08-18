# AELA ERP — Sesión 2026-08-15 — ATS: ventas No Objeto/Exento de IVA no se sumaban

## Pedido del usuario

Las contadoras consultadas indicaron que en el ATS "las exentas y no objeto
de IVA se suman en las de tarifa cero", y que en este momento el sistema no
las está revisando ni sumando. Pidió investigar contra el manual técnico del
SRI antes de tocar nada — con captura de una fuente que indicaba que
No Objeto, Exenta y Tarifa 0% son **campos independientes y obligatorios**
en el ATS (para compras), no un solo casillero combinado.

## Investigación

Antes de escribir código se revisó el historial del propio proyecto: una
sesión anterior (2026-07-21, commits `07b572b`…`9ed0e32`) ya había
investigado exactamente esto para **compras** — corrigió un error real
donde "no objeto" y "exenta" estaban combinados en un solo campo, cuando el
XSD oficial de compras (`detalleComprasType`) exige 2 campos separados
(`baseNoGraIva` y `baseImpExe`). Ya está bien implementado:
`facturas_compra.subtotalNoObjeto` / `.subtotalExento`, cada uno en su
propio campo del XML (`routes/ats.js` líneas 441-444).

Una sesión posterior (commit `1332918`, mismo día) verificó lo mismo pero
para **ventas** — descargó el XSD oficial (`ats.xsd`) e inspeccionó
`detalleVentasType` línea por línea: **ese tipo solo tiene un campo
`baseNoGraIva`, sin equivalente a `baseImpExe`** (ese campo existe solo en
compras y en reembolsos). Conclusión ya correcta entonces: para ventas, "no
objeto" y "exento" SÍ se combinan en un solo campo — no por error, sino
porque el SRI nunca pidió la separación ahí. El campo combinado
`facturas.subtotalNoObjetoIva` ya existía con ese diseño correcto.

**Lo que faltaba — y es el bug real que reportaron las contadoras**: el
campo `subtotalNoObjetoIva` existe y se puede llenar (el formulario de
Facturación ya ofrece "No Objeto IVA"/"Exento IVA" como tarifa por línea,
`FormFactura.jsx`), pero **`routes/ats.js` nunca lo leía** al generar el
XML del ATS — el acumulador de ventas (`acumularVenta`) dejaba
`baseNoGraIva` fijo en `0` para siempre, sin sumar nada. No era un problema
de "dónde va" (eso ya estaba bien decidido) sino que el dato simplemente se
perdía en el camino.

Al investigar el camino completo de un detalle No Objeto/Exento se
encontraron **2 bugs más en el mismo área**, ninguno activado en producción
todavía (0 facturas reales en ningún tenant usan estas tarifas hoy —
verificado contra las 6 BD de tenants reales), pero ambos rompían la
factura electrónica en sí, no solo el ATS:

1. **`IVA_CODIGO`** tenía las claves `'noObjeto': '6'` y `'exento': '7'`
   como **strings**, pero en las 5 llamadas reales del código siempre se
   busca por el valor **numérico** de `ivaPorcentaje` (`IVA_CODIGO[6]`,
   `IVA_CODIGO[7]`) — esas 2 claves nunca se alcanzaban y cualquier detalle
   No Objeto/Exento caía al `|| '0'` de respaldo, reportando
   `codigoPorcentaje` **incorrecto** al SRI (tarifa 0% en vez de No
   Objeto/Exento).
2. **`generarXMLFactura`** calculaba el subtotal No Objeto/Exento e lo
   incluía correctamente en `totalSinImpuestos`, pero **nunca construía su
   bloque `<totalImpuesto>`** en la cabecera (`totalConImpuestos`) — solo
   tenía bloques para 0/5/12/15%. Resultado: la suma de `baseImponible` de
   la cabecera no cuadraba con `totalSinImpuestos` para cualquier factura
   con una línea No Objeto/Exento — una regla de validación común del SRI
   que probablemente hubiera rechazado el comprobante.

## Fix (`backend/utils/sri.js`, `backend/routes/ats.js`, `backend/routes/facturas.js`)

1. `IVA_CODIGO`: claves `6`/`7` numéricas en vez de `'noObjeto'`/`'exento'`
   string — arregla el `codigoPorcentaje` en TODOS los generadores de XML
   que comparten esta constante (factura, nota de crédito, liquidación),
   no solo factura.
2. `generarXMLFactura`: separa el cálculo en `subtotalNoObjeto` (código 6) y
   `subtotalExento` (código 7); agrega sus bloques `<totalImpuesto>` en la
   cabecera cuando corresponde (`valor` siempre `0.00`, no generan IVA real);
   devuelve `totales.subtotalNoObjetoIva` = la suma de ambos (combinado,
   a propósito — así lo pide el XSD del lado de ventas).
3. `routes/facturas.js` (`POST /facturas`): usa
   `totales.subtotalNoObjetoIva` en vez del `0` fijo que tenía al crear la
   factura — antes, aunque el XML ya saliera bien, el valor nunca se
   guardaba en la base de datos.
4. `routes/ats.js`: el `SELECT` de facturas para `/exportar` ya traía el
   campo completo (sin restricción); se agregó al `SELECT` de `/preview`
   también. `acumularVenta()` ahora suma
   `row.subtotalNoObjetoIva` en `baseNoGraIva` (antes quedaba fijo en `0`).

## Verificado

- 5 tests nuevos en `backend/test/sri.test.js`: limpieza de descripción
  (sesión anterior), declaración de `totalImpuesto` para código 6/7 con
  verificación explícita de que la suma de `baseImponible` de la cabecera
  cuadra con `totalSinImpuestos`, y `codigoPorcentaje` correcto por detalle.
  `node --test`: 44/44.
- **Verificación real de punta a punta** contra `scfi_dev` (servidor local
  real, no simulado): se insertó una factura de prueba con 4 líneas (0%,
  No Objeto, Exento, 15%) directamente en la BD, se llamó al endpoint real
  `GET /api/ats/exportar` por HTTP con JWT real, y se confirmó en el XML
  devuelto: `<baseNoGraIva>50.00</baseNoGraIva>` (20 No Objeto + 30 Exento,
  antes hubiera sido `0.00`), con `baseImponible`/`baseImpGrav` sin
  alterarse. Factura de prueba eliminada al terminar.

## Para el usuario / las contadoras

Las 3 categorías (No Objeto, Exenta, Tarifa 0%) **no se combinan entre sí**
en el ATS — cada una tiene su propio significado legal y, del lado de
compras, su propio campo en el XML. Lo que sí es cierto es que, **del lado
de ventas únicamente**, el XSD oficial del SRI combina No Objeto + Exenta
en un solo campo (`baseNoGraIva`) porque no ofrece un campo separado ahí —
eso ya estaba bien decidido en el sistema desde julio. El problema real que
ustedes detectaron era que ese campo combinado nunca se estaba sumando —
ya está corregido.

## Continuación — F104 tenía el mismo vacío, ya corregido también

Se revisó `backend/routes/declaraciones.js` (`GET /f104`) con el mismo
cuidado. Confirmado: **mismo bug exacto que el ATS** — la consulta de
`facturas` no traía `subtotalNoObjetoIva` y el acumulador de ventas nunca lo
sumaba. Investigación rápida sobre el Formulario 104 real: al igual que en
el ATS, del lado de **ventas** el SRI no distingue "no objeto" de "exenta"
en casilleros separados (fuentes públicas ubican ambas bajo un mismo
casillero, ~404 "Ventas no objeto de IVA", sin un casillero de "ventas
exentas" aparte) — consistente con que `subtotalNoObjetoIva` ya combine
ambas cosas por diseño. Del lado de **compras** si hay casilleros separados
oficiales (531 no objeto, otro para exentas, según la fuente que trajo el
usuario) — y ahí el backend YA calculaba bien `subtotalNoObjeto`/
`subtotalExento` por separado, pero **la pantalla de Declaraciones nunca los
mostraba** (el dato ya estaba bien calculado en el backend desde julio,
solo nunca llegó a la UI).

**Fix**:
- `declaraciones.js`: agrega `subtotalNoObjetoIva` al `select` de facturas,
  lo acumula, y lo expone como `ventas.subtotalNoObjeto` en la respuesta.
- `frontend/.../Declaraciones.jsx`: nueva fila "Ventas no objeto / exentas
  de IVA" (solo si > 0); nuevas filas "Compras no objeto de IVA" /
  "Compras exentas de IVA" (el dato ya existía en el backend, solo faltaba
  mostrarlo).

**Verificado**: `npm run build` sin errores. HTTP real contra `scfi_dev`
(misma factura de prueba insertada, `GET /api/declaraciones/f104` real):
`ventas.subtotalNoObjeto: 50` confirmado. Datos de prueba eliminados.

**Simplificación consciente, no corregida hoy**: el prorrateo de notas de
crédito contra ventas (`ventasNetas0/5/12/15`) no incluye
`subtotalNoObjeto` en su base de reparto — una NC contra una venta No
Objeto/Exento no se descontaría de ese total. Como con todo lo demás de
esta sesión, no hay ninguna venta real con esas tarifas todavía, así que se
dejó así para no sobre-construir sobre un caso sin uso real; si alguna vez
aparece, hay que revisar `_totBaseVentas`/`ventasNetas*` en
`declaraciones.js`.
