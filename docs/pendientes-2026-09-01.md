# AELA ERP — Cierre de sesión 2026-09-01

Sesión con dos frentes: (1) el bug de zona horaria del Dashboard/Caja
Diaria reportado por capturas, llevado a un barrido completo del mismo
patrón en todo el sistema (con un hotfix de por medio, por una
regresión propia detectada en producción), y (2) una línea manual de
POS/Factura/Nota de Venta que ahora puede dar de alta el producto y su
movimiento de inventario, en vez de quedar siempre fuera de catálogo.

## Commits de este tramo

| Commit | Qué |
|---|---|
| `61a611c` | fix: bug de zona horaria (UTC servidor vs Ecuador) en fechas por defecto |
| `cd7e00e` | fix: ReferenceError 'ahora is not defined' en GET /empresas/estadisticas (hotfix de una regresión propia introducida por `61a611c`, detectada en logs de Railway) |
| `fba7947` | fix: barrido final del bug de zona horaria en defaults mes/año (F104/F103/F101/ATS/numeración) |
| `220757d` | feat: línea manual de POS/Factura/NV puede crear el producto y su movimiento de inventario |

Todo implementado, verificado (`node --test` 73/73, `npx vitest run`
18/18, `npx vite build` limpio en cada paso) y pusheado a
`origin/main` — no hay código a medio terminar.

## Resumen de lo hecho

### 1. Bug de zona horaria (UTC servidor vs Ecuador) — resuelto y generalizado

Railway corre el proceso backend en UTC. Después de ~19:00 hora
Ecuador el servidor ya "cree" que es el día siguiente. Motivado por
capturas del usuario: el Dashboard mostraba $0.00 en "ventas del mes"
a las 22:02, y Caja Diaria abría/mostraba la fecha de mañana.

**Dos familias de helpers nuevas en `backend/utils/fechas.js`**, según
qué tipo de campo de fecha se está filtrando:
- **Timestamps reales** (`createdAt`, `cerradaEn`): `inicioDiaEC` /
  `finDiaEC` / `inicioMesEC` / `finMesEC` / `inicioAnioEC` /
  `finAnioEC` — anclan a medianoche Ecuador real (05:00 UTC).
- **Campos "solo-fecha"** (`fechaEmision`, `fechaOperacion`,
  `asientos_contables.fecha`): se guardan como medianoche UTC EXACTA
  representando el día calendario, sin hora real — usar los de arriba
  los desalinearía 5 horas contra filas ya existentes. Para estos:
  `rangoDiaSoloFecha` / `rangoMesSoloFecha` / `rangoAnioSoloFecha`, y
  el primitivo `diaCalendarioEC(valor)` (si `valor` ya es
  "YYYY-MM-DD" lo devuelve tal cual, nunca lo reinterpreta).
- Nuevo también: `mesAnioActualEC()` → `{ anio, mes }` del día
  calendario Ecuador actual, para los defaults de reportes mensuales
  (F104/F103/ATS) que antes usaban `new Date().getMonth()+1`.

**Landmine de idempotencia descubierta y corregida**: aplicar
`diaCalendarioEC` DOS VECES sobre un mismo `Date` ya normalizado mueve
el día un día hacia atrás (la segunda pasada reinterpreta una
medianoche UTC como si fuera un timestamp real en hora Ecuador).
Pasaba en `backend/routes/caja.js` → `/apertura`, que normalizaba la
fecha y luego se la pasaba a `obtenerOCrearCajaDelDia`, que normaliza
otra vez internamente. Corregido en dos frentes:
`normalizarFechaOperacion` (`backend/utils/caja.js`) ahora es
idempotente por construcción (si el valor ya es una medianoche UTC
exacta, lo devuelve tal cual), y se quitó la normalización redundante
en la ruta.

**Archivos backend corregidos** (Dashboard, Caja Diaria, Contabilidad,
Talento Humano, Notas de Venta, numeración de asientos, F104/F103/F101,
ATS):
- `backend/routes/empresas.js` — `GET /estadisticas` (stats del
  Dashboard: ventas del mes, caja de hoy, alertas RIMPE).
- `backend/utils/caja.js` + `backend/routes/caja.js` — apertura,
  cierre, resumen, movimientos de caja.
- `backend/routes/contabilidad.js` — Balance General, Flujo de
  Efectivo, Cambios en el Patrimonio (defaults al cargar sin fecha
  explícita — impacto real bajo, son límites superiores "hasta hoy",
  no rangos que puedan ocultar datos, pero se corrigieron por
  consistencia).
- `backend/routes/talentoHumano.js` — dashboard TH (nómina del mes).
- `backend/routes/notasVenta.js` — contador "usadasAño" (límite anual
  de comprobantes) usaba el año del servidor como límite inferior —
  este SÍ era de la misma familia de bug real que el del Dashboard
  (la noche del 31 de diciembre hora Ecuador se habría quedado en 0
  pese a haber notas de venta reales ese día).
- `backend/routes/facturas.js`, `backend/routes/declaraciones.js`
  (F104/F103/F101), `backend/routes/ats.js` — defaults de mes/año
  cuando no vienen por query (no confirmados alcanzables hoy vía UI,
  el frontend siempre manda mes/año explícitos, pero corregidos por
  consistencia con `mesAnioActualEC()`).
- `backend/utils/contabilidad.js` — `siguienteNumeroAsiento` /
  `siguienteNumeroGenerico` (numeración de asientos/comprobantes):
  el default de fecha ahora usa `diaCalendarioEC()`, evita que un
  documento se numere bajo el mes equivocado si se crea cerca de
  medianoche UTC en fin de mes. **No se tocaron** los ~30 defaults
  `fecha = new Date()` de las funciones `crearAsiento*` de ese mismo
  archivo — esos son timestamps de "esto ocurrió ahora" (evento real),
  no límites de rango de un reporte, así que "ahora" en UTC sigue
  siendo el instante correcto ahí.

**Frontend** — reemplazado `new Date().toISOString().slice(0,10)` /
`.split('T')[0]` (siempre UTC) por `hoyLocal()` (ya existía en
`frontend/src/utils/fecha.js`, usa hora local del navegador — nunca se
había adoptado en estos archivos) en todos los date-pickers que
usaban "hoy" por defecto: `CajaDiaria.jsx`, `FormGuiaRemision.jsx`
(+ `fechaLocalOffset(1)` para "mañana"), `ReportesRestaurante.jsx`,
`BancosHub.jsx`, `ComprobantesView.jsx`, `ListaEmpleados.jsx`,
`CuentasPorCobrarHub.jsx`, `CuentasPorPagarHub.jsx`,
`ContabilidadHub.jsx`. Se dejó explícitamente sin tocar
`ReportesRestaurante.jsx`'s `primerDiaMes()` (ya era seguro por
construcción) y los `toISOString()` de nombres de archivo exportado en
`ListaCompras.jsx`/`ListaFacturas.jsx`/`ListaRetenciones.jsx`/
`ListaRetencionesRecibidas.jsx`/`GestionProductos.jsx` (cosmético, no
afecta lógica de negocio).

**Regresión propia detectada y corregida en el camino**: al reemplazar
`const ahora = new Date()` por los helpers de rango en `empresas.js`,
quedaron 6 referencias sueltas a `ahora` sin actualizar (año/mes del
dashboard, mensajes de alerta RIMPE) — rompía `GET
/empresas/estadisticas` en producción con `ReferenceError: ahora is
not defined` (visto en logs de Railway, pegados por el usuario).
Corregido en minutos con `cd7e00e`.

### 2. Línea manual de POS/Factura/Nota de Venta → puede crear el producto en el catálogo

Reportado con captura: al agregar un producto de forma manual en POS
(código que no existe en el catálogo), la venta se registraba pero el
producto nunca aparecía en Gestión de Productos ni generaba movimiento
de inventario — por diseño, una línea manual siempre fue "cobrar algo
fuera de inventario" (mismo patrón ya usado en Factura/Nota de Venta).
Se preguntó al usuario cómo quería resolverlo (checkbox opcional vs.
crear siempre vs. dejarlo así) — eligió el checkbox opcional.

- **Frontend** (`PuntoVenta.jsx`): checkbox "Añadir al catálogo" bajo
  el código, visible SOLO en líneas manuales (no en las tomadas del
  buscador de catálogo). Desmarcado por defecto — el comportamiento
  previo queda intacto si no se toca. Validación: si se marca sin
  código, no deja emitir.
- **Backend** (`backend/utils/inventario.js` →
  `aplicarMovimientosVentaDesdeDetalles`, compartido por `POST
  /facturas` y `POST`/`PUT /notas-venta`): antes de aplicar los
  movimientos de venta, crea los productos marcados con
  `crearEnCatalogo:true` que no existan ya (código/nombre/precio/IVA
  de la propia línea, `inventariable:true`), luego sigue el flujo
  normal (que ya hacía matching por código) — así el producto recién
  creado también recibe su movimiento de salida en la misma
  operación. Idempotente por código (dos líneas con el mismo código
  nuevo no duplican), respeta el límite de catálogo del plan Lite
  (200 productos), y nunca corre en el sentido "revertir" (anulación).
- Verificado con un mock de la interfaz Prisma (`tx`) — 4 escenarios:
  crear + descontar stock + registrar movimiento; código repetido no
  duplica; línea sin marcar sigue sin tocar inventario (comportamiento
  previo intacto); revertir nunca crea productos.

## 🔴 Pendientes para continuar

**Ninguno de los pendientes de abajo es un bug conocido** — son
verificaciones humanas y hallazgos de bajo impacto identificados
durante el barrido de zona horaria, no tocados hoy.

1. **Nada de lo de hoy se probó clic a clic contra la app real** —
   todo se verificó por lectura de código, mocks del código de
   inventario, tests automatizados y build limpio, pero falta una
   pasada manual del usuario: confirmar el Dashboard/Caja Diaria
   pasadas las 19:00 hora Ecuador, y probar el checkbox "Añadir al
   catálogo" en POS de verdad (crear un producto nuevo desde una venta
   y confirmar que aparece en Gestión de Productos con el movimiento
   de inventario correcto).
2. **Cierre de cajas "pendientes" de sesiones anteriores** — si
   quedaron cajas abiertas bajo el bug viejo (fecha de "mañana"), el
   procedimiento ya está confirmado: en Caja Diaria, pestaña
   "Historial reciente" para ver bajo qué fecha real quedó guardada
   cada una, cambiar el selector de fecha a esa fecha y usar la
   pestaña "Cierre" (no hay restricción de "debe ser hoy" en el
   backend). Para ver movimientos de un día puntual: pestaña
   "Movimientos del día" (filtrada por el selector de fecha).
3. **Hallazgos de bajo impacto, no reachable hoy vía UI** (defensa en
   profundidad, no bugs activos): `backend/routes/contabilidad.js`
   (`notas-eeff`, `cierre-ejercicio`, `apertura-ejercicio`) y
   `backend/utils/sriScraper.js` siguen con `new Date().getFullYear()`
   como default — son filtros de igualdad o valores que el usuario
   escribe/confirma a mano en el formulario, no límites de rango de
   una consulta, así que el peor caso es mostrar el año equivocado por
   un momento (corregible al toque desde la UI), nunca datos faltantes.
   No se tocaron por relación costo/beneficio — revisar solo si algún
   día se reporta un síntoma real ahí.
4. **Hilos sin cerrar de sesiones anteriores** (no tocados hoy, ya
   documentados desde `pendientes-2026-08-31.md`): verificación en
   dispositivo móvil real vía Expo (`mobile_app_estado.md`). El otro
   hilo de esa lista (campo "Código" del carrito POS) quedó CONFIRMADO
   por captura del usuario en esta sesión — ya no está pendiente.

## Al retomar

`git fetch` + revisar este documento. El plan de Caja Chica
(`replicated-cuddling-petal.md`) sigue completo en sus 4 fases, sin
cambios desde el 31 de agosto.
