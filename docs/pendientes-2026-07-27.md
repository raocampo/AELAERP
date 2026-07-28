# AELA ERP — Sesión 2026-07-27 — Auditoría WebServices/AVALAB + Modo offline del POS + Libro Mayor + Centro de Ayuda

## 🟢 PARA RETOMAR — checklist rápido

**Código (Partes 1-8)**: commiteado y pusheado a `main` (commits `123a5ae`, `2430ce5`, `6209ef9`,
`1b7edd8`, `30700f6`, `368d54e`, `6e7a92b`, `991ff33`, `9a3d239`, `50ebbc3`, `3a85926`).

**Código (Partes 9-13, esta sesión)**: ver detalle más abajo — commiteado y pusheado al terminar
de documentar (commit incluye este mismo archivo).

0. **Selector de cuenta buscable en asientos** (Parte 9): probar en navegador — Contabilidad →
   Libro Diario → Nuevo asiento manual (y Asiento inicial), escribir un código (ej. "5.1.02") o
   un nombre y confirmar que filtra igual que ya lo hace el buscador del Libro Mayor.
1. **Compras — clasificación automática inventario vs gasto** (Parte 13): probar con una
   importación real de Buzón SRI (ZIP o XML) que incluya al menos una factura de servicio
   (arriendo, internet, honorarios) y confirmar que el asiento generado ya no manda todo a
   "Inventario Mercaderías" — revisar el asiento COMPRA resultante en el Libro Diario.
2. **SuperAdmin — tenant `sys`**: confirmar en el panel que ya no muestra "Vencido" (se corrigió
   `esTrial` y `estado` directamente en producción, Parte 12).
3. **Tenant `tania-herrera`**: confirmar con la clienta que ya puede ingresar con el link
   corregido (`?slug=tania-herrera`, con guion) y la contraseña temporal, y que le funcionó
   "Cambiar contraseña" desde el sidebar.

4. **Libro Mayor**: probar en el navegador real (no solo el PDF, ya
   verificado) — Contabilidad → Libro Mayor, escribir "ret" (o cualquier
   parte de un nombre de cuenta) en el nuevo buscador y confirmar que
   filtra bien; con una cuenta de muchos movimientos confirmar que aparece
   el paginador "Página X de Y" en vez de listar todo de una vez.

5. **Probar en producción con datos reales**:
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
6. **Coordinar con AVALAB** cuándo hacen la primera llamada HTTP real usando
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

## Parte 5 (sesión nueva) — Buzón SRI: eliminar el límite de 50 archivos en "Importar ZIP" / "Importar XML"

El usuario reportó que al descargar y comprimir los XML del portal SRI
regularmente hay más de 50 archivos, y el sistema los rechaza.

**Causa**: las 4 rutas de `routes/buzon.js` compartían la misma constante
`MAX_CLAVES_LOTE = 50`, pero por razones distintas:
- `/consultar` e `/importar` (pestañas "Por claves de acceso" y "Descarga
  automática") sí necesitan ese límite bajo — cada clave dispara una llamada
  real y secuencial al webservice del SRI, y con muchas claves se corre
  riesgo real de superar el timeout de 60 s del proxy de Railway.
- `/importar-zip` e `/importar-xml` (pestañas "Importar ZIP" / "Importar
  XML") **no llaman al SRI en absoluto** — los XML ya vienen autorizados en
  el propio archivo, así que solo hacen parseo local + escritura en BD. El
  límite de 50 ahí era un caso de "copiar la misma constante sin repensar si
  aplicaba", no una necesidad real.

### Implementado
- `/importar-zip` e `/importar-xml` ahora responden de inmediato con
  `{ jobId }` y procesan los archivos en background, reusando el mismo
  patrón de job asíncrono que ya existía para el scraper del portal SRI
  (`SCRAPER_JOBS` + `GET /buzon/sri/job/:jobId`, mismo mecanismo documentado
  en sesiones anteriores para evitar el timeout de 60 s de Railway). Esto
  quita el límite de fondo (ya no depende de terminar en una sola request
  HTTP) sin importar cuántos archivos traiga el lote.
- Límite anti-abuso subido de 50 a **1000 archivos** por lote (mismo tope
  que ya usa `facturas.js` para el import XML de ventas — se alinearon los
  dos límites, antes eran inconsistentes entre sí sin motivo).
- El límite de 50 para `/consultar` e `/importar` (llamadas reales al SRI)
  **se mantiene intacto**, con comentario explicando por qué.
- Frontend (`BuzonSRI.jsx`): las pestañas "Importar ZIP" e "Importar XML"
  ahora muestran progreso ("Importando 12 de 340...") mientras el job corre
  en background, reusando (extraído a la función `esperarJob()`) el mismo
  polling que ya usaba la descarga automática del scraper SRI. Se quitó el
  texto "Máximo 50 archivos" de la UI.

### Verificación realizada
- `node --test`: 29/29.
- `npx vite build`: limpio.
- **Probado end-to-end contra `scfi_dev` real**, con servidor propio en un
  puerto alterno (5601, sin tocar el servidor de desarrollo del usuario en
  5600) y JWT firmado localmente: subida de 2 XML sueltos vía
  `/importar-xml` (1 nuevo + 1 duplicado → detecta bien "Ya existe"), y los
  mismos 2 XML comprimidos en un `.zip` vía `/importar-zip`. En ambos casos
  el job respondió `jobId` de inmediato, el polling devolvió `pending` →
  `done`, y el resumen (`creados`/`omitidos`/`errores`) coincidió con lo
  esperado, incluyendo el asiento contable automático (`asientos_contables`,
  tipo `COMPRA`) generado por cada factura nueva. Los registros de prueba
  (2 `facturas_compra` + 2 `asientos_contables`) se eliminaron de la base
  al terminar.
- **No probado**: la UI de progreso en un navegador real (no hay entorno de
  navegador disponible aquí) ni un lote realmente grande (cientos de
  archivos) — la lógica es la misma que ya corre en producción para el
  scraper, solo se verificó con 1-2 archivos por request.

## Parte 6 (misma sesión nueva) — Compras a cédula: el contador puede aprobarlas para que cuenten en declaraciones

El usuario reportó que "se restringió importar facturas de compra con
cédula" y que un contador cliente pidió poder incluirlas cuando sí
corresponden a la actividad económica, marcándolas con un check tras
revisarlas.

**Investigación previa (importante)**: no existía ningún bloqueo de
importación — las facturas a cédula ya se importaban con normalidad (se
vio en la sesión del 2026-07-12, `docs/pendientes-2026-07-12.md` parte 5,
a pedido del mismo cliente: "solo sirven las facturas... con RUC, no con
cédula"). Lo que sí pasaba es que quedaban **excluidas sin excepción** del
crédito tributario de IVA (F104) y del F101, sin ningún mecanismo para
revertirlo caso por caso. Eso es lo que el contador ahora pide poder hacer.

### Implementado
- Columna nueva `aprobadaPorContador` (Boolean, default `false`) en
  `facturas_compra` — agregada a `schema.prisma`, migración
  `20260727010000_compras_aprobada_contador` y `applySchemaFixes.js` (las
  3 partes, por la regla de oro de este proyecto: sin `applySchemaFixes.js`
  la columna nunca llega a las BDs de los tenants en producción).
- `PUT /compras/:id` acepta `aprobadaPorContador` en el body (mismo patrón
  ya usado por `esGastoPersonal`, sin gate de rol adicional — consistente
  con cómo ya funciona ese campo).
- Los 3 filtros que excluían duro por `receptorEsRuc === false` ahora
  respetan la aprobación: `declaraciones.js` (F104 y F101) y
  `facturas.js` (`GET /reportes/tributario`) agregan `aprobadaPorContador:
  true` al `OR` de inclusión. El filtro `esGastoPersonal` sigue mandando
  igual — si está marcada como gasto personal, se excluye aunque el
  contador la haya aprobado (son dos motivos distintos).
- Nuevo filtro `pendienteRevisionCedula=true` en `GET /compras` — para que
  el contador encuentre rápido las facturas a cédula que aún no revisó.
  Botón "🪪 A revisar (cédula)" en `ListaCompras.jsx`, mismo patrón visual
  que el botón "📥 Buzón SRI" que ya existía.
- `DetalleCompra.jsx`: nuevo checkbox en el modal "Editar" — "Revisado por
  contador — sí corresponde a la actividad" — visible solo cuando
  `receptorEsRuc === false` (es el único caso donde tiene efecto). El badge
  de solo lectura que antes decía siempre "⚠️ Facturado a cédula, no
  deducible" ahora muestra "✅ Facturado a cédula — aprobado por contador"
  cuando corresponde.
- Mensaje de aviso en `Declaraciones.jsx` (F104) actualizado para explicar
  la opción nueva en vez de solo pedir que el proveedor reemita el
  comprobante.

### Verificación realizada
- `node --test`: 29/29. `npx vite build`: limpio.
- Migración aplicada contra `scfi_dev` real vía `applySchemaFixes.js`
  (columna confirmada con `information_schema.columns`).
- **Probado end-to-end contra `scfi_dev` real**, servidor propio en puerto
  5601: creé una `facturas_compra` de prueba con `receptorEsRuc: false`,
  confirmé que el F104 la excluía (`comprasExcluidasCedula: 1`,
  `cantidadCompras: 0`), la aprobé vía `PUT /compras/:id`
  (`aprobadaPorContador: true`), y confirmé que el F104 pasó a incluirla
  (`comprasExcluidasCedula: 0`, `cantidadCompras: 1`, `ivaCreditoFiscal:
  1.5` con el IVA de la factura de prueba). También verifiqué que
  `GET /compras` devuelve el campo nuevo y que el filtro
  `pendienteRevisionCedula=true` deja de mostrarla tras aprobarla. Registro
  de prueba eliminado de la base al terminar.
- **Pendiente para el usuario**: reiniciar el backend de desarrollo (puerto
  5600) para que tome el cliente Prisma regenerado con la columna nueva —
  mientras el proceso viejo siga corriendo, no reconoce `aprobadaPorContador`
  y cualquier request que la use fallaría con "Unknown argument". En
  Railway esto no aplica: el deploy siempre arranca un proceso nuevo.
- **No probado**: el checkbox y el badge en un navegador real (no hay
  entorno de navegador disponible aquí).

### Addendum mismo día — corte de fecha: contabilidad atrasada no necesita el check

El usuario aclaró: hay un cliente poniendo al día contabilidad **pasada**
(años anteriores) — ahí no quiere tener que revisar/aprobar factura por
factura, sino que cuenten automáticamente. El check del contador debe
exigirse **a partir de 2026** en adelante, no antes.

**Implementado**: nuevo `backend/utils/comprasFiscal.js` — corte único
`CUTOFF_APROBACION_CEDULA = 2026-01-01`, compartido por los 3 lugares que
antes repetían el mismo `OR` (`declaraciones.js` F104/F101 y
`facturas.js` reporte tributario). Una compra a cédula ahora cuenta si:
receptorEsRuc no es false, o el contador la aprobó, o `fechaEmision` es
anterior al corte. El contador `comprasExcluidasCedula` y el filtro
`pendienteRevisionCedula` de `GET /compras` también respetan el corte —
ya no marcan como "pendientes de revisión" las compras históricas, porque
esas no la necesitan.

- `GET /compras` (lista) y `GET /compras/:id` (detalle) ahora devuelven
  `necesitaRevisionCedula` (booleano ya calculado en el backend, para no
  duplicar la fecha de corte en el frontend). `DetalleCompra.jsx` usa ese
  campo para decidir si mostrar el checkbox de aprobación; si la compra es
  histórica (antes del corte) no lo muestra y en su lugar el badge dice
  "✅ Facturado a cédula — periodo histórico" en vez de la advertencia.
  Mismo criterio en el popover de `ListaCompras.jsx`.

**Verificado end-to-end contra `scfi_dev` real** (mismo servidor de
prueba en el puerto 5601): creé 2 facturas a cédula sin aprobar, una de
mayo/2024 y otra de julio/2026. El F104 de mayo/2024 la incluyó sola
(`cantidadCompras: 1`, `comprasExcluidasCedula: 0`, `ivaCreditoFiscal:
1.5`); el F104 de julio/2026 la excluyó (`cantidadCompras: 0`,
`comprasExcluidasCedula: 1`). `GET /compras` devolvió
`necesitaRevisionCedula: false` para la histórica y `true` para la de
2026, y el filtro `pendienteRevisionCedula=true` solo mostró la de 2026.
Registros de prueba eliminados al terminar. `node --test`: 29/29,
`npx vite build`: limpio.

## Parte 7 (misma sesión) — Investigación: totales de Compras "no corresponden"

El usuario reportó que los totales de compras de abril-2024 (89 registros,
IVA $280.26) no coinciden con un Excel que compartió ("Totales por Tarifa
IVA generada": 391 registros, IVA $322.20).

**Conclusión de la investigación**: la pantalla de AELA (`ATS.jsx`, sección
"Facturas de Compra registradas") y el PDF del talón resumen ATS
coinciden perfectamente entre sí (ambos leen `facturas_compra` con el
mismo filtro de período y cuentan **por factura**, `backend/routes/ats.js`)
— eso no tiene bug. El Excel de 391 filas, en cambio, **no tiene ningún
código de origen en AELA**: no existe en todo el repo (frontend ni
backend) ninguna exportación con las columnas "Tarifa IVA / Registros /
Monto IVA / Importe Total". Ese layout coincide exactamente con el export
crudo nativo del portal del SRI ("Comprobantes Electrónicos Recibidos"),
que trae **una fila por línea de ítem, no por factura** — de ahí 391 vs 89
(coincide con un promedio de ~4.4 líneas por factura). El propio proyecto
ya tiene evidencia de esto: existe un script dedicado
(`backend/scripts/convertirComprasHistoricasSRI.js`) para convertir
justamente ese formato del SRI a la plantilla de AELA, con el mismo
alias `'tarifa iva' → 'tarifaIva'`, `'monto iva' → 'montoIva'`,
`'importe total' → 'importeTotal'` que aparecen en el Excel del usuario.

**Pendiente de confirmar con el usuario**: de dónde bajó exactamente ese
Excel de 391 filas (¿botón "⬇ Excel" de Compras en AELA, o descarga
directa del portal del SRI?). Si es del SRI, no hay nada que corregir —
son fuentes distintas (documento vs. línea de detalle). Se le preguntó
directamente en el chat.

### Bug real encontrado y corregido (independiente de la pregunta principal)
`GET /compras/exportar/xlsx` (`backend/routes/compras.js`) seleccionaba
`subtotal12` de la base de datos pero nunca lo escribía en el Excel — ni
en `headers` ni en `rows`. La columna "Subtotal 12%" desaparecía en
silencio de ese export (el total general del Excel seguía siendo
correcto porque `importeTotal`/`IVA` sí se guardan precalculados; solo el
desglose por tarifa perdía la columna 12%). Agregada la columna faltante.

**Verificación realizada**: `node --test` 29/29, `npx vite build` limpio,
y descarga real del Excel contra `scfi_dev` (servidor propio en el puerto
5601) confirmando que la cabecera ahora incluye "Subtotal 12%" entre
"Subtotal 5%" y "Subtotal 15%".

## Parte 8 (misma sesión) — Bug real de IVA mal calculado en compras históricas (producción, cliente Puchaicela) — encontrado y corregido

El usuario confirmó que el Excel de la Parte 7 SÍ es la fuente real usada
para importar la contabilidad histórica de **Daniel Ramiro Puchaicela**
(RUC 1104196546001, tenant `aela_lsac`, `empresaId=4`) y pidió acceso a
producción para investigar a fondo. Compartió `.env.local` (con la cadena
de conexión externa de Railway) y el archivo real
`COMPRAS JUNIO 2023 ABRIL 2025 PUCHAICELA.xlsx` (23 hojas, jun-2023 a
abr-2025, export crudo del SRI).

### Causa raíz encontrada

La migración `20260715000000_subtotal12_iva_historico` (sesión 2026-07-15,
`applySchemaFixes.js`) reclasificó `subtotal15 → subtotal12` para
`fechaEmision < '2024-04-22'`, asumiendo que la tarifa 15% empezó a regir
ese día. **La fecha real es 2024-04-01** — confirmado en
`backend/utils/sri.js:96` ("15% tarifa vigente desde abr 2024") y
verificado de forma empírica contra el export real del SRI del cliente:
**cero** comprobantes a 12% en todo abril-2024 (188 líneas al 15%, 0 al
12%, embebido en la propia hoja "ABRIL 2024 COMPRAS" del Excel, filas
393-398 "Totales por Tarifa IVA generada" — el mismo cuadro que el usuario
compartió como imagen en la Parte 7).

Con la fecha de corte equivocada, las 3 semanas del 1 al 21 de abril de
2024 quedaron mal reclasificadas a subtotal12, y el script de fix
posterior (`verificarIvaHistorico.js --fix`, sesión 2026-07-15) terminó
"confirmando" y horneando el IVA incorrecto al 12% en esos registros
porque su ratio (15/12=1.25) coincidía exactamente con el patrón del bug
que ese script sí sabía corregir — sin saber que la fecha de corte de
origen ya estaba mal.

### Alcance verificado (los 7 tenants de Railway a los que se tuvo acceso)

- `railway` (empresas 1-3), `aela_mprq`, `aela_labsanjose`,
  `aela_tania_herrera`: **0 registros afectados**.
- `aela_sys`: tenant nuevo, sin datos del período — no aplica.
- `aela_loja_torneos_y_competencia`: confirmado por el usuario que este
  subtenant ya no existe (se borró) — no se tocó.
- `aela_lsac`, empresa 4 (Puchaicela): **45 facturas de compra** con
  `fechaEmision` entre 2024-04-01 y 2024-04-21 afectadas. Base mal
  clasificada: $1,378.39. IVA subestimado: **$41.40** (de $165.41 al 12%
  a $206.81 al 15% correcto).

### Corrección aplicada en producción (con backup previo a cada paso)

1. Nuevo script reutilizable `backend/scripts/corregirCorteIva15Abril2024.js`
   (modo diagnóstico por defecto, `--fix` para aplicar) — genera backup
   JSON de los registros originales antes de tocar nada
   (`backend/scripts/_backup_*.json`, excluido del repo vía `.gitignore`,
   nunca se sube data financiera real de un cliente a git).
2. Ejecutado contra `aela_lsac --empresa=4 --fix`: 45 `facturas_compra`
   corregidas (`subtotal12→subtotal15`, `totalIva`/`importeTotal`
   recalculados al 15%).
3. Reutilizado `regenerarAsientosCompraIva12.js` (ya existente de la
   sesión 2026-07-15) para regenerar los 45 asientos contables vinculados:
   **45 regenerados, 0 omitidos** (ningún período cerrado/bloqueado).
4. Verificado: totales de abril-2024 en producción después del fix
   (`base15=1514.32, iva=321.66, total=5276.99`) casi exactos al Excel
   real (`base15=1520.32, iva=322.20, total=5277.53` agrupando por
   factura) — la diferencia de ~$0.54 restante es redondeo normal por
   línea del SRI, no un error. Asiento de la compra de mayor ajuste
   (`#999`, +$10.26) verificado cuadrando debe=haber ($393.12=$393.12).

### Fix de fondo (para que no se repita ni afecte a futuros clientes)

- **`applySchemaFixes.js`** y **`verificarIvaHistorico.js`**: fecha de
  corte corregida de `2024-04-22` a `2024-04-01`. Esto era **urgente**:
  sin este cambio, el próximo arranque del servidor (que corre
  `applySchemaFixes.js` contra todos los tenants) habría vuelto a mover
  los 45 registros recién corregidos de `subtotal15` a `subtotal12`,
  deshaciendo el fix.
- **`convertirComprasHistoricasSRI.js`**: corregido un aviso engañoso que
  decía "esta hoja no tiene columna de Fecha Emisión — se usó el día 1
  ... para TODAS sus facturas" cuando en realidad solo un puñado de filas
  basura al final de cada hoja (no todas) carecían de fecha — ahora
  reporta el conteo real y aclara que no afecta al resto de la hoja.
- **Nuevo `backend/scripts/reconciliarComprasHistoricas.js`**: herramienta
  permanente y reutilizable (no atada a Puchaicela) — compara, mes por
  mes, los totales de un Excel de compras históricas contra lo que quedó
  en `facturas_compra` después de importarlo. Pensado para validar
  futuras importaciones de otros clientes sin depender del preview (que
  no garantiza que los totales por mes cuadren con el documento fuente).

### Verificación exhaustiva de los 23 meses (a pedido explícito del usuario)

Con `reconciliarComprasHistoricas.js` se reconciliaron los 23 meses
completos (jun-2023 a abr-2025) del Excel de Puchaicela contra producción
(post-fix). **Base 0% y base gravada cuadran en $0.00 de diferencia en
los 23 meses** — abril-2024 fue el único mes con un error real de
clasificación. Las diferencias de IVA restantes (todas ≤ $3.66/mes) son
redondeo normal acumulado del SRI por factura, no un patrón sistemático.

### Verificación técnica

- `node --test`: 29/29 en todos los puntos de esta parte.
- Sintaxis verificada de los 5 scripts tocados/creados.
- Todo el trabajo de exploración/corrección en producción se hizo con
  consultas de solo lectura primero, backup antes de cualquier `UPDATE`,
  y verificación numérica exacta antes y después de cada paso — mismo
  estándar que la sesión 2026-07-15.
- **Pendiente**: los 16 registros de "revisión manual" ya documentados en
  la sesión 2026-07-15 (ratios ~0.89-0.92 y ~0.66-0.67, asientos
  `H-YYMMDD-01`) siguen sin tocar — requieren que la contadora del
  cliente confirme el valor correcto, no están relacionados con el bug de
  esta sesión.

## Parte 9 (misma sesión) — Selector de cuenta buscable también en asientos manuales

Antes de esta parte, `SelectorCuentaBuscable` (input + filtro por substring de
código+nombre, sin acentos ni mayúsculas) solo se usaba en "Consulta de libro
mayor" (sesión 07-27 anterior) — los 2 usos restantes de la lista de cuentas
(la tabla de detalle del formulario de "Nuevo asiento manual" y la de "Asiento
inicial") seguían con un `<select>` nativo del navegador, que solo hace
type-ahead sobre el inicio del texto de la opción (`codigo - nombre`): permitía
llegar rápido escribiendo el código, pero no escribiendo el nombre de la
cuenta. El usuario pidió que ambas formas de buscar funcionen igual en los
asientos, como ya funcionaba en Libro Mayor.

### Implementado
- `ContabilidadHub.jsx`: los `<select>` de la columna "Cuenta" en el detalle de
  "Nuevo asiento manual" (`asientoForm.detalles`) y "Asiento inicial"
  (`asientoInicialForm.detalles`) se reemplazaron por `SelectorCuentaBuscable`
  — mismo componente ya usado en Libro Mayor, sin cambios al componente en sí.
- El `<select required>` nativo daba validación HTML5 gratis (no dejaba
  enviar el formulario sin elegir cuenta); al ser ahora un input de texto, se
  agregó la validación equivalente en JS (`guardarAsiento` y
  `guardarAsientoInicial`): si alguna línea quedó sin `cuentaId`, se avisa con
  toast y no se envía el formulario.
- CSS (`ContabilidadHub.css`): `.conta-selector-cuenta` ahora tiene
  `position: relative` como regla base (antes solo aplicaba dentro de
  `.conta-filters`), para que el listado desplegable se posicione bien también
  dentro de una celda de tabla.

### Verificación realizada
- `npx vite build`: limpio (antes y después del cambio).
- No requiere backend — es un cambio 100% de frontend sobre un componente ya
  probado en producción (Libro Mayor).
- **No probado**: el comportamiento visual real en navegador (el buscador
  desplegándose correctamente dentro de la celda de la tabla) — no hay
  entorno de navegador disponible aquí. Ver checklist al inicio de este
  documento.

## Parte 10 (misma sesión) — Plan de Cuentas: "Acepta movimiento" nace marcado por defecto

El usuario creó una cuenta nueva (`5.1.02.004 SEGUROS PREPAGADOS`) y, al
editar un asiento para asignarle un movimiento, la cuenta no aparecía en el
selector.

**Causa**: no era un bug de datos ni de caché — el selector de cuentas para
asientos filtra correctamente por `aceptaMovimiento && activo`
(`ContabilidadHub.jsx:1031`, para no ofrecer cuentas de grupo/mayor). El
formulario "Nueva cuenta contable" trae ese checkbox **desmarcado por
defecto** y sin ninguna explicación de qué controla — fácil de pasarlo por
alto al crear una cuenta de detalle (sus hermanas `5.1.02.001-003` sí lo
tenían marcado).

### Implementado
- `aceptaMovimiento` ahora nace **marcado** por defecto, tanto al abrir el
  formulario en blanco como al presionar "Limpiar" — la mayoría de cuentas que
  se crean a mano son de detalle, no de grupo.
- Nota explicativa bajo los checkboxes aclarando que solo las cuentas de
  grupo/mayor deben ir desmarcadas, y que si queda desmarcada la cuenta no
  aparecerá en asientos manuales.
- No afecta cuentas ya existentes, solo el valor por defecto para las nuevas.

### Verificación realizada
- `npx vite build`: limpio.
- **Pendiente para el usuario**: editar `5.1.02.004 SEGUROS PREPAGADOS` en
  Plan de Cuentas, marcar "Acepta movimiento" y guardar — con eso ya
  aparecerá en el selector del asiento que estaba armando.

## Parte 11 (misma sesión) — Tenant `tania-herrera`: no podía ingresar

El usuario reportó que un cliente (Tania Herrera, tenant creado ese mismo
día) no podía ingresar con el usuario y contraseña recién creados.

**Causa 1 — contraseña**: las contraseñas se guardan hasheadas (bcrypt,
irreversible) — no había forma de "ver" la original. Se reseteó directo en
la BD real del tenant (`aela_tania_herrera`, único usuario: `adminth1234` /
`taniaherreraochoa@gmail.com`, rol admin) con una contraseña temporal nueva,
usando el mismo hash (`bcryptjs`, costo 10) que ya usa
`backend/routes/auth.js` y `backend/scripts/resetPassword.js`. Confirmado
que el flujo de "🔑 Cambiar contraseña" del sidebar (`POST
/auth/cambiar-password`) funciona correctamente para que la clienta la
cambie ella misma.

**Causa 2 — la real, encontrada después**: el intento de login seguía
fallando incluso con la contraseña correcta. En `aela_master.tenants` (schema
`aela_master` dentro de la BD `railway` de Railway) el tenant está registrado
con slug **`tania-herrera`** (guion), pero el link que se estaba usando era
`?slug=tania_herrera` (guion bajo). El middleware de tenant no encontraba
ningún tenant con ese slug → 404 en `bootstrap-status`/`branding` → el
frontend (`Login.jsx:87-90`) interpreta ese 404 como "slug inválido" y borra
el tenant guardado en `localStorage`, dejando el login sin saber a qué BD
conectarse. La URL correcta:

```
https://aela.corpsimtelec.com/login?slug=tania-herrera
```

No fue necesario tocar código — es un dato/link mal escrito, no un bug del
sistema.

### Verificación realizada
- Acceso a la BD del tenant confirmado leyendo `aela_master.tenants` (lista
  de bases en el servidor compartido de Railway: `aela_labsanjose`,
  `aela_loja_torneos_y_competencia`, `aela_lsac`, `aela_mprq`, `aela_sys`,
  `aela_tania_herrera`, `railway`).
- **Pendiente**: confirmar con la clienta que ya puede ingresar con el link
  corregido y cambiar su propia contraseña.

## Parte 12 (misma sesión) — SuperAdmin: habilitar multiempresa + tenant `sys` marcado "Vencido" sin motivo real

### Habilitar multiempresa en un tenant PRO
Al crear una segunda empresa en el tenant `tania-herrera` (plan PRO), el
sistema respondió "Tu plan PRO está configurado como monoempresa. Solo puedes
tener una empresa." — no es un bug, es el gate esperado por
`tipoInstancia` (`backend/routes/empresas.js:339-345`). Se le indicó al
usuario dónde cambiarlo (Panel SuperAdmin → Editar tenant → "Tipo de
instancia" → Multiempresa) y lo hizo él mismo vía `PUT
/super-admin/tenants/:id`. Sin cambios de código.

### Tenant `sys` mostraba "Vencido" con vencimiento a un año
El usuario preguntó por qué el panel SuperAdmin mostraba el tenant `sys`
(cliente Fernanda Sucunuta) como "Vencido" si la columna "Vencimiento"
mostraba `19/7/2027` — más de un año en el futuro.

**Causa raíz encontrada**: dos campos distintos del tenant, sin reconciliar
entre sí. `esTrial=true` con `trialExpiresAt=2026-07-26` (un trial corto, ya
vencido al momento de la pregunta), y por separado `fechaVencimiento
=2027-07-20` (la fecha real del plan pago, a un año). El middleware
(`backend/middleware/tenant.js:138`) revisa el trial **antes** que
`fechaVencimiento`, y como `esTrial` seguía en `true`, el sistema ignoraba por
completo la fecha correcta y marcaba "vencido" solo por el trial ya expirado.
Los dos flujos de pago existentes (`_activarSuscripcion` en
`suscripcionPago.js`, y `POST /tenants/:id/suscripciones` en
`superAdmin.js`) ya ponían `esTrial=false` correctamente al registrar un
pago — la inconsistencia venía del modal genérico "✏️ Editar", que permite
tocar `fechaVencimiento` sin ninguna relación con el checkbox "Es trial".

### Implementado
- **Dato corregido en producción**: tenant `sys` → `esTrial=false`,
  `estado='activo'` (ya tiene un vencimiento real a futuro, no es trial).
- **Fix de fondo** (`backend/routes/superAdmin.js`, `PUT /tenants/:id`):
  cuando se guarda una `fechaVencimiento` futura, el backend ahora fuerza
  `esTrial=false` automáticamente y normaliza `estado` a `activo` (salvo que
  se pida `suspendido` explícitamente) — cierra la brecha sin importar por
  cuál pantalla se toque esa fecha.
- **Frontend** (`PanelSuperAdmin.jsx`): el selector "Estado" del modal Editar
  ahora se deshabilita cuando el tenant no es trial (plan pago real), con una
  nota indicando usar el botón "⏸ Suspender"/"▶ Activar" de la lista en vez
  de tocar el estado a mano — evita que se repita este tipo de
  desincronización manual.

### Verificación realizada
- `node -c routes/superAdmin.js`: limpio. `npx vite build`: limpio.
  `node --test`: 29/29.
- Corrección de `sys` verificada leyendo de vuelta el registro en
  `aela_master.tenants` tras el `UPDATE`.

## Parte 13 (misma sesión) — Compras: el asiento automático mandaba todo a "Inventario Mercaderías"

El usuario reportó que al cargar facturas de compra el asiento generado
siempre debita la cuenta de Inventario, "y no necesariamente debería ir
ahí" — pidió que el sistema analice la factura para decidir mejor a qué
cuenta debería ir cada línea.

**Causa raíz encontrada**: `backend/utils/importacionProductos.js:324`
(`parsearFacturaCompraDesdeXml`, el parser de XML del SRI reutilizado por
compras manuales y por el Buzón SRI) marcaba **toda** línea como
`inventariable: true` sin ninguna condición. `backend/utils/buzon.js`
("Importar ZIP"/"Importar XML" del Buzón SRI, reforzado en la Parte 5 de
esta misma sesión) guardaba la compra con ese valor directo — la resolución
contra el catálogo de productos existente solo corría si el usuario
marcaba "registrar inventario"/"crear productos" en esa importación
puntual, y aun así **nunca se guardaba de vuelta** en la compra: solo servía
para decidir si aplicar el movimiento de stock, no para el asiento contable
(`crearAsientoFacturaCompraRegistrada` en `contabilidad.js`, que separa
Inventario vs. Compras/Gasto leyendo `detalle.inventariable` de la compra ya
guardada). Por eso una factura de arriendo, internet u honorarios terminaba
igual en Inventario.

### Implementado
- **Clasificador best-effort** (`pareceGastoOServicio`, nuevo en
  `importacionProductos.js`): si la descripción de la línea contiene
  palabras típicas de servicio/gasto operativo (arriendo, internet,
  honorarios, seguros, mantenimiento, combustible, publicidad, software,
  transporte, etc. — lista curada de ~35 términos), la línea nace como no
  inventariable. Reemplaza el `inventariable: true` hardcodeado.
- **El catálogo real tiene prioridad sobre la heurística**
  (`utils/buzon.js`): antes de guardar la compra, cada línea se busca contra
  `productos_servicios` de la empresa (mismo matching por
  `codigoPrincipal`/`codigoAuxiliar` que ya usa `comprasInventario.js`); si
  ya existe, su `inventariable` real reemplaza el resultado del texto. Esta
  resolución ahora corre siempre (antes dependía de las opciones
  "registrar inventario"/"crear productos") porque afecta el asiento
  contable, no solo el movimiento de stock — y si se pidió aplicar
  movimiento de inventario, ese paso sigue igual que antes.
- Alcance: el parser es compartido con la importación manual/Excel de
  compras (`FormCompra.jsx`), que ya tiene un checkbox "Inventariable" por
  línea revisable por el usuario antes de guardar — ahí el default mejorado
  reduce trabajo de corrección manual, pero no era el flujo roto (un humano
  ya podía corregirlo). El flujo realmente ciego era el import automático
  del Buzón SRI, que es el que se corrigió de fondo.

### Verificación realizada
- `node --test`: 29/29.
- **Probado contra `scfi_dev` real**: se creó un producto de catálogo con
  `inventariable=false` cuya descripción ("Plan corporativo premium") no
  calza con ninguna palabra clave de la heurística (para forzar el caso
  donde el catálogo debe ganarle al texto), más una línea nueva de
  "ARRIENDO OFICINA JULIO 2026" sin producto asociado. Resultado: la primera
  quedó `inventariable=false` por el catálogo (la heurística sola hubiera
  dicho `true`), la segunda quedó `inventariable=false` por texto. Ambos
  casos correctos. Registro de prueba eliminado al terminar.
- **No probado**: una importación real de ZIP/XML con facturas mixtas en un
  navegador (no hay entorno de navegador disponible aquí) — ver checklist al
  inicio de este documento.
