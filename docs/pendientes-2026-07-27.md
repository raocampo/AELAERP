# AELA ERP — Sesión 2026-07-27 — Auditoría WebServices/AVALAB + Modo offline del POS + Libro Mayor + Centro de Ayuda

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main` (commits `123a5ae`, `2430ce5`, `6209ef9`, `1b7edd8`,
`30700f6`, `368d54e`). Nada sin commitear.

0. **Libro Mayor**: probar en el navegador real (no solo el PDF, ya
   verificado) — Contabilidad → Libro Mayor, escribir "ret" (o cualquier
   parte de un nombre de cuenta) en el nuevo buscador y confirmar que
   filtra bien; con una cuenta de muchos movimientos confirmar que aparece
   el paginador "Página X de Y" en vez de listar todo de una vez.

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

## Parte 3 — Libro Mayor: PDF real, paginación y selector de cuenta buscable

El usuario compartió el PDF que genera "Libro Mayor" y confirmó que estaba
mal. Causa: `GET /contabilidad/reportes/mayor?formato=pdf`
(`backend/routes/contabilidad.js`) armaba el PDF con `doc.text(...)` línea
por línea separada por `|` — sin tabla, sin encabezado, y siempre anexaba
la mayorización de TODAS las cuentas aunque se hubiera filtrado una sola.

**Nota aparte, no corregida en código**: el PDF compartido mostraba cuentas
con 2 formatos de código distintos (`1.1.03.001` con puntos vs `1010505`
sin puntos) — es un problema de **datos** del plan de cuentas de ese tenant
puntual (probablemente de una importación NIIF/Excel, sesión 07-03), no un
bug del reporte. Pendiente de decidir con el usuario si vale la pena
limpiar esos códigos duplicados en ese tenant.

### Implementado
- Nueva función `dibujarTablaPdf()` en `contabilidad.js` — tabla real con
  PDFKit (encabezado con fondo, filas alternadas, salto de página repitiendo
  encabezado, texto largo recortado con "…" según ancho real vía
  `ellipsis: true` de PDFKit, no un límite de caracteres adivinado) — mismo
  lenguaje visual que ya usa el talón resumen del ATS.
- Si se filtra una cuenta (`cuentaId`), el PDF trae solo su detalle: ya no
  anexa la mayorización completa de todas las demás cuentas.
- Paginación cliente-side (mismo patrón `usePagina`/`Paginador` de
  `ATS.jsx`, 50 registros/página) en las 2 tablas en pantalla que antes
  listaban todo sin paginar: movimientos de una cuenta y mayorización por
  lote.
- `SelectorCuentaBuscable` (nuevo, local a `ContabilidadHub.jsx`): reemplaza
  el `<select>` plano de "Consulta de libro mayor" — input + lista filtrada
  por substring de código+nombre, sin acentos ni mayúsculas (mismo patrón
  del buscador de productos en `EtiquetasProductos.jsx`). Alcance: solo ese
  selector — los otros 2 usos de la misma lista de cuentas (dentro de filas
  de tabla del formulario de asiento manual) se dejaron como estaban, no
  fue lo pedido.

### Verificación realizada
- `node --test`: 29/29.
- **PDF generado 2 veces contra `scfi_dev` real** (con y sin `cuentaId`) vía
  HTTP con JWT firmado manualmente, y revisado visualmente: tabla con
  bordes/encabezado, sin mayorización completa cuando se filtró una cuenta,
  texto largo recortado con "…" en una sola línea sin desbordar la fila
  (se encontró y corrigió este problema durante la propia verificación:
  la primera versión sí desbordaba a 2 líneas y tapaba la fila siguiente).
- `npx vite build`: limpio.
- **No probado**: el selector de búsqueda y el paginador en un navegador
  real (no hay entorno de navegador disponible aquí) — la lógica de
  filtrado se verificó por separado con Node (`normalizarTexto('Retención').includes('ret')` → true).

### Addendum mismo día (commit `30700f6`) — encabezado corporativo
El usuario comparó contra el mayor de "Sofía" (competencia) y pidió mejor
estética con logo/datos de la empresa en una esquina. Nuevo
`dibujarEncabezadoContable()`: logo de Configuración SRI (mismo campo que ya
usa el RIDE de factura, `utils/sri.js`) si la empresa tiene uno cargado,
razón social/RUC/dirección/teléfono centrados, título, línea divisoria en
el morado de marca. Verificado con un PDF real (empresa sin logo cargado —
se ve bien igual, esa sección simplemente no se dibuja). **Confirmado con
el usuario**: ninguna de las empresas que hoy llevan contabilidad tiene
logo cargado — el caso ya probado es el que aplica en producción. Probar
con logo queda de baja prioridad (reusa el mismo código ya probado del
RIDE de factura, `utils/sri.js`), no bloqueante.

## Parte 4 — Verificación ATS 5%/15% + Centro de Ayuda actualizado (commit `368d54e`)

### ATS: ¿diferencia IVA 5% de 15%?
El usuario preguntó, sin recordar el estado. Verificado que **sí** — la
vista previa y el PDF del talón resumen (`routes/ats.js`) calculan totales
separados por tarifa (`bt5/iva5`, `bt12/iva12`, `bt15/iva15`) a partir de
datos reales, no de columnas hardcodeadas; F104 (`routes/declaraciones.js`)
también los separa. El XML que se envía al SRI combina todo en un solo
campo `<baseImpGrav>` — **se descargó el XSD oficial del SRI en el momento
para confirmarlo**: el propio schema del SRI no tiene campos separados por
tarifa (`baseImpGrav5`/`baseImpGrav12`/`baseImpGrav15` no existen), así que
combinarlo ahí es lo correcto, no una falla del sistema.

### Centro de Ayuda actualizado
`frontend/src/components/Ayuda/AyudaSistema.jsx` — 6 secciones nuevas
(mismo patrón de acordeón que las 24 ya existentes, sin índice de búsqueda
que mantener aparte):
1. Sucursales, Puntos de Emisión y Cajas (multi-caja)
2. Impresora térmica — Red o USB
3. Trabajar sin internet (modo offline del POS)
4. Etiquetas de Productos y regalos/combos en compras
5. Notas de Crédito recibidas de proveedores
6. Libro Diario y Libro Mayor
7. Integraciones externas (WebServices API)

Verificado con `npx vite build` limpio (chunk de AyudaSistema pasó de ~40kB
a 67kB, consistente con el contenido agregado). No requiere probarse en
navegador más allá de que compile — es contenido estático, sin lógica
nueva.
