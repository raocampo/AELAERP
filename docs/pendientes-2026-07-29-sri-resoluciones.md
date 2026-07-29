# AELA ERP — Sesión 2026-07-29 — Cumplimiento resoluciones SRI (facturación electrónica)

## Contexto

El usuario pidió revisar la última resolución del SRI sobre facturación
electrónica para implementarla en AELA. Se investigaron dos resoluciones
reales y vigentes, con lectura del **texto oficial completo** (PDFs
descargados de sri.gob.ec, no solo resúmenes de terceros):

- **NAC-DGERCGC25-00000014** (27-jun-2025, vigente desde 01-ago-2025) —
  normas de anulación de comprobantes electrónicos.
- **NAC-DGERCGC25-00000017** (29-jul-2025) — reforma la anterior, ajusta
  plazos (día 10→7) y agrega la excepción de aceptación automática
  (receptor con ID extranjera/pasaporte o fallecido). Aclara que el corte a
  "Consumidor Final" y la transmisión inmediata rigen desde 01-ene-2026.
- **NAC-DGERCGC26-00000027** (27-jul-2026, hace 2 días) — registro de
  proveedores de sistemas de facturación electrónica (aplica a
  CorpSimtelec como dueño de AELA) + obligación de incluir el RUC del
  proveedor en la información adicional de cada comprobante.

## Corrección importante durante la investigación

Varias fuentes secundarias (blogs contables/legales) decían que "las
facturas a consumidor final no se pueden anular ni tener NC" sin más
detalle. Antes de implementar nada se leyó el **Art. 3 original de la
resolución 14** para confirmar la redacción exacta — sí es una regla real
y explícita (no una sobre-interpretación de blog): *"Las facturas
electrónicas emitidas con la leyenda 'consumidor final' no se podrán
anular una vez emitidas y transmitidas al Servicio de Rentas Internas. En
estos casos, no procede la emisión de notas de crédito."* Vigente desde
2026-01-01 (según la Disposición Final de la resolución 17).

También se descartó una lectura inicial equivocada: el plazo "día 7 del
mes siguiente" aplica a la **anulación en línea vía el portal del SRI**
(un trámite que el contribuyente hace directamente en srienlinea.sri.gob.ec
con su propia clave, Art. 2) — no al mecanismo que usa el botón "Anular"
de AELA, que emite una Nota de Crédito (la otra vía del Art. 2), la cual
**no tiene límite de tiempo** desde que la resolución 17 reemplazó el
Art. 5 (antes eran 12 meses). Por eso no se implementó ningún límite de
plazo en "Anular" — habría sido incorrecto.

## Implementado en esta sesión (commiteado y pusheado)

**Bloqueo de anulación/NC sobre facturas a "Consumidor Final" ya
autorizadas** (`backend/routes/facturas.js`):
- `POST /:id/anular`: si `tipoIdentificacionComprador === '07'` y
  `estadoSri === 'AUTORIZADO'`, devuelve 400 antes de generar la NC
  automática, citando la resolución.
- `POST /notas-credito` (creación manual): mismo bloqueo, verificando la
  factura de origen.
- Frontend (`DetalleFactura.jsx`, `ListaFacturas.jsx`): los botones
  "Anular"/"Nota de Crédito" se ocultan y se reemplaza por un badge 🔒 con
  tooltip explicando el motivo — UX proactiva en vez de solo un error tras
  el clic.
- `GET /facturas` (lista) ahora incluye `tipoIdentificacionComprador` en
  el `select` (antes no lo devolvía, necesario para que el frontend pueda
  calcular el bloqueo en la tabla).

### Verificación realizada
- `node --test`: 29/29. `npx vite build`: limpio.
- **Probado end-to-end contra `aela_db` real** (servidor propio en puerto
  5601, sin tocar el servidor de desarrollo del usuario en 5600): clonada
  una factura real como plantilla, creada una copia con
  `tipoIdentificacionComprador='07'` y `estadoSri='AUTORIZADO'` — tanto
  `POST /anular` como `POST /notas-credito` devolvieron 400 con el mensaje
  correcto. Control con una factura normal (`tipo='05'`): siguió
  funcionando igual que antes (200, genera NC). Registros de prueba
  eliminados al terminar.

## Pendiente — otros frentes de las mismas resoluciones (no implementados aún, a decidir con el usuario)

1. **Transmisión inmediata / fecha de emisión real** (vigente desde
   2026-01-01): en el flujo NORMAL de creación de factura (no el módulo de
   "Importar históricas"), `POST /facturas` acepta un `fechaEmision`
   arbitrario del cliente sin validar que sea "hoy" — riesgo real de
   incumplimiento si algún flujo del frontend permite elegir una fecha
   pasada. Revisar `backend/routes/facturas.js` línea ~1044.
2. **RUC del proveedor de sistema de facturación** (resolución 26-027,
   nueva, plazo 60 días hábiles): agregar un campo nuevo en la
   configuración de empresa para el RUC del proveedor (CorpSimtelec) y
   sumarlo a `<infoAdicional>` en los 6 generadores de XML de
   `backend/utils/sri.js` (factura, NC, ND, retención, liquidación,
   guía de remisión — actualmente NC y ND ni siquiera generan
   `infoAdicional`). Requiere que el usuario confirme el RUC exacto a
   usar antes de tocar código.
3. **Aceptación del receptor (5 días hábiles) para anular retenciones/NC/ND
   propias** — confirmado que este proceso ocurre exclusivamente en el
   portal del SRI (requiere que ambas partes tengan su propia clave de
   acceso al SRI en línea) — no es una API que AELA pueda invocar. No
   requiere código, solo documentarlo en el Centro de Ayuda para que el
   usuario/contador sepa que ese trámite se hace directamente en
   srienlinea.sri.gob.ec, no en AELA.

## Sesión 2026-07-29 (continuación) — RUC proveedor + fecha de emisión real

El usuario confirmó el RUC de CorpSimtelec (`1103568240001`) y pidió
implementar los dos pendientes restantes.

### 1. RUC del proveedor de sistema en `infoAdicional` (Res. NAC-DGERCGC26-00000027)

`backend/utils/sri.js`: nueva constante `RUC_PROVEEDOR_SISTEMA =
'1103568240001'` + helper compartido `_agregarInfoAdicional(root,
camposExtra)` que SIEMPRE agrega el campo `RUC Proveedor Sistema`, incluso
si no hay ningún otro campo adicional. Reemplazados los 4 bloques
`infoAdicional` inline que ya existían (factura, retención, liquidación de
compra, guía de remisión) para usar el helper, y **agregado desde cero**
en Nota de Crédito y Nota de Débito (antes no generaban `infoAdicional` en
absoluto).

Es el mismo RUC para los 6 tipos de comprobante y para todos los tenants
(todos usan AELA como proveedor) — no es un campo de configuración por
empresa, es una constante de código.

### 2. Fecha de emisión real — sin backdating (Res. NAC-DGERCGC25-00000014, transmisión inmediata desde 2026-01-01)

`backend/routes/facturas.js`, `POST /` (creación de factura): antes
aceptaba cualquier `fechaEmision` del cliente sin validar. Ahora rechaza
(400) si la fecha está a más de **3 días de atraso** o en el futuro (más
de 6 horas, margen por husos horarios).

**Por qué 3 días y no "debe ser exactamente hoy"**: el POS tiene modo
offline (ver sesión anterior, `idempotencyKey` + `apiOffline()`) donde una
venta se guarda localmente y se sincroniza sola minutos u horas después
con la fecha real de la venta — un backdating exacto de "0 días" habría
roto ese flujo. 3 días es un margen generoso para un corte de conexión
largo (ej. un fin de semana) sin permitir el backdating real que la
resolución prohíbe (facturar hoy algo de hace semanas/meses). Para
facturas de períodos anteriores ya existe el módulo dedicado "Importar
facturas históricas" (estado HISTORICO, sin transmisión real al SRI).

Frontend (`PuntoVenta.jsx`): el date picker de fecha de emisión ahora
tiene `min`/`max` reflejando el mismo rango, para no dejar elegir en la UI
algo que el backend va a rechazar de todas formas.

### Verificación realizada
- `node --test`: 29/29. `npx vite build`: limpio.
- **RUC proveedor**: generado un XML de prueba de Factura y de Nota de
  Crédito (que antes no tenía `infoAdicional`) — ambos incluyen
  `<campoAdicional nombre="RUC Proveedor Sistema">1103568240001</campoAdicional>`.
- **Fecha de emisión**: probado end-to-end contra `aela_db` real (servidor
  propio en puerto 5601, sin tocar el servidor de desarrollo del usuario):
  sin fecha / hoy / hace 1 día → 201 creadas correctamente; hace 30 días /
  en 2 días → 400 rechazadas con el mensaje esperado. Registros de prueba
  eliminados al terminar.

## Estado final de las 3 resoluciones investigadas

Ver también `project_sri_resoluciones_2026.md` en la memoria persistente.

1. ✅ Anulación/NC bloqueado para Consumidor Final (commit `4bde489`).
2. ✅ RUC del proveedor en `infoAdicional` de los 6 comprobantes (este commit).
3. ✅ Fecha de emisión real, sin backdating, en creación normal de facturas (este commit).
4. **Pendiente, sin código** (es un trámite manual, no una API): aceptación
   del receptor (5 días hábiles) para anular retenciones/NC/ND — ocurre
   exclusivamente en srienlinea.sri.gob.ec. Documentar en el Centro de
   Ayuda si se quiere.
5. **Pendiente, trámite legal de CorpSimtelec** (no de código): registrar
   la actividad económica de proveedor de facturación electrónica en el
   RUC de CorpSimtelec, dentro de 30 días hábiles desde la publicación de
   la Res. NAC-DGERCGC26-00000027 (27-jul-2026).
