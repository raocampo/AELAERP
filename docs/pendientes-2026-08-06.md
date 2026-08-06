# AELA ERP — Sesión 2026-08-06 — Inventario/gasto personal, duplicados, modal, decimales

## Contexto

El usuario reportó 4 problemas en un solo mensaje:
1. Una compra de medicina (gasto personal, no para reventa) se cargó en inventario.
2. No hay forma de evitar que se dupliquen productos cuando la descripción del
   proveedor no coincide con el nombre ya usado (ej. "cable #8 THHN" del XML vs
   "cable # 8 color verde" ya en catálogo).
3. El modal de crear/editar producto se cierra al hacer click fuera — no debería.
4. Los precios de productos (y de venta, "eso ya se dijo") deben aceptar hasta 4 decimales.

Se investigó primero con 2 agentes en paralelo (solo lectura) antes de tocar código, para no adivinar la causa raíz.

## 1. Modal de producto + precios con 4 decimales (commit `f2be7b9`)

- `GestionProductos.jsx`: quitado el `onClick` del overlay del modal de
  producto — ya no se cierra al hacer click fuera, solo con el botón ✕.
- El schema ya soportaba 4 decimales (`Decimal(14,4)` en `precioUnitario`/
  `costoUnitario`) pero varios inputs tenían `step="0.01"`, truncando
  visualmente a 2. Corregido a `step="0.0001"` en: formulario de productos
  (precio venta + costo), movimiento de inventario, ítem de compra
  pendiente (ObsequiosPendientes), liquidación de compra, nota de venta y
  POS. `FormFactura.jsx` y `FormCompra.jsx` ya estaban bien desde antes.

## 2. Gasto personal ya no afecta inventario (commit `cbe3ab7`)

**Causa raíz** (investigada con un agente, solo lectura, antes de tocar nada):
- El campo `productos_servicios.inventariable` existe y se respeta
  correctamente en TODO el flujo de venta — el bug no estaba ahí.
- El problema: al importar/crear una compra, los checkboxes "Crear
  productos faltantes" y "Registrar entrada en inventario" vienen
  **activados por defecto**, y el campo `esGastoPersonal` (que ya existía,
  usado solo para excluir del F104) **nunca se conectaba con el
  inventario** — además, `esGastoPersonal` solo se podía marcar DESPUÉS de
  crear la compra (en `DetalleCompra.jsx`), nunca al momento de importarla,
  cuando el movimiento de inventario ya se había disparado.

**Fix**:
- `FormCompra.jsx`: nuevo checkbox "Es gasto personal" (con categoría —
  alimentación/salud/vivienda/vestimenta/educación, igual que ya existía en
  DetalleCompra.jsx) disponible desde la creación. Al marcarlo, desactiva y
  deshabilita automáticamente "Crear productos faltantes" y "Registrar
  entrada en inventario".
- `routes/compras.js` (`POST /`): blindaje en backend — si
  `esGastoPersonal` es true, se ignoran esos flags sin importar qué haya
  enviado el frontend. También bloqueado en
  `POST /:id/registrar-inventario` (acción manual retroactiva).

**Para corregir la compra de medicina que ya quedó mal cargada**: en
Detalle de Compra, usar el botón **"Anular"** (ya revierte el stock
automáticamente, confirmado en el código — mensaje existente: *"Anúlela
primero para revertir el stock, luego elimínela"*), y si se quiere, volver
a registrarla marcando ahora "Es gasto personal". No fue necesario
construir nada nuevo para esto, ya existía.

## 3. Detección de posibles productos duplicados (commit `cbe3ab7`)

**Causa raíz**: el matching de producto al importar una compra es
**exclusivamente por código exacto** (`codigoPrincipal`/`codigoAuxiliar`/
`productoId`) — nunca por nombre. Si el proveedor factura con una
descripción distinta a la que el usuario ya usa, no hay match y se crea un
producto nuevo automáticamente (sin ningún aviso).

**Fix**: nueva función de similitud (`similitudNombres` en
`comprasInventario.js`) — normaliza el nombre (sin tildes/puntuación) y
compara por palabras en común (índice de Jaccard, mínimo 2 palabras
compartidas, umbral 0.34). Antes de auto-crear un producto sin match exacto
de código, se busca el producto más parecido por nombre en el catálogo de
la empresa. Si hay uno por encima del umbral, **no se crea el producto** —
se registra en la cola de `items_compra_pendientes` (la misma que ya
existía para regalos/combos a $0.00, ahora reutilizada con un campo
`motivo`: `REGALO` | `POSIBLE_DUPLICADO`, y `productoSugeridoId` con la
sugerencia).

- Aplica en los 3 lugares que auto-crean productos: `POST /compras`,
  `POST /compras/:id/registrar-inventario`, y el import del Buzón SRI.
- La página "Obsequios pendientes" se renombró en el menú a **"Ítems por
  revisar"** (🔍) — ahora muestra también los posibles duplicados, con la
  sugerencia visible y un botón "Sí, es el mismo" para asignar en un clic
  (sin tener que buscar el producto de nuevo).
- Migración `20260806000000_items_pendientes_posible_duplicado` +
  `applySchemaFixes.js` actualizado.

**Verificado**:
- Función de similitud probada contra 7 casos representativos del rubro del
  usuario (cables, tubos, cemento, alambre) — 6/7 se comportan como se
  esperaba. El único "falso positivo" (tubo PVC 1/2" vs 3/4", productos
  realmente distintos) es aceptable en un sistema de *sugerencia* — el
  costo es un click de más ("Crear producto" en vez de "Sí, es el mismo"),
  no un error silencioso.
- Flujo completo probado end-to-end contra `aela_db` real: se creó
  temporalmente el producto "CABLE # 8 COLOR VERDE", se simuló una línea de
  compra "CABLE #8 THHN" con código de proveedor distinto, y se confirmó
  que NO se crea un producto duplicado, que la sugerencia apunta al
  producto correcto, y que el catálogo no creció — todo limpiado después.

`node --test`: 29/29 en ambos commits. `vite build`: sin errores.

## Pendientes / limitaciones conocidas (fuera de alcance de esta sesión)

- La detección de duplicados **no cubre el Buzón SRI cuando se marca
  "gasto personal"** — ese flujo de importación masiva no tiene UI para
  marcar una factura individual dentro de un lote como gasto personal
  (solo un interruptor global de inventario para todo el lote). Si el
  usuario vuelve a recibir una factura de medicina por Buzón SRI mezclada
  con compras reales, debe desactivar el interruptor global de inventario
  para todo ese lote, o cargar la de medicina por separado con
  "Nueva Compra" (donde sí está el checkbox nuevo).
- El umbral de similitud (0.34) es un valor razonable pero no afinado con
  datos reales de producción — si en la práctica genera demasiados falsos
  positivos/negativos, ajustar `UMBRAL_POSIBLE_DUPLICADO` en
  `comprasInventario.js`.
