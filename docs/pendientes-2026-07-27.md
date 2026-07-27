# AELA ERP — Sesión 2026-07-27 — Auditoría WebServices/AVALAB + Modo offline del POS

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main` (commits `123a5ae`, `2430ce5`, `6209ef9`).
Nada sin commitear.

1. **Probar en producción con datos reales**:
   - Confirmar `[schema-fix]` en logs de Railway para `facturas.idempotencyKey`
     / `notas_venta.idempotencyKey`.
   - **Prueba real de offline**: en el navegador, DevTools → Network →
     Offline, hacer una venta desde el POS (Factura y Nota de Venta),
     confirmar que aparece el modal "Venta guardada en este dispositivo" y
     que queda en IndexedDB (`Application → IndexedDB → aela_offline →
     pending_ops`). Volver a "Online", confirmar que se sincroniza sola
     (banner amarillo "N pendiente(s)" + botón "Sincronizar ahora" como
     respaldo manual) y que la factura/nota queda con la fecha real de la
     venta, no la de sincronización.
   - Confirmar que el aviso "Venta sincronizada — ahora es Factura ..."
     aparece si el cajero sigue en la pantalla del POS cuando sincroniza.
2. **Coordinar con AVALAB** cuándo hacen la primera llamada HTTP real usando
   `docs/integracion-avalab.md` (documento de la sesión anterior) — sigue
   pendiente, no depende de código.

---

## Parte 1 — Auditoría del módulo WebServices API (AVALAB)

El usuario pidió revisar el estado del módulo `/api/ext/v1/*` — no existe un
tenant "AVALAB": AVALAB es el sistema de facturación externo del tenant real
**Laboratorio San José**. AELA no factura nada de este cliente, solo importa
facturas/pagos ya autorizados por el SRI para llevar contabilidad.

- **Bug real encontrado y corregido** (commit `123a5ae`): `POST /facturas`
  ignoraba el establecimiento/punto de emisión embebidos en `numeroFactura`
  — quedaban siempre en el default `001`/`001`. Verificado antes/después con
  script ad-hoc.
- Se creó `docs/integracion-avalab.md` (commit `2430ce5`) — spec completa
  para compartir con el equipo de AVALAB: autenticación, los 5 endpoints con
  schema y ejemplos, códigos de error, plan de pruebas paso a paso. URL de
  producción confirmada viva antes de documentarla.
- Hallazgos menores reportados, no corregidos (bajo riesgo, AVALAB es
  monoempresa): `GET /facturas/:id` no filtra por `empresaId`; los
  endpoints toman `empresas.findFirst()` en vez de que el llamador
  especifique la empresa.

## Parte 2 — Modo offline del POS (Facturas y Notas de Venta)

El usuario preguntó si el sistema funciona sin internet ("se quedan sin
internet pero hay que seguir facturando"). Investigación: existía una
infraestructura offline completa (Service Worker PWA, cola IndexedDB
`offlineDB.js`, wrapper `apiOffline()`, endpoint backend `/api/sync/flush`)
construida hace tiempo pero **nunca conectada a ninguna pantalla real** —
mismo patrón ya visto con la impresora. Si se cortaba la señal, cualquier
venta simplemente fallaba y se perdía.

**Hallazgo de diseño durante la investigación**: `routes/sync.js`
(`/flush`) es una implementación paralela e insegura — confía en
`secuencial`/`claveAcceso` calculados por el cliente, imposible de hacer
bien offline (depende del contador atómico de `puntos_emision`, sesión del
25-07). Se descartó ese endpoint (queda sin usar, no se tocó ni se borró) a
favor del diseño ya usado por `procesarCola()`: reenviar la operación
encolada al endpoint real (`POST /facturas`/`POST /notas-venta`) tal cual un
request online, para que el servidor calcule el secuencial en el momento de
sincronizar.

### Implementado
- `PuntoVenta.jsx`: Facturas y Notas de Venta usan `apiOffline()` — si no
  hay conexión, la venta se guarda en IndexedDB (con la fecha real de la
  venta) y se reenvía sola cuando vuelve la señal. Modal post-venta distinto
  para el caso offline (sin número SRI, sin impresión hasta sincronizar).
  El paso previo de `POST /clientes` se saltea offline — se manda la
  identificación directo en la factura/nota y el backend ya la resuelve
  (`enriquecerClienteDesdeFactura` en `facturas.js`, ya existía).
- **`idempotencyKey`** (nueva columna en `facturas`/`notas_venta`): generada
  por el cliente al encolar, viaja en cada reintento. Si el servidor ya
  había creado la venta pero la respuesta se perdió por otro corte, el
  reintento devuelve la misma venta en vez de duplicarla — **verificado con
  2 requests HTTP reales seguidas** contra el servidor local (misma
  `numeroFactura` en ambas, 1 sola fila en la BD).
- Indicador de conectividad + "N pendientes de sincronizar" con botón manual
  "Sincronizar ahora" en `Layout.jsx` (reutilizó el banner offline que ya
  existía, antes sin contador ni acción).
- Evento `aela:sync-item-ok` (nuevo, en `syncQueue.js`) — avisa con un toast
  cuando una venta encolada finalmente sincroniza, con el número real.

### Fuera de alcance esta sesión (documentado a propósito)
- **Compras** (`FormCompra.jsx`) y **movimientos de Caja Diaria** — mismo
  patrón, se agregan después. No son el caso urgente ("hay que seguir
  facturando") que motivó la pregunta.
- Impresión de un ticket simple sin número fiscal para la venta offline
  (comprobante interno) — no implementado, se puede agregar si se pide.

### Verificación realizada
- `node --test`: 29/29.
- Migración `idempotencyKey` aplicada limpiamente contra `scfi_dev` local.
- **Idempotencia verificada con HTTP real**: 2 `POST /facturas` seguidos con
  el mismo `idempotencyKey` contra el servidor local — el segundo responde
  `200` con la factura ya creada (no `201`), 1 sola fila en la BD, sin datos
  huérfanos en `caja_movimientos`/asientos tras la limpieza.
- `npx vite build`: limpio.
- **No probado**: el flujo completo en un navegador real simulando
  desconexión (Service Worker + IndexedDB + reconexión) — no hay entorno de
  navegador disponible aquí. Ver checklist al inicio de este documento.
