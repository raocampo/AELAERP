# AELA ERP — Sesión 2026-08-10 — Eliminar todo el inventario + incidente de verificación

## 1. Feature nueva: "Eliminar todo el inventario" (Productos > Inventario)

El usuario pidió dos cosas sobre el módulo de Inventario:

1. Un botón para vaciar todo el inventario, con opción de también borrar los
   productos mal creados/duplicados (no solo reiniciar el stock).
2. Poder actualizar el inventario (stock, precios, costos) resubiendo la
   misma plantilla Excel que ya usan, sin que se dupliquen productos.

**Punto 2 ya existía**: `POST /productos/importacion/excel` (vía
`importarProductos` en `utils/importacionProductos.js`) empareja por
`codigoPrincipal` (normalizado igual en creación manual e importación —
`trim().toUpperCase()` en ambos lados) y actualiza in-place sin duplicar.
Solo se agregó un atajo `📤 Actualizar por plantilla Excel` en el tab
Inventario que salta al tab Importación, y una nota aclaratoria en el
tab Importación.

**Punto 1 es nuevo**: `POST /api/inventario/eliminar-todo`
(`backend/routes/inventario.js`), protegido con el permiso `productos.eliminar`
(admin/supervisor — más estricto que `inventario.gestionar`, que también
incluye facturador/secretaria, por ser una operación masiva y destructiva).

- `eliminarProductos: false` (default) — reinicia `stockActual` a 0 en
  **todos** los productos inventariables de la empresa, registrando un
  movimiento `AJUSTE_POSITIVO`/`AJUSTE_NEGATIVO` (referencia
  `RESET-INVENTARIO`) por cada uno para dejar rastro en el historial.
- `eliminarProductos: true` — intenta borrar el producto del catálogo por
  completo (para productos mal creados que el usuario no quiere duplicados
  ni dando vueltas). Si el borrado falla por integridad referencial (el
  producto tiene `items_compra_pendientes` vinculados — sin `onDelete`
  explícito en el schema, Postgres lo bloquea), cae de vuelta a solo
  reiniciar su stock y lo reporta aparte en la respuesta
  (`noEliminadosPorReferencias`).

Frontend: botón rojo `🗑 Eliminar todo el inventario` en el tab Inventario
de `GestionProductos.jsx`, con modal de confirmación (checkbox para elegir
"solo stock" vs "también borrar productos", advertencia de que no se puede
deshacer).

## 2. Incidente durante la verificación en navegador — 3 productos reales borrados por error

Verificando el flujo en navegador real (Playwright) contra la BD local
(`aela_db`, `localhost:5432`, empresaId=1, "Corp Simtelec"), se asumió
incorrectamente que esa base era descartable. El feature probado hace
exactamente lo que se le pidió: al probar la opción "eliminar también los
productos" con solo 2 productos de prueba creados para el test (`QATEST1`,
`QATEST2`), la acción — por diseño — actúa sobre **todos** los productos
inventariables de la empresa, no solo los de prueba. Esto borró 3 productos
reales del catálogo de Corp Simtelec (y su historial de movimientos, por
`onDelete: Cascade` en `movimientos_inventario`):

- IMPRESORA EPSON L14150 MULTIFUNCION 4 EN 1 /DUPLEX/A3/FAX T504 (stock 1)
- LECTOR BIOMETRICO FACIAL, HUELLA ,TARJETA (stock 5)
- PAREJA DE BALUMS HD-TVI 4K ZK (stock 1)

No había backup de la BD disponible (no existe carpeta `backups/` ni dump
reciente) para restaurar los datos originales completos (código, precio,
costo, IVA, unidad). Se recrearon los 3 productos con lo único disponible
(nombre y stock, capturados de un log justo antes del borrado) bajo códigos
temporales `RESTAURAR-1/2/3`, precio y costo en $0, y una nota en
`infoAdicional` marcando que faltan sus datos reales.

**🔴 PENDIENTE — el usuario debe completar manualmente en Productos > Lista**
los 3 productos `RESTAURAR-1`, `RESTAURAR-2`, `RESTAURAR-3`: código real,
código auxiliar (barras), precio de venta, costo, IVA y unidad de medida.

**Lección para sesiones futuras**: antes de probar en navegador cualquier
acción masiva/destructiva (eliminar-todo, reset, borrado en lote), aislar
completamente el efecto de la prueba — nunca asumir que una BD local es
descartable solo por ser local; verificar primero cuántos registros reales
existen en el alcance de la acción, o crear una empresa/tenant de prueba
separada en vez de usar `empresaId=1`. Ver
[[feedback-no-probar-destructivo-en-bd-real]].

`node --test`: 29/29. `vite build`: sin errores.

## 3. Confirmado a pedido del usuario: aislamiento multi-tenant de "eliminar-todo"

El usuario preguntó si la acción podía afectar a otros tenants. Confirmado
que no: `POST /api/inventario/eliminar-todo` filtra siempre por
`empresaId: req.empresa.id` (`backend/routes/inventario.js:167-169`), y
`req.empresa` lo resuelve `middleware/auth.js:57-89` server-side a partir
del JWT de la sesión (o el `empresaId` del usuario en BD) — nunca desde el
body/query de la petición. Mismo patrón que el resto de rutas del archivo
(`/resumen`, `/movimientos`, etc.) y de todo el backend. Es justamente por
esto que el incidente del punto 2 solo afectó a Corp Simtelec (la única
empresa contra la que estaba logueada la sesión de prueba) y no tocó datos
de Puchaicela ni de ningún otro tenant en la misma BD local.

## 4. Bug real encontrado y corregido: importar Excel fallaba con archivos grandes

El usuario reportó (con captura) un error al actualizar el inventario
subiendo la plantilla: `Transaction API error: Transaction already closed:
... The timeout for this transaction was 5000ms, however 5003ms passed
since the start of the transaction`.

**Causa raíz**: `importarProductos()` recorre cada fila del Excel de forma
secuencial (buscar producto existente, crear/actualizar, y si aplica
registrar el movimiento de inventario — varias queries por fila), todo
dentro de **una sola transacción interactiva** de Prisma. El timeout por
defecto de Prisma para ese tipo de transacción es 5000 ms; con una
plantilla de tamaño real (decenas de productos) se excede antes de
terminar y Postgres cierra la transacción a mitad de camino.

**Fix** (`backend/routes/productos.js`): las 3 rutas de importación
(`/importacion/excel`, `/importacion/xml`, `/importacion/autorizacion`)
ahora pasan `{ maxWait: 10000, timeout: 300000 }` como opciones de
`$transaction`, dándole hasta 5 minutos a un lote grande.

**Bug adicional encontrado de paso (mismo síntoma, distinta causa)**: al
reproducir el error localmente sin un tenant resuelto (modo monoinstancia
sin slug — el mismo modo en que corren varios clientes reales, ver la
nota de la sesión 2026-08-07 sobre "Railway dedicado por cliente, sin
SaaS multi-tenant"), `/importacion/excel` y `/importacion/xml`
fallaban de inmediato con `Cannot read properties of undefined (reading
'$transaction')`: usaban `req.prisma.$transaction(...)` sin respaldo, y
`req.prisma` solo se define cuando `resolverTenant` resuelve un slug
(`middleware/tenant.js`) — en monoinstancia nunca se asigna. El resto del
backend ya cubre este caso (`auth.js`/`empresas.js` con middleware
`req.prisma = req.prisma || prisma` al tope del router; `buzon.js` con
`(req.prisma || prisma).$transaction(...)` inline) — productos.js era la
única ruta con `req.prisma` sin ese respaldo. Aplicado el mismo patrón
`(req.prisma || prisma)` a los 2 endpoints.

**Verificado** con importaciones reales de tamaño creciente (código
sintético, sin tocar ningún producto real): 150 filas (1.6s), 1000 filas en
el peor caso — cada fila con movimiento de inventario — (6.7s, ~6.7ms/fila),
y 3000 filas en el mismo peor caso (20-21.5s, ~7ms/fila estable). El usuario
avisó después que su plantilla real es de "más de 600" productos — a ese
ritmo (~7ms/fila) el margen de 300s cubre cómodamente varios miles de
filas. Re-subir el mismo archivo dos veces no duplicó nada (segunda subida:
0 creados, todo actualizado). Datos y usuarios de prueba eliminados al
terminar. `node --test`: 29/29.

## 5. Bug real encontrado y corregido: importación perdía precios y códigos de barra largos (tenant Comercial S&S)

El usuario reportó (con captura, tenant `aela_sys` — Comercial S&S) que al
importar su plantilla real todos los precios quedaban en $0.00 aunque el
archivo sí los tenía, y por separado que algunos códigos de barra se
guardaban truncados como `7.80223E+12`.

**Causa 1 — precios en $0.00**: el encabezado real del archivo del usuario
es `precio de venta` (con espacios), no `precioVenta`. `normalizarTexto()`
quita los espacios (`preciodeventa`) pero ese alias faltaba en
`HEADERS.precioUnitario` (`backend/utils/importacionProductos.js`) — nunca
emparejaba con ninguna columna y el precio caía al default 0. Fix:
agregado `preciodeventa` (y `preciodecompra` para costo, mismo patrón).

**Causa 2 — códigos en notación científica**: códigos EAN-13 guardados como
número sin formato de Texto se muestran en notación científica bajo
formato "General" de Excel. `leerFilasDesdeExcel()` lee con `raw:false`
(necesario para precios — el archivo trae fórmulas con muchos decimales,
ej. `0.8695652173913044`, y el valor mostrado `0.87` es el correcto), y
ese mismo modo trunca los códigos largos a su forma mostrada. Fix: se lee
también en paralelo con `raw:true`, y solo cuando el valor formateado luce
como notación científica (regex) se reconstruye el entero completo desde
el valor numérico crudo — el resto de columnas no coincide con el patrón y
no se toca.

**Verificado** contra el archivo real del usuario (642 filas, sin escribir
a ninguna BD — solo parseo puro): 0 productos con precio 0 tras el fix
(antes 642/642), 0 códigos con notación científica restante, precios
siguen redondeados igual que antes (ej. `0.26`, no `0.2608695652...`). 2
tests de regresión nuevos (`test/importacionProductos.test.js`).
`node --test`: 31/31.

**🔴 Aviso para el usuario, no es un bug de código — dato del archivo**:
al revisar el archivo se encontraron **4 códigos repetidos dentro del
mismo archivo**; al importar, cada fila con un código repetido
sobrescribe a la anterior con el mismo código y solo queda la última:

- `7861055904049` — fila 180 "NUTRI LECHE F 900ML ENTERA" vs fila 183
  "NUTRI LECHE FUNDA POLITELENO 900ML ENTERA"
- `ARROCILLO` — fila 187 "*ARROCILLO DULCE" vs fila 492 "ARROCILLO"
- `7861001719789` — fila 285 "ACEITE ALESOL FUNDA 900ML X 12" vs fila 358
  "ALESOL DE 1LT"
- `TARJETA` — filas 615-618, las 4 tarjetas Claro (5.50, 1.10, 3.50, 2.50)
  comparten el código literal `TARJETA` en vez de uno único por monto

**Actualización — esto ya no requiere acción manual**, ver punto 6: el
usuario pidió que si el código se repite con un nombre distinto se le cree
un código diferente en vez de perderlo, y eso ya quedó implementado.

## 6. Auto-resolución de códigos duplicados dentro del mismo archivo

Primer intento (descartado): editar directamente el Excel del usuario con
la librería `xlsx` para renombrar los 4 grupos de códigos repetidos.
**Ese intento dañó el archivo** — al reescribirlo con `XLSX.writeFile()`,
el formato de precios de TODO el archivo (no solo las 6 filas tocadas) se
corrompió: precios como `3.04` volvían a mostrarse como `3.043478261`
incluso en filas nunca editadas. SheetJS no reconstruye fielmente el
estilo numérico original en un ciclo lectura→escritura de este archivo en
particular. El archivo corregido se descartó por completo, sin subirlo a
ningún lado.

**Fix real, a nivel de sistema en vez de tocar el archivo**:
`importarProductos()` (`backend/utils/importacionProductos.js`) ahora
desambigua códigos duplicados en memoria antes de guardar, con
`desambiguarCodigosDuplicados()`. Si el mismo código aparece en varias
filas con nombres distintos, las filas siguientes reciben un código único
(`${codigo}-2`, `${codigo}-3`, ...) conservando el original en la primera
aparición; si el nombre repetido es el mismo producto, se deja igual (se
asume que es el mismo producto y gana la última fila, comportamiento
previo). El resumen de la importación ahora incluye `codigosDesambiguados`
y el frontend lo muestra en un aviso amarillo con el detalle código
original → nuevo, para que el usuario los revise y les ponga el código
real cuando lo tenga.

**Verificado con el archivo real completo** (642 filas, importación
completa contra un tenant local aislado — nunca contra Comercial S&S): 642
creados, los 6 casos desambiguados correctamente, precios correctos en BD
(ej. la 3ra tarjeta Claro → `$3.04`, no el valor crudo con decimales de
más). Datos y usuario de prueba eliminados al terminar. 3 tests de
regresión nuevos. `node --test`: 34/34. `vite build`: sin errores.

**Sobre "subir al sistema"**: el usuario pidió también subir el archivo ya
corregido al sistema real de Comercial S&S. No se hizo — este entorno no
tiene ni debe tener acceso directo a la BD de producción de ese tenant
(`aela_sys`, en Railway), y no corresponde iniciar sesión como ese cliente
ni ejecutar la importación en su nombre sin que él la vea pasar por la UI
normal. Con el fix ya desplegado, el usuario puede subir el archivo
**original, sin ninguna edición**, directamente desde Productos >
Importación en el sistema — el fix ya resuelve los duplicados
automáticamente.

## 🔴 PARA RETOMAR MAÑANA

1. **Completar los 3 productos `RESTAURAR-1/2/3`** en Productos > Lista
   (búscalos por ese código): ponerles el código real, código auxiliar
   (barras) si tienen, precio de venta, costo y IVA correctos. Hoy quedaron
   con precio/costo en $0 y un código temporal — el sistema los deja
   operar así, pero cualquier venta de esos productos hoy factura a $0
   hasta que se corrijan.
2. **Comercial S&S — subir la plantilla real** (archivo original, sin
   editar) desde Productos > Importación una vez el deploy esté activo;
   los 6 códigos repetidos (2 pares de barcodes + 4 tarjetas Claro) se
   resuelven solos y quedan visibles en el aviso amarillo del resultado de
   importación — revisar esos 6 después y ponerles el código real cuando
   se tenga.
3. El resto del backlog general (Buzón SRI descarga automática en
   producción, app móvil sin verificar en emulador, 16 registros de
   Puchaicela esperando a la contadora, auditoría del patrón `rgba(...)` en
   modo oscuro, etc.) sigue abierto — ver la memoria persistente
   `project_aela_estado.md` sección "Pendientes críticos" para el detalle
   completo, no se tocó nada de eso hoy.

## 7. Continuación de la sesión — precios truncados, exportar inventario, códigos científicos fuera del import de Excel

El usuario volvió con 3 pedidos más sobre el mismo caso de Comercial S&S:

**a) Precios truncados a 2 decimales rompían el IVA al facturar.** Un
producto con PVP real $0.50 (precio sin IVA por fórmula: 0.4347826086956522)
quedaba guardado como $0.43 — en el POS, 0.43 × 1.15 = $0.49, nunca $0.50.
Causa: `leerFilasDesdeExcel()` usaba el valor FORMATEADO de la celda
(`raw:false`) para todas las columnas, incluido precio — Excel lo muestra
redondeado a los decimales del formato de celda, aunque el valor guardado
internamente tiene más precisión. Fix: se invierte la prioridad — ahora se
prefiere el valor numérico CRUDO cuando la celda es un número real, y la
columna `Decimal(14,4)` de la base de datos aplica el redondeo final a 4
decimales. Esto además simplificó el fix de notación científica del punto
anterior (ya no hace falta el regex "E+": al preferir el crudo para toda
celda numérica, un código de barras largo nunca pasa por la versión
truncada). Verificado con el archivo real: precio en BD pasa a `0.4348`,
PVP recalculado `$0.50` exacto.

**b) Exportar inventario a Excel — no existía, se agregó.** Nuevo `GET
/api/productos/exportar/excel` (permiso `productos.ver`) +
`crearExportacionProductosXlsx()`, mismos encabezados que la plantilla de
importación — el archivo se puede editar y volver a subir directo sin
tocar columnas. Botón `⬇ Exportar inventario (Excel)` en el tab
Inventario. Verificado que el archivo exportado es re-importable de forma
idempotente (0 creados, todo actualizado, 0 movimientos falsos).

**c) 28 productos con códigos en notación científica sobrevivieron a
"Eliminar todo el inventario"** — no era un bug de esa función: son
productos con `inventariable:false` (fuera de su alcance por diseño), con
códigos tipo `7.80223E+12` que llegaron corruptos por una vía DISTINTA a
la importación de Excel de productos (ya corregida) — probablemente un
barcode pegado desde una celda de Excel sin formato de Texto en un
formulario de compra, o creado automáticamente al procesar una factura de
compra. El usuario decidió borrarlos manualmente uno por uno para
recargarlo todo. Se generalizó la protección (`pareceNotacionCientifica`)
a los otros 2 puntos donde un código externo puede llegar a
`productos_servicios`: en `comprasInventario.js` (auto-creación desde
compras) se sustituye por un código generado desde la descripción sin
bloquear el registro de la compra; en la creación/edición manual de
productos (`POST`/`PUT /productos`) se rechaza con 400 antes de guardar.
4 tests nuevos. `node --test`: 38/38.

**Nota**: los 28 productos ya existentes en Comercial S&S con este problema
NO se tocaron desde aquí (no hay acceso a esa BD) — el usuario los está
depurando manualmente por la UI.
