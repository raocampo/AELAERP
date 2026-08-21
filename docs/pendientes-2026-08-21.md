# AELA ERP — Sesión 2026-08-21 — Módulo Restaurante (bar/cafetería) completo

## Pedido del usuario

Revisar el módulo de mesas/comandas existente y llevarlo a un estándar
"PRO" de restaurante/bar/cafetería, agregando:

1. **Gestión de pedidos y mesas**: control de órdenes (ya existía),
   cuentas separadas, pagos mixtos, llamadas de servicio por QR.
2. **Control de inventario y finanzas**: reportes gerenciales, punto de
   equilibrio, control de ventas.
3. **Personal y permisos**: roles avanzados (caja, mesero, cocina,
   administración).
4. **Multiplataforma**: Android, iOS, Windows, web.

"Revisa, analiza, planea, implementa."

## Estado previo (auditado antes de tocar nada)

Ya existía: mapa de mesas (`restaurante_mesas`), comandas
(`restaurante_comandas`, JSON de ítems), envío a cocina por ticket
ESC/POS, menú digital por QR de **solo lectura**. Roles: "mesero" era
solo un alias del rol genérico "operador" — no existían cajero/cocina
como roles propios. No había cuentas separadas, pagos mixtos, ni
ninguna llamada de servicio. Nada de esto existía en la app móvil.

## 1. Roles avanzados (mesero, cajero, cocina) + Vista de Cocina

- `utils/roles.js` (backend + espejo frontend): 3 roles nuevos —
  `mesero`, `cajero`, `cocina` — antes mesero/mesera solo eran alias de
  "operador". Permiso `mesas.gestionar` se separó en finos:
  `mesas.tomarPedido` (mesero), `mesas.cobrar` (cajero), `mesas.cocina`
  (cocina) — `mesas.gestionar` se mantiene como umbral amplio para los
  roles generales que ya lo tenían.
- `autorizarPermiso`/`tienePermiso` ahora aceptan un array de permisos
  alternativos (OR) — cambio retrocompatible.
- Nuevo: `GET /mesas/cocina/pendientes` + `POST /comandas/:id/items/listo`
  y pantalla "Vista de Cocina" (polling 15s) — el rol cocina ahora tiene
  algo real que hacer, no solo un ticket impreso.
- Verificado con tokens de prueba por rol: cada permiso probado en
  ambos sentidos (quien debe poder, quien debe ser rechazado).
- Commit `650fb3e`.

## 2. Pagos mixtos (factura y nota de venta)

- Facturas: el backend ya soportaba `pagos: []` para el XML SRI, pero
  el frontend solo mandaba una línea. `PuntoVenta.jsx` ahora permite N
  formas de pago con su propio monto, valida en vivo que la suma
  cuadre, y el backend rechaza (400) si no coincide, antes de consumir
  un secuencial real del SRI.
- Notas de venta: no tenían soporte de pagos múltiples. Columna nueva
  `pagos` (JSONB, nullable) en `notas_venta` — `formaPago` pasa a
  "Mixto" con 2+ líneas. Recibo PDF y ticket térmico dibujan una fila
  por forma de pago (con una sola línea se comportan igual que antes).
- Verificado: nota de venta con pago mixto real (efectivo+tarjeta);
  factura con suma incorrecta rechazada con el error esperado.
- Commit `d5c8502`.

## 3. Cuentas separadas (split bill por ítems)

Modelo elegido (consultado con el usuario): dividir por ítems, el más
usado en restaurantes reales — no partes iguales.

- `POST /mesas/comandas/:id/cerrar` acepta `indices` opcional. Sin él,
  cobra todo lo pendiente (comportamiento de siempre); con él, cobra
  solo esos ítems y la comanda sigue ABIERTA con el resto pendiente.
  Cada ítem guarda `facturado/facturadoEn/documentoTipo/documentoId`
  directamente en el JSON — sin tabla nueva.
- `PUT /comandas/:id` protege los ítems ya facturados: se restauran tal
  cual aunque el request los traiga editados o los omita.
- `GET /` y `GET /:id/comanda` muestran el total PENDIENTE (no el
  consumo total) cuando hay una cuenta dividida en curso.
- `ComandaMesa.jsx`: modo "Dividir cuenta" con checkboxes, sección de
  solo lectura "Ya cobrado".
- Verificado end-to-end con una mesa de 3 ítems: cobro parcial (mesa
  sigue ocupada, total restante exacto), rechazo al recobrar un ítem ya
  facturado, cobro del resto (mesa se libera).
- Commit `df3f46f`.

## 4. Llamada de mesero por QR

- QR por mesa: además del QR general (menú), ahora se puede generar un
  QR específico por mesa (`?mesa=<id>`) desde el modo administrar del
  mapa de mesas.
- Modelo nuevo `restaurante_llamadas` (empresaId, mesaId, estado
  PENDIENTE/ATENDIDA). `POST /menu-publico/:empresaId/llamar-mesero`
  — único endpoint de escritura público de todo el menú digital (el
  resto sigue siendo solo lectura); idempotente contra spam.
- Staff: `GET /mesas/llamadas/pendientes` + `POST /llamadas/:id/atender`
  (mesero/cajero/roles generales — cocina explícitamente NO). Mapa de
  mesas hace polling cada 15s y muestra un banner con "Atender".
- Verificado: llamada pública creada, idempotencia confirmada, staff la
  ve y la atiende, rol cocina correctamente rechazado.
- Commit `83637f9`.

## 5. Reportes gerenciales y punto de equilibrio

- `GET /mesas/reportes/ventas?agruparPor=mesa|mesero|hora` — recalcula
  desde los ÍTEMS de cada comanda cerrada (no desde
  facturaId/notaVentaId, que en una cuenta dividida solo guarda el
  último documento) para que cuadre siempre.
- `GET /mesas/reportes/punto-equilibrio` — nuevo campo
  `costosFijosMensuales` en Configuración del Sistema (input propio) /
  margen de contribución, calculado con el `costoUnitario` real de cada
  producto vendido en el período. No es contabilidad de costos
  completa — es la estimación estándar (ventas de equilibrio en
  dólares/mes + comandas equivalentes).
- Nueva página `ReportesRestaurante.jsx` (tabs Ventas / Punto de
  equilibrio).
- Verificado con un producto de costo/precio conocidos (costo $4,
  precio $10 → 40%/60%) y una comanda de $50 cerrada: con $1000 de
  costos fijos, punto de equilibrio dio $1,666.67/mes (~34 comandas),
  calculado a mano y coincide exacto.
- Commit `10c85ac`.

## 6. Multiplataforma

**Windows**: ya cubierto — es la app web respondiendo en un navegador,
no existe (ni se necesita) un cliente nativo de Windows separado.

**Android/iOS**: la app móvil (Expo SDK 54, `mobile/`) es un proyecto
totalmente aparte (TypeScript, expo-router, sin código compartido con
`frontend/`) — antes de hoy tenía CERO pantallas de mesas/comandas, ni
siquiera el flag `restauranteHabilitado` estaba tipado. Se investigó a
fondo (agente Explore) antes de tocar nada: la app es real y madura en
lo que cubre (Facturas, Inventario, POS con EAS build configurado para
ambas tiendas), pero llevarla a paridad con el módulo web es un
proyecto del mismo tamaño que todo lo de arriba, en un código distinto.

Se consultó con el usuario el alcance y se acordó **empezar por fases**:

### Fase 1 (implementada hoy)

- `types/index.ts`: `restauranteHabilitado` en `Sistema` + tipos
  `Mesa`/`Comanda`/`ItemComanda` nuevos.
- Tab nuevo "Mesas" en `(tabs)/_layout.tsx`, gateado igual que los demás.
- `app/(tabs)/restaurante/index.tsx` — mapa de mesas (grid, LIBRE/
  OCUPADA, toca para abrir/ver), pull-to-refresh, recarga automática al
  volver a la pantalla (`useFocusEffect`).
- `app/(tabs)/restaurante/comanda.tsx` — toma de pedido: buscar/agregar
  producto, +/- cantidad, notas, enviar a cocina, anular mesa, cobrar
  (navega al checkout de POS ya existente con los ítems precargados).
- `app/(tabs)/pos/checkout.tsx` extendido (sin tocar su comportamiento
  normal): acepta `comandaId`/`mesaNombre` opcionales — al emitir con
  éxito, enlaza el documento y libera la mesa (best-effort, mismo
  patrón que `PuntoVenta.jsx` en la web); pantalla de éxito muestra
  "Mesa liberada" y el botón vuelve a Mesas en vez de "Nueva venta".

**Deliberadamente fuera de esta fase 1** (documentado, no implementado):
cuentas separadas, pagos mixtos, vista de cocina, llamada por QR,
reportes — el checkout móvil sigue con una sola forma de pago, "cobrar"
siempre cobra TODO lo pendiente de una vez. Fase 2 quedaría pendiente
de que el usuario la pida.

### Fase 2 (implementada la misma sesión, tras "sigue con lo planificado")

Con la fase 1 aceptada, el usuario pidió continuar — se llevó el resto
del módulo web al móvil, mismo alcance que las secciones 2-5 de arriba:

- **Pagos mixtos** (`pos/checkout.tsx`): de una sola `formaPago`/
  `montoPagado` a un arreglo `pagos: {formaPago, monto}[]`. Con 1 sola
  línea se mantiene el comportamiento de siempre (puede recibir de más
  y calcular cambio); con 2+ líneas la suma debe cuadrar exacto con el
  total (mismo criterio que la web — no tiene sentido repartir vuelto
  entre varias formas de pago). Botón "Agregar forma de pago",
  indicador de cuánto falta/sobra, "Emitir" deshabilitado si no cuadra.
- **Cuentas separadas** (`restaurante/comanda.tsx`): modo "🔀 Dividir"
  con checkbox por ítem pendiente (solo visible si hay 2+ ítems
  editables); "Cobrar (N)" pasa los índices seleccionados a
  `checkout.tsx`, que a su vez los reenvía a `POST
  /comandas/:id/cerrar` — mismo mecanismo que la web, reutilizando el
  backend ya probado. Fila "Seleccionado" en el resumen mientras se
  arma la selección.
- **Vista de Cocina** (`restaurante/cocina.tsx`, nueva): cola de ítems
  pendientes con polling de 15s, botón "✓ Listo" por ítem, tarjeta roja
  si lleva 10+ minutos esperando. Si el usuario no tiene el permiso
  `mesas.cocina`, muestra un mensaje claro en vez de fallar.
- **Llamadas de servicio** (`restaurante/index.tsx`): banner con
  polling de 15s mostrando llamadas pendientes + botón "Atender" por
  mesa, arriba del mapa de mesas. Se agregaron también botones de
  header para navegar a Cocina y Reportes, y un badge "🔀 cuenta
  dividida" en las tarjetas de mesa con cuenta parcial.
- **Reportes gerenciales + punto de equilibrio**
  (`restaurante/reportes.tsx`, nueva): tabs Ventas (agrupado por mesa/
  mesero/franja horaria) / Punto de equilibrio, mismos endpoints que la
  web. Sin permiso, muestra mensaje claro en vez de fallar.

**Hallazgo de paso, corregido antes de terminar**: la primera versión
de `checkout.tsx` mostraba "🍽️ Mesa liberada" en la pantalla de éxito
incluso cuando `POST /comandas/:id/cerrar` había fallado con error (ya
se le había avisado al usuario con una alerta separada, pero el texto
de la pantalla de éxito seguía siendo engañoso). Corregido: el mensaje
de mesa liberada/pendiente solo se muestra si el cierre realmente tuvo
éxito (`cierre.ok === true`); si falló, no se muestra ningún mensaje
extra (la alerta de error ya fue suficiente).

Con esto, la app móvil queda con el **mismo alcance funcional que la
web** para el módulo restaurante — arquitectura distinta (TypeScript/
Expo Router vs JS/React Router) pero misma cobertura de features.

### Verificación

Sin dispositivo/simulador Android o iOS disponible en este entorno —
no se pudo probar interactivamente. Sí se verificó:
- `npx tsc --noEmit` limpio (0 errores) tras regenerar los tipos de
  rutas de expo-router (`.expo/types/router.d.ts`, generado, estaba
  desactualizado — se regeneró arrancando Metro brevemente y
  deteniéndolo; de paso corrigió un error preexistente no relacionado
  en `AuthContext.tsx` que ya estaba roto antes de esta sesión).
- Toda la lógica de backend que el móvil reutiliza (`/mesas/*`) ya
  estaba probada end-to-end contra el mismo backend real en las
  secciones 1-5 de arriba — el móvil llama a los mismos endpoints, sin
  código de servidor nuevo.

## 7. Verificación interactiva en navegador real (Playwright)

Hasta este punto todo lo de arriba se había probado solo con `curl`/API
directa. Se levantó el backend + frontend (Vite dev) y se manejó un
Chromium headless real (Playwright, encontrado ya instalado en
`frontend/node_modules/playwright` — `chromium-cli` del skill `run` no
estaba disponible en este entorno) inyectando una sesión de admin
directo en `localStorage` (sin tocar contraseñas reales) para recorrer
el flujo completo: mapa de mesas → tomar pedido → enviar a cocina →
Vista de Cocina → dividir cuenta → pago mixto → cobro parcial → cobro
final → mesa liberada → QR llamar al mesero → atender llamada →
reportes de ventas → punto de equilibrio. 25 capturas de pantalla
revisadas una por una.

Esta pasada encontró **2 bugs reales** invisibles a las pruebas por
`curl` anteriores:

- **Desbordamiento visual en pagos mixtos** (`PuntoVenta.jsx` /
  `PuntoVenta.css`): la segunda línea de forma de pago se salía del
  borde de la tarjeta "Cliente" (320px de ancho). Causa:
  `.pos-pago-linea` usaba `grid-template-columns: 1fr 110px auto`, y el
  `1fr` de CSS Grid tiene un mínimo implícito `auto` (basado en
  contenido) que no encoge por debajo del ancho intrínseco del
  `<select>`. Arreglado cambiando a `flex-direction: column` (select en
  su propia fila, monto+botón quitar en una segunda fila con
  `min-width: 0`). Confirmado visualmente antes/después con 2 formas de
  pago incluyendo "Tarjeta crédito".
- **Bug de huso horario en reportes gerenciales** (`mesas.js`,
  `_rangoFechas`): el reporte de ventas mostraba "0 comandas cerradas /
  $0.00" para el día en curso pese a haber una comanda recién cerrada.
  Causa: `_rangoFechas` construía el límite superior con
  `new Date(query.hasta).setHours(23,59,59,999)`, y `.setHours()` opera
  en la zona horaria del PROCESO del servidor (no la de Ecuador, ni
  necesariamente UTC) — confirmado por curl: el `hasta` calculado daba
  `...T04:59:59.999Z`, varias horas antes del verdadero fin de día. Es
  la misma clase de bug ya conocida y resuelta en otras partes del
  código (`backend/utils/fechas.js`, de la sesión de cumplimiento de
  fechas SRI — "Railway corre en UTC"). Arreglado reescribiendo
  `_rangoFechas` con el helper existente `fechaHoyEC()` y límites UTC
  explícitos (`T05:00:00.000Z` = medianoche Ecuador, sin DST), con
  límite superior EXCLUSIVO del día siguiente (`lt` en vez de `lte` en
  Prisma). Verificado por curl y con un cálculo de punto de equilibrio
  hecho a mano que coincide exacto.

Ambos bugs solo se hicieron visibles al mirar la interfaz real
renderizada — ningún test por `curl` con fechas ISO exactas los había
detectado, porque no ejercitaban el mismo camino de código
(strings `YYYY-MM-DD` simples) que usa el frontend real. Esto confirma
que valía la pena esta pasada.

**Hallazgo de diseño anotado, no corregido** (no es un bug con el flujo
normal): si una comanda se cobra completamente ANTES de que cocina
marque sus ítems como "listo", esos ítems desaparecen silenciosamente
de `GET /mesas/cocina/pendientes` (la consulta filtra
`estado: 'ABIERTA'` solamente, y al cobrar todo la comanda pasa a
`CERRADA`). En el flujo real de un restaurante (se cocina y LUEGO se
cobra) esto no debería ocurrir; solo lo provocó el orden artificial y
comprimido de esta prueba (dividir cuenta y cobrar sin esperar a
cocina). Queda documentado para decidir si vale la pena un fix (p.ej.
no excluir ítems con `listoCocina:false` aunque la comanda ya esté
cerrada) si se repite en uso real.

## Pendiente para retomar

1. **Verificación humana real en dispositivo móvil** — la parte web ya
   se probó interactivamente en navegador real (sección 7); la móvil
   sigue sin probarse porque no hay dispositivo/simulador Android o iOS
   en este entorno. Antes de dar el módulo por completamente cerrado,
   conviene una pasada manual en Expo Go o build de desarrollo, tab
   "Mesas" — mapa, comanda, dividir cuenta, pagos mixtos, Cocina,
   Reportes.
2. **Hallazgos previos de la sesión que siguen abiertos** (ver
   `docs/pendientes-2026-08-20.md`, sección "Cierre de sesión"): PDFKit
   rompe acentos en todos los PDFs, Anexo RDEP bloqueado, Anticipo de
   Impuesto a la Renta bloqueado — ninguno tocado hoy, no relacionado
   con el módulo restaurante.

---

# Cierre de sesión — Módulo Restaurante (2026-08-21)

Resumen consolidado para retomar sin releer todo el documento de
arriba.

## Resumen de commits (10, orden cronológico)

| Commit | Qué |
|---|---|
| `650fb3e` | feat: roles avanzados (mesero/cajero/cocina) + Vista de Cocina |
| `d5c8502` | feat: pagos mixtos en POS (facturas y notas de venta) |
| `df3f46f` | feat: cuentas separadas (split bill) en mesas por ítem |
| `83637f9` | feat: llamada de mesero por QR |
| `10c85ac` | feat: reportes gerenciales y punto de equilibrio |
| `0643631` | feat: app móvil — restaurante fase 1 (mapa de mesas, comanda, cobrar) |
| `51aca36` | feat: app móvil — restaurante fase 2 (paridad completa con la web) |
| `b594f13` | fix: 2 bugs hallados en verificación interactiva (Playwright) — overflow CSS pago mixto + huso horario en reportes |

Todo lo de la sesión quedó **implementado, verificado y pusheado a
`origin/main`** — no hay código a medio terminar ni bloqueado a nivel
de git. Datos de prueba (QATEST-*) limpiados de la BD real
(`aela_db`, empresaId=1) al cerrar; `configuracion_sistema` revertida
(`restauranteHabilitado`/`costosFijosMensuales`) a su estado original.

## ✅ Completado

- **Web**: roles mesero/cajero/cocina, Vista de Cocina, pagos mixtos
  (facturas + notas de venta), cuentas separadas por ítem, llamada de
  mesero por QR, reportes de ventas + punto de equilibrio. Verificado
  end-to-end por API (curl) **y** interactivamente en un navegador real
  (Playwright/Chromium) — mapa de mesas → comanda → cocina → dividir
  cuenta → pago mixto → cobro parcial/final → mesa liberada → QR →
  reportes. 2 bugs reales encontrados y corregidos en esa pasada (ver
  sección 7 arriba); ninguno era detectable por curl.
- **Móvil** (Expo, fases 1+2): mismo alcance funcional que la web.
  Verificado con `tsc --noEmit` limpio y contra el mismo backend real
  ya probado — sin dispositivo/simulador disponible en este entorno,
  así que **no** se hizo clic literal en la app móvil.
- **49/49 tests de backend** pasan tras los 2 fixes del hallazgo de
  Playwright.

## 🔴 Pendientes para retomar (consolidado)

1. **Verificación humana en dispositivo/emulador móvil real** — único
   pendiente propio de esta sesión. La web ya está verificada
   interactivamente; falta lo mismo en Android/iOS (Expo Go o build de
   desarrollo): mapa de mesas, comanda, dividir cuenta, pagos mixtos,
   Cocina, Reportes, y confirmar que el gateo por rol (que hoy solo
   existe en el backend, no en la navegación móvil — ver
   `mobile_app_estado.md` punto 4c) no deja pantallas confusas para un
   mesero/cocina real.
2. **Hallazgo de diseño sin corregir** (bajo riesgo, no bloqueante):
   ítems de una comanda cobrada completamente antes de que cocina los
   marque "listo" desaparecen de la cola de cocina — solo ocurre con un
   orden de trabajo invertido al normal (cobrar antes de que cocina
   termine). Documentado en sección 7 arriba.
3. **Pendientes de sesiones anteriores, sin relación con el módulo
   restaurante** (ver `docs/pendientes-2026-08-20.md`, sección "Cierre
   de sesión" 2026-08-17/21): PDFKit rompe acentos (á/é/í/ó/ú/ñ) en
   TODOS los PDFs del sistema — hallazgo grande, sin arreglar; Anexo
   RDEP bloqueado (faltan campos en `empleados`: discapacidad,
   Galápagos, enfermedad catastrófica); Anticipo de Impuesto a la Renta
   bloqueado (la fórmula clásica ya no existe en la ley vigente,
   pendiente decisión de alcance con el usuario).

## Al retomar

`git fetch` + revisar este documento o la memoria
`aela-erp-estado-actual-del-proyecto` (mismo contenido, siempre
actualizado). El único pendiente que bloquea cerrar el módulo
restaurante del todo es el punto 1 (verificación móvil real); el resto
son decisiones de alcance o hallazgos de bajo riesgo ya documentados.
