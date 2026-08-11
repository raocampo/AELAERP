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
ahora pasan `{ maxWait: 10000, timeout: 120000 }` como opciones de
`$transaction`, dándole hasta 2 minutos a un lote grande.

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

**Verificado** con una importación real de 150 filas sintéticas (código
`TESTBULK0001..0150`, sin tocar ningún producto real): primera subida —
150 creados, 1608 ms; segunda subida con los mismos códigos — 0 creados,
150 actualizados, 0 duplicados, 835 ms. Datos y usuario de prueba
eliminados al terminar. `node --test`: 29/29.

## 🔴 PARA RETOMAR MAÑANA

1. **Completar los 3 productos `RESTAURAR-1/2/3`** en Productos > Lista
   (búscalos por ese código): ponerles el código real, código auxiliar
   (barras) si tienen, precio de venta, costo y IVA correctos. Hoy quedaron
   con precio/costo en $0 y un código temporal — el sistema los deja
   operar así, pero cualquier venta de esos productos hoy factura a $0
   hasta que se corrijan.
2. El resto del backlog general (Buzón SRI descarga automática en
   producción, app móvil sin verificar en emulador, 16 registros de
   Puchaicela esperando a la contadora, auditoría del patrón `rgba(...)` en
   modo oscuro, etc.) sigue abierto — ver la memoria persistente
   `project_aela_estado.md` sección "Pendientes críticos" para el detalle
   completo, no se tocó nada de eso hoy.
