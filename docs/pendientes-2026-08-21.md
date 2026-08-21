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

## Pendiente para retomar

1. **Verificación humana real** — ni la parte web (probada solo con
   `curl`/API directa) ni la móvil (sin dispositivo) se probaron
   interactivamente. Antes de dar el módulo por completamente cerrado,
   conviene una pasada manual: web (Mesas → todo lo nuevo) y móvil
   (Expo Go o build de desarrollo, tab "Mesas").
2. **Fase 2 móvil** (si se pide): cuentas separadas, pagos mixtos,
   vista de cocina, llamada de mesero, reportes — mismo alcance que la
   web, sin empezar todavía.
3. **Hallazgos previos de la sesión que siguen abiertos** (ver
   `docs/pendientes-2026-08-20.md`, sección "Cierre de sesión"): PDFKit
   rompe acentos en todos los PDFs, Anexo RDEP bloqueado, Anticipo de
   Impuesto a la Renta bloqueado — ninguno tocado hoy, no relacionado
   con el módulo restaurante.
