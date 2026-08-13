# AELA ERP — Sesión 2026-08-13 — Contabilidad: imprimir/duplicar asientos, mayor general, balance con firmas

## Pedido del usuario (4 partes)

1. Poder imprimir un asiento contable con todos sus datos.
2. Poder copiar/duplicar un asiento para editarlo y guardarlo como uno
   nuevo (asientos repetitivos).
3. Que el Libro Mayor general se imprima con el mismo nivel de detalle que
   el libro mayor de una cuenta puntual.
4. Verificar que el Balance no muestre una cuenta duplicada, y que termine
   con firma de Gerente y Contador.

## Implementado (commit `4a851b4`)

**1. Imprimir asiento (PDF)** — nuevo `GET /contabilidad/asientos/:id/pdf`:
cabecera completa (fecha, tipo, referencia, descripción, estado
abierto/cerrado/bloqueado), tabla de detalle (cuenta, centro de costo,
descripción, debe, haber) y totales. Botón `🖨` en el listado de asientos
y dentro del modal de ver/editar.

**2. Duplicar asiento** — `duplicarAsiento()` en el frontend: carga el
asiento como base de uno NUEVO (`id: null`, fecha de hoy), listo para
editar y guardar sin tocar el original. Un asiento automático (FACTURA,
COMPRA, etc.) se duplica como `MANUAL` — el tipo original queda reservado
para asientos que el sistema genera desde su documento fuente. Botón `📋`
en el listado.

**3. Libro Mayor general con detalle completo** — antes, sin filtrar por
cuenta, el PDF solo traía el resumen de mayorización (una fila por cuenta
con totales). Ahora imprime ese resumen y, a continuación, **una página
por cada cuenta con su detalle movimiento por movimiento** — mismo formato
exacto que el reporte de una sola cuenta (se factorizó
`dibujarDetalleMayorCuentaPdf()` para no duplicar el código de la tabla).

**4. Balance General**:
- `obtenerBalanceGeneral()` deduplica por `id` de cuenta antes de calcular
  totales. **Nota honesta**: `plan_cuentas` ya tiene
  `@@unique([empresaId, codigo])` a nivel de base de datos, así que en la
  práctica no debería ser posible que una cuenta aparezca duplicada — no
  se pudo reproducir un caso real. Se agregó igual como salvaguarda barata
  (si el usuario ve una cuenta duplicada en pantalla, mandar captura —
  sería señal de otra causa, no cubierta por este fix).
- Nuevo `GET /contabilidad/reportes/balance-general?formato=csv|pdf`:
  versión detallada e imprimible del Estado de Situación Financiera (no
  existía — el único PDF de balance que había era un resumen de una
  línea, parte de "Estados Financieros"). Termina con líneas de firma para
  **Gerente General** y **Contador**. Botón `📄 Balance General (para
  firmar)` en el tab Estados Financieros.

**Bug encontrado y corregido de paso**: los símbolos `✓`/`⚠` usados en el
balance salían como un glifo roto en el PDF — la fuente base Helvetica de
PDFKit usa `WinAnsiEncoding` y no los tiene (es la única función de todo
`contabilidad.js` que usaba símbolos Unicode dentro de `doc.text()`).
Reemplazados por texto plano ("Balance cuadrado" / "ATENCIÓN: el balance
NO cuadra").

## Verificado

Contra un tenant local aislado (empresaId=1, Corp Simtelec — el único
asiento real preexistente no se tocó): se creó un asiento de prueba
`MANUAL` con 2 líneas, se imprimió, se leyó para simular "duplicar", se
generaron los 4 PDFs (asiento individual, mayor de una cuenta, mayor
general, balance general) y se renderizaron a PNG con `pymupdf` para
revisión visual — cabecera de asiento completa, detalle de mayor idéntico
entre "una cuenta" y "cada cuenta del general", firmas visibles al final
del balance, símbolo de balance cuadrado ya sin el glifo roto. Asiento de
prueba y usuario QA eliminados al terminar. `node --test`: 42/42. `vite
build`: sin errores.

## Para el usuario

- Los 3 primeros puntos (imprimir, duplicar, mayor general) están listos
  para usar tal cual los pediste.
- El punto 4 (duplicado en el balance): no encontré cómo podría estar
  pasando dado que el código de cuenta es único a nivel de base de datos.
  Agregué una protección de todos modos, pero si sigues viendo una cuenta
  repetida en el Balance después de este fix, compárteme una captura — eso
  confirmaría que la causa es otra (por ejemplo, algo distinto a lo que se
  cubrió aquí) y hay que investigarlo puntual.

## Continuación misma sesión — Exportar Libro Mayor a Excel real (commit `b872adb`)

El usuario hizo notar que el botón "Exportar Excel" del Libro Mayor en
realidad descargaba un CSV (la propia etiqueta lo decía: "Exportar Excel
(CSV)") — texto plano, sin formato, montos como texto. Pidió que salga
"bien formateado en el Excel".

**Se agregó la dependencia `exceljs`**: la librería `xlsx` (SheetJS
community edition) ya usada en el resto del sistema para leer/generar
plantillas **no escribe estilos de celda de forma confiable** — se probó
explícitamente (bold y fill de relleno quedaban sin aplicar al reabrir el
archivo con una librería independiente; solo el formato numérico
persiste). `exceljs` sí escribe estilos reales de forma consistente.

`GET /contabilidad/reportes/mayor` ahora acepta `formato=xlsx` además de
`csv|pdf`: encabezados en negrita con fondo gris, Debe/Haber/Saldo como
números reales con formato de moneda (no texto), Fecha como fecha real,
anchos de columna razonables y encabezado congelado. Filtrando por una
cuenta: una hoja "Mayor". Sin filtrar (general): hoja "Resumen" + una hoja
por cada cuenta con movimientos, mismo criterio que el PDF general de
antes.

Botón `📊 Exportar Excel` en el tab Libro Mayor; el botón CSV existente se
renombró a "Exportar CSV" (ya no se hace pasar por Excel).

**Verificado** generando el archivo con `exceljs` y reabriéndolo con
`openpyxl` (librería Python independiente, para no validar con la misma
herramienta que lo generó): negrita y relleno del encabezado sí persisten,
columnas de fecha y moneda con el tipo y formato numérico correctos, ancho
de columna y freeze panes aplicados, 6 hojas generadas correctamente en el
caso general (Resumen + 5 cuentas, nombres de hoja truncados a 31
caracteres sin colisión). Probado contra un tenant local aislado, datos de
prueba eliminados al terminar. `node --test`: 42/42. `vite build`: sin
errores.

## Continuación misma sesión — Compra sin poder completar la integración a inventario (commit `f554be5`)

El usuario compartió una compra real de Comercial S&S (Bimbo Ecuador, 11
líneas) con "Inventario aplicado: Sí (4)" — 4 de 11 líneas integradas, sin
ninguna opción visible para completar las 7 restantes.

**Causa raíz**: las líneas que no matchean ningún producto existente por
código exacto al crear la compra (típico cuando "crear productos
faltantes" viene apagado, ej. import histórico) quedan con
`productoId: null` en el `detalles` JSON de la compra — sin producto, sin
inventario, **sin ningún aviso**. El único endpoint pensado para
completarlas después (`POST /compras/:id/registrar-inventario`) se negaba
a correr por completo si la compra ya tenía cualquier movimiento
registrado (`"Esta compra ya tiene movimientos de inventario
registrados"`) — diseño todo-o-nada que bloqueaba justo el caso real
reportado.

**Fix — el endpoint ahora es reentrante** (se puede llamar tantas veces
como haga falta, a medida que se van resolviendo líneas):
- Ya no bloquea por "ya tiene movimientos"; procesa cada línea
  individualmente.
- Líneas sin producto asignado: se resuelven/crean con la misma lógica ya
  compartida (`resolverOMarcarPendiente`).
- Líneas que YA tienen `productoId` pero nunca recibieron su movimiento de
  entrada (bug real encontrado durante la prueba: con el fix a medias,
  estas quedaban permanentemente saltadas — exactamente el síntoma
  reportado): se verifica contra `movimientos_inventario` (por
  productoId + número de factura) antes de decidir si aplicar el
  movimiento, evitando tanto dejarlas sin integrar como duplicar lo ya
  aplicado antes.
- El `detalles` de la compra se actualiza con el `productoId` recién
  asignado en cada corrida, para que la siguiente no reprocese esa línea.

Frontend: el botón ahora aparece cuando quedan líneas sin producto
asignado, sin importar si la compra ya tiene movimientos ("📦 Registrar en
inventario" la primera vez, "🔗 Integrar al inventario (N)" para
completar). La columna "Invent." de la tabla de detalle y el resumen
"Inventario aplicado" ahora muestran **"Sin integrar"** en las líneas
afectadas, en vez de quedar en silencio.

**Pedido adicional del usuario, ya implementado desde antes (verificado,
no nuevo código)**: "que al integrar al inventario lea la descripción como
el código para evitar duplicados, y si la descripción coincide pero el
código no, dar una alerta para confirmar si es el mismo producto." Esto
**ya existe** desde la sesión del 2026-08-06
(`buscarPosibleDuplicadoPorNombre`, similitud Jaccard sobre la
descripción, umbral 0.34) y **ya estaba conectado** a este mismo flujo vía
`resolverOMarcarPendiente` — se confirmó en la prueba end-to-end: una
línea con código nuevo pero descripción parecida a un producto existente
NO creó un duplicado, se envió a **"Ítems por revisar"** con el producto
sugerido, para que el usuario confirme con el botón "Sí, es el mismo" o lo
rechace.

**Verificado** end-to-end contra un tenant local aislado: compra de 3
líneas (match exacto sin movimiento previo, código nuevo, y descripción
similar a un producto existente con código distinto). 1ra corrida: el
match exacto sí recibe su movimiento (antes se saltaba), el código nuevo
crea el producto, la línea de descripción parecida va a revisión en vez de
duplicar. 2da corrida (repetir el mismo botón): 0 movimientos nuevos, 0
pendientes duplicados — sin efecto, como corresponde. `node --test`:
42/42. `vite build`: sin errores.

**Para el usuario**: en la compra real de Bimbo, después del deploy, el
botón "🔗 Integrar al inventario (7)" (o el número que corresponda) debería
aparecer arriba. Si alguna de esas 7 líneas tiene una descripción parecida
a un producto que ya existe en el catálogo, no va a crear un duplicado —
va a aparecer en **Compras → Ítems por revisar** para que confirmes si es
el mismo producto.
