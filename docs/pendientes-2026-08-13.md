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

## Continuación misma sesión — el fix anterior no alcanzaba para la compra real (commit `761e9d0`)

El usuario probó el botón "Integrar al inventario" en la compra real de
Bimbo y recibió **"No se encontraron productos inventariables pendientes
de integrar en esta compra"** — un callejón sin salida, cuando debía crear
los productos faltantes.

**Causa raíz real**: esa compra tiene `Origen: BUZON_SRI` — se creó por un
flujo de código completamente distinto (`utils/buzon.js`,
`importarDocumentoRecibido`), no por `POST /compras`. El fix anterior
(`f554be5`) solo tocó `registrar-inventario`; nunca tocó el import del
Buzón. Ahí se encontraron 2 bugs propios:

1. `detalles` se guardaba en la BD **antes** de correr la resolución de
   productos, y esa resolución nunca escribía `productoId` de vuelta al
   detalle — toda compra importada del Buzón SRI queda con
   `productoId: undefined` en **todas** sus líneas para siempre, sin
   importar cuántas se hayan resuelto durante el import.
2. El movimiento de inventario usaba `referencia: "BUZON-<id>"` en vez del
   número de factura (la convención que usa el resto del sistema) —
   impedía que el chequeo de "ya aplicado" reconociera estos movimientos.

Al armar una prueba end-to-end simulando un import real del Buzón
aparecieron **2 bugs más**, en la misma área pero relacionados con la
función "¿es el mismo producto?" (posible duplicado, sesión 2026-08-06):

3. `POST /compras/pendientes/:id/asignar` y `/crear-producto` — los
   endpoints reales detrás del botón **"Sí, es el mismo"** en Ítems por
   revisar — aplicaban el movimiento de inventario pero **nunca
   actualizaban el detalle de la compra origen**. La línea seguía
   mostrando "Sin integrar" para siempre, y una corrida posterior de
   "Integrar al inventario" la evaluaba desde cero (podía re-encolarla en
   Ítems por revisar otra vez). Además usaban `item.codigoPrincipal` como
   referencia en vez del número de factura — mismo problema que el bug 2.
4. El chequeo de "¿ya se aplicó esta línea?" en `registrar-inventario` se
   basaba en producto+factura, no en la línea puntual de la compra. Cuando
   **2 líneas de la misma compra resuelven al mismo producto** (justo el
   caso de "posible duplicado" confirmado — una línea con match exacto y
   otra con descripción parecida apuntando al mismo producto), la segunda
   se daba por aplicada solo porque la primera ya había generado un
   movimiento para ese producto — su cantidad se perdía en silencio, sin
   ningún error visible.

**Fix**: se agregó un flag `movimientoAplicado` por línea de detalle —
fuente de verdad inequívoca por línea, sin la ambigüedad de inferir por
producto+factura cuando 2 líneas comparten el mismo producto. Se aplicó en
los 3 lugares que tocan movimientos de compra (`buzon.js`, `compras.js`,
`comprasPendientes.js`). El chequeo viejo por producto+factura se
conserva solo como inferencia de migración, para líneas que ya tenían
`productoId` de antes de este fix. `registrar-inventario` ahora también
**auto-sana** líneas que ya se resolvieron por Ítems por revisar (estado
`RESUELTO`) pero cuyo detalle nunca se sincronizó — en vez de re-evaluarlas
o dejarlas atascadas para siempre. El mensaje de respuesta también se
mejoró para distinguir "no había nada pendiente" de "había líneas sin
match y no se creó ninguna" (probablemente por no marcar "Crear productos
no encontrados").

**Verificado** end-to-end contra un tenant local aislado, simulando una
importación real del Buzón SRI con 3 líneas (match exacto, producto
nuevo, descripción parecida) más un ítem de regalo resuelto vía
"crear producto": `productoId` y `movimientoAplicado` se sincronizan
correctamente en los 3 flujos, la referencia es consistente
(`numeroFactura` en los 3), "Integrar al inventario" queda idempotente
después de cada resolución (0 movimientos en corridas repetidas), sin
movimientos duplicados ni perdidos. `node --test`: 42/42. `vite build`:
sin errores.

**Para el usuario**: en la compra real de Bimbo, después de este deploy,
"Integrar al inventario" debería crear los productos faltantes
correctamente. Si alguna línea ya está en **Ítems por revisar**
(pendiente o resuelta antes de hoy), este fix la reconoce y la sincroniza
al confirmar — ya no debería quedar pegada mostrando "Sin integrar" para
siempre.

## Continuación misma sesión — el mensaje seguía siendo engañoso (commit `21f8e68`)

El usuario probó de nuevo en la compra real (`aela.corpsimtelec.com/compras/66`,
Comercial S&S) y **seguía** recibiendo "No se encontraron productos
inventariables pendientes de integrar en esta compra" al hacer clic en
"Integrar al inventario (3)".

**Causa**: las 3 líneas restantes YA estaban en **Ítems por revisar**
(estado `PENDIENTE`) desde una corrida anterior — probablemente quedaron
ahí por "posible duplicado" antes de que el fix de esta sesión existiera.
El bucle de `registrar-inventario` (fix anterior, `761e9d0`) las
reconoce correctamente y NO las vuelve a evaluar (correcto, para no
duplicar la cola) — pero simplemente hacía `continue` sin contarlas en
ningún lado, así que el mensaje final seguía siendo el genérico "no hay
nada pendiente" — técnicamente cierto para ESTE endpoint, pero engañoso:
sí había algo pendiente, solo que esperando en otra pantalla.

**Fix**: nuevo contador `yaEnRevision` en la respuesta. Cuando es la
única razón de que no pasó nada, el mensaje ahora dice explícitamente
*"N línea(s) ya están esperando tu confirmación en Compras → Ítems por
revisar — resuélvelas ahí (o descártalas) antes de volver a integrar."*
El toast del frontend (`DetalleCompra.jsx`) ya mostraba el `mensaje` tal
cual venía del backend, así que no hizo falta tocar el frontend.

**Verificado** con una compra de prueba que simula el escenario exacto
(línea con entrada `PENDIENTE` preexistente en `items_compra_pendientes`,
como la de producción): la respuesta reporta `yaEnRevision: 1` y el
mensaje nuevo, sin registrar movimientos (correcto). `node --test`: 42/42.

**Para el usuario**: en la compra real de Bimbo, después de este deploy,
si el botón sigue sin crear productos, el mensaje del toast debería decir
ahora cuántas líneas están esperando en Ítems por revisar — ve a
**Compras → Ítems por revisar**, busca esas 3 líneas y usa "Sí, es el
mismo" (si sugiere un producto parecido) o "Crear producto" (si es
realmente nuevo) para resolverlas una por una. Una vez resueltas ahí,
la compra se sincroniza sola — no hace falta volver a tocar "Integrar al
inventario".

## Continuación misma sesión — Movimientos de inventario: Stock anterior/Referencia + filtro por producto (commit `a23bcc7`)

El usuario vio en la tabla de Movimientos (Productos > Inventario) dos
filas con `Cantidad: 3.00` y `Stock nuevo: 7.00` y preguntó por qué,
esperando 4 (1 anterior + 3 subidas ahora). La tabla no mostraba
**Stock anterior** ni **Referencia** — sin esos 2 datos era imposible
saber si el 7 era correcto (el stock anterior ya era 4 por otra razón,
legítima) o un bug de duplicación. El backend ya devolvía ambos campos
(`stockAnterior`, `referencia`), solo no se mostraban en esta pantalla.

Además, la lista general solo trae los últimos 200 movimientos
**mezclados de todos los productos** — si hay bastante movimiento
reciente de otros productos, el historial completo de uno específico
puede no estar ahí. El backend ya soportaba filtrar por `productoId`,
solo no estaba expuesto en la UI.

**Implementado**: columnas nuevas "Stock anterior" y "Referencia" en la
tabla; el nombre del producto en cada fila ahora es un botón que carga
su historial completo (hasta 500 movimientos) directo del backend, con
un chip "Producto: X — historial completo" y botón para quitar el
filtro.

**Verificado** con Playwright contra el backend local (producto de
prueba con movimiento ENTRADA 4→7, mismo patrón que reportó el usuario):
columnas nuevas visibles con el dato correcto, clic en el producto
filtra bien, quitar filtro funciona, sin errores de consola nuevos
(sí se notó un warning preexistente de React key duplicada en el menú
lateral, `/productos` — no relacionado, no corregido, queda para otra
sesión). `vite build`: sin errores. Datos de prueba eliminados.

**Para el usuario**: ahora puedes ver el `stockAnterior` real de
cualquier movimiento (columna nueva) y hacer clic en el nombre de
cualquier producto en Movimientos para ver TODO su historial — así
puedes confirmar tú mismo si el 7 de "Submarino Vainilla" es correcto
(por otro stock previo legítimo) o si hay algo raro que compartir.

## Continuación misma sesión — duplicado real confirmado y corregido (commit `07512f0`)

El usuario usó el filtro nuevo (commit anterior) en "Pan Molde Blanco 1p
262g BOLSA SUP" y encontró la prueba: 2 movimientos ENTRADA de cantidad 3
cada uno, uno con `referencia: BUZON-66` (12/8, el import original) y otro
con `referencia: 004-206-000111467` (13/8, el número de factura de esa
misma compra #66) — la línea se integró **dos veces**.

**Causa raíz**: el chequeo "¿ya se aplicó esta línea?" (de `761e9d0`) solo
corría para líneas que YA tenían `productoId` guardado ANTES de la
corrida (`teniaProductoIdPrevio`). El razonamiento — "una línea recién
resuelta no puede tener un movimiento previo" — ignoraba el bug real de
`buzon.js`: el import original SÍ aplicó el movimiento (matcheó el
producto por código, referencia `BUZON-<id>`) pero NUNCA guardó el
`productoId` en la línea. Al reprocesar la compra con el fix de esta
sesión, esa línea llegaba "en blanco", volvía a resolver al mismo
producto por código exacto, y el chequeo legado nunca se ejecutaba (por
el gate) — aplicando el movimiento por segunda vez.

**Fix**: el chequeo por producto+factura ahora corre para TODA línea que
llega a aplicar un movimiento, no solo las que ya tenían `productoId`.
Para no reintroducir el bug original (2 líneas de la misma compra que
comparten producto bloqueándose entre sí), se reemplazó el chequeo
booleano por un **contador por producto**: cuenta cuántos movimientos ya
existen para producto+factura (incluyendo `BUZON-<id>`) y cada línea que
"reclama" uno lo descuenta — si el mismo producto aparece en 2 líneas y
solo 1 ya se había aplicado, la otra sigue aplicando la suya con
normalidad, sin bloquearse ni duplicarse.

**Verificado** con 2 pruebas dirigidas: el escenario exacto reportado
(duplicado `BUZON-<id>`+`numeroFactura`) y el caso borde de 2 líneas
compartiendo un producto con solo 1 ya aplicada — ambos dan el resultado
correcto. `node --test`: 42/42.

**🔴 Importante para el usuario — acción manual pendiente**: este fix
previene duplicaciones NUEVAS, pero **no corrige retroactivamente** el
stock ya inflado en la compra #66 real (ni en ninguna otra compra vieja
del Buzón que haya pasado por el mismo problema) — no hay acceso desde
este entorno a la base de datos de producción (`aela_sys`, Comercial
S&S) para corregirlo directamente. Recomendación:
1. Usa el filtro por producto (Inventario → clic en el nombre) en cada
   uno de los productos que se integraron el 13/8 a las 6:01:14 p.m.
   (al menos "Pan Molde Blanco", y probablemente también "Submarino
   Vainilla" y "Submarino Manjar" — mismo patrón visto en la captura
   anterior: cantidad 3, stock nuevo 7, mismo timestamp).
2. Si ves el mismo patrón (2 movimientos ENTRADA de la misma cantidad,
   uno `BUZON-66` y otro `004-206-000111467`), es un duplicado.
3. Corrígelo con "+ Registrar movimiento" → tipo `AJUSTE_NEGATIVO`,
   cantidad = la duplicada (3 en este caso), referencia/observación
   explicando "Corrección duplicado — compra 66". Esto deja el stock
   correcto y mantiene el historial completo (mejor que borrar el
   movimiento duplicado a mano).

## Continuación misma sesión — el buscador no filtraba Movimientos (commit `255ef3b`)

El usuario escribió "submar" en "Buscar por código o nombre" (para
revisar justo los productos Submarino tras el hallazgo del duplicado) y
al presionar Actualizar la tabla de Movimientos no cambió. Causa: ese
cuadro solo se pasaba a `GET /productos` (Catálogo/Lista) —
`GET /inventario/movimientos` nunca recibía el término de búsqueda.

Fix: el endpoint acepta `busqueda` (nombre o código, insensible a
mayúsculas) igual que el resto de búsquedas del sistema; el frontend
pasa el mismo término del cuadro superior. Si había un filtro de "ver
historial completo de un producto" activo, una búsqueda nueva lo
reemplaza (antes hubiera quedado mostrando datos viejos, ignorando la
búsqueda). Verificado con Playwright: 3 productos de prueba (2 con
"submarino" en el nombre, 1 sin relación), buscar "submar" devuelve
exactamente los 2 esperados. `vite build`: sin errores.
