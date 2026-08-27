# AELA ERP — Sesión 2026-08-27 — POS manual, editar nota de venta, modal de anulación de facturas

## Pedido del usuario

1. En POS, poder agregar producto de forma manual, igual que en Factura o
   Nota de Venta.
2. Permitir editar una nota de venta ya emitida (no es documento
   electrónico validado en línea por el SRI) y reimprimirla.
3. En anulación de facturas autorizadas, presentar un modal con dos
   opciones: crear NC (recomendado con productos inventariables) o
   anular directamente sin NC (avisando que además hay que anular en el
   portal del SRI) — pero solo dentro de una ventana libre. A partir del
   día 7 del mes siguiente a la emisión, ya no se pregunta: se fuerza NC
   automática como hace el sistema desde siempre (ejemplo dado: factura
   del 15 de agosto, anulada el 8 de septiembre → sin modal, NC directa).

## 1. POS — línea manual + edición de código/descripción/IVA

`PuntoVenta.jsx`: el carrito identificaba cada línea por `codigoPrincipal`
— frágil para líneas manuales (código vacío o repetido). Se agregó `uid`
estable a cada línea (contador local, no depende de `crypto.randomUUID`
por compatibilidad) y se migraron `actualizarLinea`/`quitarLinea` a
operar por `uid`.

- Botón "+ Agregar línea manualmente" (mismo texto que Factura/Nota de
  Venta) agrega una línea vacía editable.
- Código y descripción pasan de texto fijo a `<input>` editable en todas
  las líneas (antes solo cantidad/precio eran editables).
- Columna IVA (select, mismas opciones que `FormFactura`) solo se
  muestra con `tipoDocumento === 'factura'` — en nota de venta el IVA no
  afecta el total ni se envía al backend (ver hallazgo de la sesión
  anterior sobre `PuntoVenta.jsx` calculando `total = subtotal` para
  nota de venta).
- Validación nueva antes de emitir: todas las líneas necesitan
  descripción (antes no hacía falta, porque siempre venían del catálogo).

## 2. Editar nota de venta

Nueva ruta `PUT /api/notas-venta/:id` (`backend/routes/notasVenta.js`).
A diferencia de una factura, la nota de venta no está validada en línea
por el SRI, así que se corrige en el MISMO registro (mismo numeroNota/
secuencial) en vez de anular + reemitir:

- Revierte inventario/caja de los datos ANTERIORES
  (`aplicarMovimientosVentaDesdeDetalles` con `revertir:true` +
  `ANULACION_NOTA` en caja) y aplica los NUEVOS — todo en una transacción.
- Bloquea editar una nota ya anulada, y bloquea editar si el asiento
  contable ya está en un período cerrado/bloqueado (mismo criterio que
  `POST /facturas/:id/regenerar-asiento`).
- Regenera los asientos automáticos (venta + costo de venta): se
  eliminan los existentes (`NV-{id}`, `NV-COSTO-{id}`) y se vuelven a
  crear con los totales nuevos.

**Bug encontrado y corregido de paso** (`utils/contabilidad.js`,
`crearAsientoCostoVentaNotaVenta`): el cálculo de costo de venta sumaba
TODOS los movimientos de inventario con `tipo: 'VENTA_NOTA'` bajo esa
referencia, sin restar los `ANULACION_NOTA` — al editar una nota (que
reutiliza la misma referencia), esto habría duplicado el costo
contabilizado. Se corrigió a un neteo VENTA_NOTA − ANULACION_NOTA; sin
historial de ediciones/anulaciones el resultado es idéntico a antes
(cambio retrocompatible).

Frontend: `FormNotaVenta.jsx` ahora sirve para crear (`/notas-venta/nueva`)
Y editar (`/notas-venta/:id/editar`, ruta nueva en `App.jsx`) — carga los
datos existentes, cambia textos/botones según el modo, y hace `PUT` en
vez de `POST`. Botón "✏️ Editar" agregado en `DetalleNotaVenta.jsx` y en
la lista (`ListaNotasVenta.jsx`).

**Limitación conocida, no resuelta**: el formulario no tiene UI para
pagos mixtos (`pagos: [...]`, usado por notas creadas desde POS con 2+
formas de pago) ni para código de producto — al editar una nota así,
se conserva el código internamente (no se pierde el vínculo de
inventario) pero la forma de pago se colapsa a una sola. Si hace falta
corregir una nota con pago mixto, mejor hacerlo desde POS (anular +
recrear) hasta que se pida una edición completa ahí también.

## 3. Modal de anulación de facturas — NC / sin NC + ventana libre

Nuevo `backend/utils/anulacionFactura.js`:
`requiereNCAutomaticaPorVentana(fechaEmision, fechaActual)` — día de
corte = día 7 del mes siguiente a la emisión (a partir de esa fecha,
inclusive, se fuerza NC). 6 tests en
`backend/test/anulacionFactura.test.js` (incluye el ejemplo exacto del
usuario y el cruce de año).

`routes/facturas.js` (`POST /:id/anular`):
- `crearNC` en el body — solo se respeta si NO está vencida la ventana
  libre; si está vencida, se ignora y se fuerza `true` (comportamiento
  histórico, sin excepción).
- Con `crearNC=false`: no se crea NC, la factura queda autorizada intacta
  en el SRI — el mensaje de respuesta avisa que hay que anularla también
  en el portal del SRI.
- El bloqueo de Consumidor Final autorizada (Res.
  NAC-DGERCGC25-00000014) sigue siendo absoluto, se evalúa antes que
  cualquier lógica de ventana/elección.

**Bug preexistente encontrado y corregido de paso**: `config` (los datos
de configuración SRI) se declaraba con `const` DENTRO del bloque
`if (factura.estadoSri === 'AUTORIZADO')`, pero se leía al final de la
función (`if (ncCreada && config) { ... procesarNCEnSRI ... }`) FUERA de
ese bloque — `ReferenceError` en tiempo de ejecución, cada vez que
realmente se creaba una NC de anulación. Como la respuesta HTTP ya se
había enviado (`res.json` antes del `setImmediate`), el error quedaba
silencioso en el catch (sin poder reenviar la respuesta) y la NC nunca
se firmaba ni se enviaba al SRI. No parece haberse disparado en
producción hasta ahora (las anulaciones de esta sesión usaron facturas
NO autorizadas o el flujo de notas de venta, no este código exacto).
Corregido declarando `let config = null;` al nivel de la función.

Frontend (`ListaFacturas.jsx`): el modal de anular ahora tiene 3
variantes según `estadoSri`/ventana:
- No autorizada: igual que siempre (confirmar + revertir).
- Autorizada, dentro de la ventana libre: radio buttons "Crear NC" /
  "Anular sin NC" + aviso de ir al portal del SRI cuando se elige la
  segunda opción.
- Autorizada, ventana vencida: igual que siempre (NC automática, sin
  elegir).

`frontend/src/utils/fecha.js`: `ventanaLibreAnulacionVencida()` — misma
lógica que el backend, usada solo para decidir qué UI mostrar (el
backend es quien realmente la hace cumplir, el frontend es solo
conveniencia — mismo patrón que Negocio Popular).

## Verificación

- `node --test` (backend): 68/68 (incluye los 6 tests nuevos).
- `npx vitest run` (frontend): 16/17 — el 1 que falla es preexistente
  (`construirSistemaFallback`/plan lite), no relacionado, documentado
  desde la sesión del 25 de agosto.
- `npx eslint` sobre los archivos tocados: sin errores.
- `npx vite build`: sin errores.
- No se tocó `schema.prisma` — no aplica actualizar
  `applySchemaFixes.js`.

## Pendiente para retomar

- Verificar visualmente en navegador (Playwright) los 3 flujos nuevos —
  no se hizo en esta sesión por falta de datos de prueba con facturas
  autorizadas reales a la mano; la lógica se verificó con tests
  unitarios y lectura cuidadosa del código existente.
- Si se pide edición completa de notas de venta con pago mixto, extender
  `FormNotaVenta.jsx` con UI de pagos múltiples (ver limitación arriba).
