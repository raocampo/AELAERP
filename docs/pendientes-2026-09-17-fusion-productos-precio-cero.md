# Sesión 2026-09-14/17 — Venta por paquete, fusión de productos duplicados, bug de precio $0.00

Cliente: **Comercial S&S** (tenant `aela_sys`, BD dedicada en el mismo
servidor Railway del proyecto; empresaId=1, RUC 1105863839001).

## 1. Venta por paquete/unidad (`0ac2322`, `f4724dd`)

El proveedor vende empacado (ej. funda de 10 Bonice a $1.90) pero el
negocio vende la unidad suelta ($0.25) y a veces también el paquete
completo. El stock siempre se lleva en unidades individuales.

- `productos_servicios` gana 3 campos opcionales (sin cambiar
  comportamiento por defecto): `unidadesPorPaquete` (default 1),
  `nombrePaquete`, `precioPaquete`.
- 5 puntos de integración de compra corregidos (multiplican
  `cantidad × unidadesPorPaquete` para el stock, dividen el costo) +
  1 punto de venta (`aplicarMovimientosVentaDesdeDetalles`, factor
  siempre resuelto server-side, nunca confía en el cliente).
- POS, Factura y Nota de Venta sincronizados: buscador de productos
  muestra un botón extra "📦 [nombrePaquete] — $X" cuando aplica.
- Pendiente: app móvil (mismo patrón, no bloquea uso web).

## 2. Fusión de productos duplicados + alias de código de compra (`1aab005`, `3779262`, `b70ff45`)

Mismo producto real facturado por el proveedor con 2 códigos distintos
(unidad suelta vs. presentación en paquete/caja) creaba 2 filas de
catálogo en vez de una.

- Tabla nueva `codigos_compra_alternos` (empresaId, codigo, productoId,
  unidadesEquivalentes) — vincula un código de proveedor a un producto
  ya existente. `buscarProductoCoincidente` cae a este alias cuando el
  match exacto por código falla (y ahora exige `activo:true` en el
  match exacto, para que un producto fusionado/desactivado libere su
  código al alias).
- `buscarPosibleDuplicadoPorNombre` gana una señal más permisiva por
  marcador de empaque (PAQ, X8, DPLx12, T12/15, /50…) — el Jaccard
  estricto (0.34) no atrapaba "SALCHICHA CARNE...400G" vs "SALCHICHA
  LONCHERA X8...400GR/50" (0.25).
- `POST /productos/:id/fusionar` (botón "🔗 Fusionar" en Gestión de
  Productos, pestaña Lista): traspasa stock convertido, desactiva el
  origen, registra el alias. Sugiere candidatos automáticamente al
  abrir (`GET /productos/:id/candidatos-fusion`) — ya no hay que
  escribir nada para empezar.
- **Importante, aprendido de un caso real**: el campo "unidades
  equivalentes" YA NO se pre-llena con la adivinanza del nombre (ej.
  "X8" → 8) — un paquete que "suena" a X8 puede venderse completo, sin
  dividirse (caso real: la lonchera de salchichas SÍ se vende cerrada).
  Ahora arranca en 1 y pregunta explícitamente; la adivinanza se ofrece
  aparte como sugerencia clicable.
- Mismo tratamiento en "Obsequios pendientes" → "Asignar a producto
  existente": acepta `unidadesEquivalentes` + checkbox "recordar
  código" (para que la próxima compra con ese código resuelva sola).

**Pendiente**: quedan al menos 2 pares sin fusionar en Comercial S&S
(Funda H.G Camiseta 1/2 Negra, Vaso H.G 7oz) — ya se le indicó al
cliente que use el botón él mismo.

## 3. Bug: "Crear producto nuevo" creaba en $0.00 (`e558f2d`)

Reportado con captura: 3 Coca-Cola con PVP correcto visible en la
factura de compra, pero el producto del catálogo en $0.00.

**Causa**: `items_compra_pendientes` nunca guardaba el costo ni el PVP
ya calculados de la línea de compra — `POST
/pendientes/:id/crear-producto` hardcodeaba `costoUnitario: 0` y el
modal arrancaba `precioUnitario` en `'0'` sin ninguna referencia.

**Fix**: 3 columnas nuevas en `items_compra_pendientes`
(`costoUnitario`, `precioVentaReferencial`, `porcentajeIva`),
capturadas al encolar el ítem; el endpoint y el modal las usan como
default (siguen siendo editables).

**Backfill en producción**: barrido completo de `aela_sys` buscando
`infoAdicional LIKE 'Creado manualmente desde Obsequios pendientes%'`
con precio o costo en 0 → **8 productos** corregidos (no solo los 3
reportados), usando los valores ya registrados en el detalle de su
compra origen: 3 Coca-Cola, Biri Biri (x2), Tostadas Naturales, Funda
H.G, Vaso H.G 7oz, Salchicha Pollo X8, Vive 100. Verificado: 0 filas
quedan en 0 tras el fix.

## Verificación (las 3 secciones)

136-138/138 tests backend según el punto de la sesión, `vite
build`/`eslint` frontend limpios en cada commit. Sin test de ruta para
los endpoints nuevos (el proyecto no usa supertest en ningún lado —
todo se testea a nivel de utils con `tx` mockeado); la validación real
de `POST /productos/:id/fusionar` y `POST
/pendientes/:id/crear-producto` se hizo aplicando los fixes de datos
reales contra `aela_sys` (dogfooding).

## Pendientes heredados (sin cambios) — ver docs previos

- Agente Vendedor **Fase 5 (offline)**: decisión abierta — ¿el
  vendedor puede tomar pedido de un cliente NUEVO offline o solo de
  clientes cacheados? Preguntar al usuario.
- Confirmar deploy en Railway y probar clic a clic Fases 1-4 del
  vendedor.
- App móvil: sin soporte de venta por paquete/unidad.
- CxC (`cobros_cliente`) por transferencia no liga movimiento en Libro
  de Bancos.
