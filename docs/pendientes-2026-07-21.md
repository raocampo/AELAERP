# AELA ERP — Sesión 2026-07-21 — Notas de Crédito RECIBIDAS: reporte, ATS y contabilidad

## Reporte del cliente

Con 3 capturas de un mismo período (junio 2026, empresa LSAC empresaId=10, 2 notas
de crédito recibidas de proveedores):

1. **Declaraciones → F104 IVA Mensual**: sí reflejaba la NC recibida (`-24.30`
   restado del crédito fiscal).
2. **ATS**: la NC recibida **no se visualizaba en ningún lado** (ni preview, ni
   XML, ni PDF).
3. **Reportes Tributarios**: la NC recibida **sí se visualizaba** (tarjeta "Total
   NC de proveedores: $186.62") **pero no se tomaba en cuenta** para el cálculo
   del IVA a declarar.

Pedido explícito: revisar contra los manuales técnicos del SRI y dejar el sistema
"casi perfecto sin errores". Después, en medio de la sesión, el usuario amplió el
pedido: revisar **todo lugar** donde deban aparecer las NC (recibidas y emitidas)
— reportes, declaraciones y contabilidad.

---

## Investigación contra fuentes oficiales del SRI

- PDF ya en el repo (`docs/FICHA TE_CNICA COMPROBANTES ELECTRO_NICOS ESQUEMA
  OFFLINE...pdf`) resultó ser sobre el **esquema de comprobantes electrónicos**
  (facturas, notas de crédito, retenciones como documento individual), no sobre
  el Anexo Transaccional en sí — mismo así, sirvió para confirmar la estructura
  real de `<notaCredito>` (`infoTributaria`, `infoNotaCredito`,
  `codDocModificado`, `numDocModificado`, `totalConImpuestos`).
- Ficha Técnica oficial del ATS (`FICHA_TECNICA_ATS_JULIO2016.pdf`, descargada de
  `descargas.sri.gob.ec`): confirmó que una NC recibida se reporta como **fila
  propia** dentro de `<detalleCompras>` con `tipoComprobante='04'`, referenciando
  el documento original.
- **XSD oficial** (`descargas.sri.gob.ec/download/anexos/ats/ats.xsd`) — la
  fuente más confiable, usada para validar mecánicamente el XML generado. De ahí
  salieron confirmados los nombres exactos de campo y, de paso, **varios bugs
  preexistentes no relacionados con NC** que estaban ahí desde que se escribió
  `ats.js`.

### Verificación real: instalé `xmlschema` (Python) y validé el XML que genera
el sistema contra el XSD oficial del SRI, usando datos reales de producción
(LSAC empresaId=10, junio 2026, vía conexión de solo lectura). **0 errores**
tras las correcciones de este documento.

---

## Bugs encontrados y corregidos

### 1. Reportes Tributarios no restaba el IVA de NC recibidas del crédito fiscal
`backend/routes/facturas.js` (`GET /facturas/reportes/tributario`): calculaba
`notasCreditoRecibidas.importeTotal` (bruto, con IVA incluido) pero nunca lo
restaba de `ivaCreditoFiscal` — la tarjeta lo mostraba, el cálculo lo ignoraba
por completo. Corregido: se extrae el IVA real del `xmlAutorizado` de cada NC
(mismo patrón que ya usaba `declaraciones.js`) y se resta. **Verificado con
datos reales**: `ivaCreditoFiscal` pasó de `$110.40` (bug) a `$86.10`, coincide
exacto con lo que F104 ya calculaba bien.

### 2. ATS no incluía las NC recibidas en ningún lado
`backend/routes/ats.js` no tenía ninguna referencia a `docs_recibidos_otros`.
Agregado a las 3 rutas:
- `/preview`: nuevo array `ncsRecibidas` + `totales.totalNcRecibidasIva`.
- `/exportar` (XML): nueva entrada `<detalleCompras>` por cada NC, con
  `tipoComprobante='04'` y **valores siempre positivos** (ver bug #5), más los
  campos de referencia al documento original: `docModificado`,
  `estabModificado`, `ptoEmiModificado`, `secModificado` (parseados del
  `numDocModificado` del XML de la NC). `autModificado` se omite a propósito —
  el XML de la NC no trae la clave de acceso del documento original, solo su
  establecimiento-punto-secuencial, y el campo es opcional en el XSD
  (`minOccurs="0"`).
- `/exportar/pdf`: nueva fila `04 NOTA DE CRÉDITO` en la sección COMPRAS del
  talón, restada del total (misma convención que ya usaban las NC emitidas en
  VENTAS).

### 3. Nuevo parser compartido: `parsearNotaCreditoRecibidaXml()`
`backend/utils/sri.js` — extrae de `docs_recibidos_otros.xmlAutorizado`: bases
por tarifa (0%/5%/12%/15%/no objeto), IVA, y la referencia al documento
modificado. Verificado contra 3 XMLs reales de producción (uno 0%, uno 15%) —
la suma base+IVA coincide al centavo con `importeTotal`. Usado ahora en
`facturas.js`, `ats.js` y `contabilidad.js` (bug #6).

### 4. Bugs del XSD **no relacionados con NC**, encontrados de paso
Al validar mecánicamente el XML contra el XSD oficial aparecieron errores que
llevaban ahí desde siempre, afectando **todas** las compras/ventas, no solo las
NC:
- **Elemento raíz incorrecto** — el XML generaba `<ats>...</ats>`, pero el XSD
  declara globalmente `<xsd:element name="iva" type="ivaType" />`. El archivo
  debía llamarse `<iva>...</iva>`. Este es probablemente el bug con más impacto
  real: un XML con la raíz equivocada puede ser rechazado de entrada por
  cualquier validación estricta.
- **`<fechaEmisionDoc>` no existe en el XSD** — el campo correcto en
  `detalleCompras` es `<fechaEmision>`. Corregido.
- **`<baseImpExe>` faltaba por completo** — campo obligatorio (sin
  `minOccurs="0"`) en `detalleCompras`, entre `baseImpGrav` y `montoIce`. El
  sistema nunca lo generó. Agregado en `0.00` — el sistema aún no distingue
  "exenta de IVA" como categoría propia de "no objeto de IVA" (son 2 casilleros
  distintos del SRI); implementar esa distinción sería una feature nueva,
  similar a como se hizo con `subtotalNoObjeto` el 2026-07-17.
- **`<parteRel>` → debía ser `<parteRelVtas>`, `<tipoCli>` → debía ser
  `<tipoCliente>`** en `detalleVentas`. Corregido.
- **NC emitidas usaban valores NEGATIVOS** en `detalleVentas` (`baseImpGrav -=
  ...`, `montoIva -= ...`) — el XSD exige `monedaType` con `minInclusive
  0.0`, **nunca negativo**. El signo/efecto de la NC lo determina el SRI a
  partir de `tipoComprobante='04'`, no un valor negativo en el campo. Cambiado
  a positivo (mismo criterio aplicado a las NC recibidas nuevas).

**Importante**: estos 4 bugs del XSD llevaban tiempo en el código (no son de
esta sesión) y afectaban el XML de **todas** las declaraciones ATS generadas
por el sistema hasta hoy, no solo las que tienen NC. Se corrigieron porque
aparecieron validando el fix de NC, pero su alcance real es mayor — cualquier
cliente que haya subido un ATS generado por este sistema pudo haber tenido
problemas de validación en el portal del SRI. Recomendado confirmar con algún
cliente si tuvo que corregir manualmente el XML alguna vez antes de subirlo.

### 5. Contabilidad: asiento de NC recibida no separaba el IVA
`backend/utils/contabilidad.js` → `crearAsientoDocRecibidoOtro()`: para una NC
recibida (tipo '04'), contabilizaba el ajuste **completo** contra la cuenta de
Gasto/Compras (`5.2.01.001`), sin tocar la cuenta de IVA Crédito Tributario
Compras (`1.1.05.001`) — a diferencia de una compra normal, que sí separa el
IVA en su propia cuenta. Esto sobreestimaba la reducción de gasto y dejaba el
saldo de IVA Crédito Tributario Compras desalineado con lo que el ATS y las
Declaraciones ya calculaban correctamente. Corregido: ahora parsea el
`xmlAutorizado` (mismo parser del punto 3) y genera un asiento de 3 líneas
(CxP proveedor / Gasto por la base / IVA Crédito Tributario por el IVA) cuando
hay IVA parseable; si no (ND, o NC sin XML), conserva el comportamiento
anterior de 2 líneas.

**Verificado sin escribir nada** (simulación con los 2 NC reales de LSAC
empresaId=10): ambos asientos cuadran exacto (debe = haber, diferencia
$0.00).

**Por confirmar con el usuario**: este fix solo aplica a NC **nuevas** que se
importen de aquí en adelante. Las 2 NC recibidas que ya existen en producción
(LSAC, junio 2026) ya generaron su asiento contable con la lógica vieja
(íntegro contra Gasto) — **no se corrigieron retroactivamente**, es una
decisión que requiere confirmación explícita antes de tocar asientos contables
ya posteados en producción.

### 6. NC emitidas — ya estaban correctas
`crearAsientoNotaCreditoEmitida()` ya separaba el IVA correctamente (reversa
Ventas + IVA Ventas por Pagar + CxC) desde antes de esta sesión — no necesitó
cambios. Confirma el patrón de todos los bugs de esta sesión: el lado
"recibido" (NC de proveedores) llevaba tiempo sin la misma atención que el lado
"emitido" (NC a clientes) en Reportes Tributarios, ATS y Contabilidad — solo
Declaraciones (F104) ya trataba ambos lados correctamente.

---

## Auditoría amplia — hallazgos que quedan pendientes (no implementados hoy)

Por pedido explícito del usuario se revisó **todo lugar** donde deberían
impactar las NC (recibidas y emitidas). Dos gaps reales encontrados, fuera del
alcance de "reportes/declaraciones/ATS" que ya se corrigió:

1. **Cuentas por Pagar (`backend/routes/cxp.js`)**: el saldo pendiente por
   proveedor se calcula solo como `factura.importeTotal - pagos registrados`
   — **nunca resta las NC recibidas**. Si un proveedor le envía una NC de
   $50 sobre una factura de $200 ya pagada $0, CxP sigue mostrando $200
   pendientes en vez de $150. Arreglar esto requiere además resolver a qué
   `facturas_compra` específica corresponde cada NC (`docs_recibidos_otros`
   no tiene FK a `facturas_compra` — solo la referencia embebida en el XML,
   `numDocModificado`, que habría que cruzar por proveedor + número de
   factura).
2. **Cuentas por Cobrar (`backend/routes/cxc.js`)**: mismo problema, simétrico,
   del lado de clientes — el saldo tampoco resta `notas_credito`. Este caso es
   más simple de arreglar porque `notas_credito.facturaId` **sí** es una FK
   directa a la factura afectada (ya existe en el schema); solo falta usarla en
   el cálculo de saldo.
3. **Inventario**: ni las NC emitidas ni las recibidas generan movimiento de
   inventario (no hay reversa de stock). No está claro si esto es un bug o una
   decisión deliberada (una NC puede ser un simple ajuste de precio, no
   necesariamente una devolución física de mercadería) — se deja anotado para
   decidir con el usuario, no se tocó.

---

## Verificación realizada (sin escribir nada en producción)

- Backend: `node --test` → 29/29 tests pasan.
- Frontend: `npx vite build` → limpio, sin errores.
- Cálculo de `ivaCreditoFiscal` corregido validado contra datos reales de
  producción (LSAC empresaId=10, junio 2026): coincide exacto con F104
  ($86.10).
- XML del ATS generado con datos reales de producción y **validado contra el
  XSD oficial del SRI** (`ats.xsd` descargado de `descargas.sri.gob.ec`) — 0
  errores tras los fixes.
- Asiento contable corregido de NC recibida simulado (sin persistir) contra
  los 2 registros reales — ambos cuadran exacto.
- Todas las consultas contra producción fueron de **solo lectura** (conexión
  pública de Railway ya usada en la sesión anterior para la limpieza de
  Comercial S&S, guardada en `.env.local`, gitignored).

## Pendiente de decidir con el usuario (estado al cierre de la sesión)

1. ~~¿Corregir retroactivamente los 2 asientos contables de NC recibida ya
   posteados en producción (LSAC)?~~ — **EN ESPERA de respuesta del cliente**,
   por indicación explícita del usuario. No tocar los asientos ya posteados
   hasta entonces.
2. ~~¿Priorizar el fix de saldo en CxC/CxP?~~ — **IMPLEMENTADO** (ver sección
   siguiente).
3. ¿Alguna vez un cliente tuvo que corregir manualmente el XML del ATS antes de
   subirlo al SRI? — **Sigue pendiente**, es una pregunta para el cliente, no
   algo que se pueda resolver con código.
4. ~~¿Implementar la categoría "exenta de IVA" (`baseImpExe`)?~~ —
   **IMPLEMENTADO** (ver sección siguiente).
5. ~~Desplegar a producción~~ — el commit `646148f` (fixes de NC recibidas +
   XSD) ya se desplegó. Los cambios de esta segunda parte (CxC/CxP + exenta de
   IVA) se despliegan al cierre de este documento.

---

## Segunda parte de la sesión — CxC/CxP descuentan notas de crédito + categoría "Exenta de IVA"

### CxC (`backend/routes/cxc.js`) — el saldo pendiente ahora descuenta NC emitidas

Antes: `saldoPendiente = importeTotal - cobrado`, ignorando por completo
`notas_credito` aunque `facturaId` ya era una FK directa desde siempre. Nuevo
helper `obtenerNotasCreditoPorFactura()` (agrupa `notas_credito` por
`facturaId`, autorizadas y no anuladas) aplicado en los 7 puntos donde se
calculaba saldo: `/vigentes`, `/canceladas` (ahora también detecta facturas
saldadas solo por NC sin ningún cobro real), el PDF del recibo, `POST /cobros`
(valida contra el saldo real antes de aceptar un cobro), `/reporte/antiguedad`,
`/reporte/estado-cuenta` (agregado y detalle), y la importación masiva de
cobros por Excel.

**Verificado con datos reales de producción** (`railway`, empresaId=1, 2 NC
emitidas reales vinculadas a sus facturas): ambas dejan el saldo en `$0.00`
exacto — antes aparecían como si se debiera el monto completo de la factura
pese a estar ya saldadas por la nota de crédito.

Frontend (`CuentasPorCobrarHub.jsx`): nueva columna "N. Créd." en las 3 tablas
(vigentes/canceladas, antigüedad, estado de cuenta) mostrando el monto restado.

### CxP (`backend/routes/cxp.js`) — cruce sin FK directa por proveedor + número de documento

`docs_recibidos_otros` (NC recibida) no tiene FK a `facturas_compra` — el
cruce se hace por `identificacionProveedor + numeroFactura` contra el
`numDocModificado` que trae el XML de cada NC (mismo parser de la primera
parte de la sesión). Nuevo helper `obtenerNotasCreditoPorCompra()` aplicado en
los mismos 6 puntos equivalentes de `cxp.js`.

**Verificado con datos reales**: de las 10 NC recibidas reales en producción,
**8 encontraron su factura original** en el sistema (80%) — las 2 que no
coinciden son de un proveedor cuyas facturas originales nunca se registraron
en AELA, así que quedan sin vincular (comportamiento esperado, no hay con qué
cruzarlas). Para las 2 compras de LSAC empresaId=10 usadas como caso de prueba
en toda la sesión: una queda con saldo `$0.00` (NC cubre el 100%) y otra con
saldo `$17.97` (NC parcial sobre una compra de $35.94) — ambos verificados
contra los montos reales.

Frontend (`CuentasPorPagarHub.jsx`): misma columna "N. Créd." agregada en las
3 tablas equivalentes.

### Categoría "Exenta de IVA" en compras — separada de "No objeto de IVA"

Al escribir la sección de NC recibidas se encontró que `subtotalNoObjeto`
(agregado el 2026-07-17) en realidad combinaba **dos casilleros legales
distintos del SRI** (tabla 17: código 6 "No objeto" y código 7 "Exenta"), con
un comentario explícito en el código que decía *"ATS reporta ambas bajo el
mismo campo baseNoGraIva"* — afirmación que el XSD oficial contradice
directamente: `baseNoGraIva` (no objeto) y `baseImpExe` (exenta) son 2 campos
obligatorios separados en `detalleCompras`. La confusión venía de una lectura
con columnas mal alineadas del PDF de la ficha técnica.

Implementado exactamente con el mismo patrón que "no objeto" del 07-17:
- Migración `20260721000000_subtotal_exento_compras` — nueva columna
  `facturas_compra.subtotalExento`, sin backfill (mismo motivo: imposible
  distinguir retroactivamente qué parte de `subtotalNoObjeto` era en realidad
  "exenta").
- `backend/routes/compras.js`: nuevo flag `esExentoIva` por línea de detalle,
  independiente de `esNoObjetoIva`, en los 2 endpoints de creación (manual y
  Excel).
- `frontend/.../FormCompra.jsx`: el select por línea ahora tiene **dos**
  opciones separadas ("No objeto de IVA" / "Exenta de IVA") en vez de una
  combinada; el resumen muestra ambos totales por separado si son > 0.
- `backend/routes/declaraciones.js` (F104): `compras.subtotalExento` agregado
  al desglose de respuesta, igual que `subtotalNoObjeto`.
- `backend/routes/ats.js`: el XML (`/exportar`) ya usa el valor real de
  `subtotalExento` en `<baseImpExe>` de cada compra (antes era literalmente
  `0.00` fijo, incluso después del fix de NC de esta misma sesión). El PDF
  del talón combina "No objeto" + "Exenta" en la columna "No Obj." existente
  por espacio — el XML sí las reporta separadas, que es lo que de verdad
  procesa el SRI.
- `backend/utils/sri.js` (`parsearNotaCreditoRecibidaXml`): también se separó
  `baseNoObjeto`/`baseExenta` ahí (antes combinadas igual que en compras), para
  que una NC recibida algún día con código 7 se reporte correctamente en
  `baseImpExe` en vez de sumarse a `baseNoGraIva`. Ningún dato real actual usa
  código 7 todavía — cambio hecho por consistencia, sin poder probarse contra
  un caso real.

**Verificado**: 29/29 tests backend, build frontend limpio, `prisma validate`
limpio, migración aplicada localmente sin error, y el XML regenerado con datos
reales de producción sigue validando con **0 errores** contra el XSD oficial
del SRI tras todos los cambios de esta segunda parte.

### Pendiente — no implementado hoy

- No se agregó un flag `esExentoIva` a la plantilla de importación masiva de
  compras históricas (Excel) — ese importador nunca distinguió "no
  objeto"/"exenta"/tarifa 0% entre sí (todo cae en "sin IVA" genérico), es una
  limitación preexistente, no una regresión de hoy.
- El mismo problema de "no objeto" y "exenta" combinados en un solo campo
  existe también del lado de **ventas** (`facturas.subtotalNoObjetoIva`,
  usado en `utils/importarFacturasVentaXML.js`) — no se tocó, el pedido de hoy
  fue específicamente sobre compras.
