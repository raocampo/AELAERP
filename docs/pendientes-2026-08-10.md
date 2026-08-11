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
separada en vez de usar `empresaId=1`.

`node --test`: 29/29. `vite build`: sin errores.
