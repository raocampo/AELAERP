# AELA ERP — Sesión 2026-08-04 — Auditoría estadoSri + resoluciones SRI transporte/RUC proveedor + ajustes RIDE

## Parte 1 — Auditoría completa del filtro `estadoSri`

### Contexto

Continuación del punto 2 pendiente de `docs/pendientes-2026-08-03.md`: "Auditar
el resto del código por el mismo patrón" del bug del Dashboard (`af12c3a`,
2026-08-03) — queries que suman `facturas`/`notas_credito`/`liquidaciones_compra`
sin filtrar `estadoSri`, contando documentos RECHAZADOS o atascados en
PENDIENTE_FIRMA/ENVIADO/ERROR como si fueran ventas reales.

### Bugs reales encontrados y corregidos (commit `58db3d7`)

Se auditaron **todos** los usos de `.aggregate()`/`.count()`/`.findMany()` sobre
`facturas`, `notas_credito`, `liquidaciones_compra` y `retenciones` en todo
`backend/` (rutas + `utils/colaSRI.js`). Se encontraron 2 archivos con el
mismo bug, ninguno de los cuales había sido tocado por el fix del Dashboard:

**1. `backend/routes/declaraciones.js` — Formularios 104 y 101**
- F104 ventas: `facturas.findMany` (+ su `notas_credito` anidada) sin filtro.
- F104 liquidaciones: `liquidaciones_compra.findMany` sin filtro.
- F101 (IR anual): `facturas.aggregate` sin filtro.
- `/disponibles` (selector de períodos): `facturas.groupBy` sin filtro.

**2. `backend/routes/facturas.js` — `GET /reportes/tributario`**
Este es el endpoint real que consume la página **Reportes Tributarios** del
frontend (`ReportesTributarios.jsx`) — un endpoint totalmente distinto a
`declaraciones.js`, así que el fix del punto 1 no lo cubría. Faltaba el
filtro en las 4 queries que arman el resumen: `facturas`, `notasCredito`,
`retenciones` y `liquidaciones`.

**Fix aplicado** (mismo criterio ya usado en el Dashboard y en `ats.js`/`cxc.js`,
que sí filtraban correctamente):
- `facturas`/`liquidaciones` con estado válido: `AUTORIZADO` o `HISTORICO`
  (venta real importada de un período anterior, sin flujo SRI).
- `notas_credito`/`retenciones`: solo `AUTORIZADO` (no aplica `HISTORICO`).

**Verificado contra datos reales** (empresa Corp Simtelec, `aela_db` local):
existían 2 facturas de mayo/2026 por $241.50 cada una a la misma clienta, una
AUTORIZADA y otra RECHAZADA. Antes del fix, tanto `declaraciones.js` como
`facturas.js /reportes/tributario` sumaban **$483.00** (duplicando la
rechazada); después del fix, ambos reportan correctamente **$241.50**.

### Confirmado SIN bug (ya filtraban correctamente, no se tocó nada)

- `backend/routes/ats.js` (Anexo Transaccional Simplificado) — todas las
  queries de ventas ya filtran `estadoSri: 'AUTORIZADO'`.
- `backend/routes/cxc.js` (Cuentas por Cobrar) — las 5 queries de facturas
  (`/vigentes`, `/canceladas`, `/reporte/antiguedad`, `/reporte/estado-cuenta`
  x2) ya filtran `estadoSri: 'AUTORIZADO'`.
- `backend/routes/empresas.js` (`/estadisticas`, Dashboard) — ya corregido el
  2026-08-03 en `af12c3a`.
- `backend/utils/colaSRI.js` (worker de reintento + contador de pendientes
  para el badge del frontend) y `backend/routes/sync.js` (`/estado`) —
  consultan `estadoSri: 'PENDIENTE_FIRMA'`/`'FIRMADO_PENDIENTE_ENVIO'` a
  propósito (es su función: encontrar lo que falta procesar), no es el mismo
  bug.
- `backend/routes/facturas.js` — listados/exports (`GET /`, `/exportar/pdf`,
  `/exportar/xlsx`, "Libro de Ventas"): son ledgers filtrables por el usuario
  que muestran el estado por fila (columna "Estado SRI" visible) en vez de
  ocultarlo detrás de un total agregado — no es el mismo patrón de bug
  (KPI/reporte que oculta el estado y sólo muestra un número).

**Conclusión**: la auditoría del punto 2 de `pendientes-2026-08-03.md` queda
**cerrada**. El patrón del bug del Dashboard existía en 2 lugares más (ambos
con impacto directo en los formularios de declaración de impuestos reales,
F104/F101, más grave que el bug original del Dashboard) y ya están
corregidos y verificados.

---

## Parte 2 — RUC Proveedor: nombre de campo CONFIRMADO contra la Ficha Técnica oficial (commit `397cf73`)

El usuario compartió un resumen de terceros sobre las últimas disposiciones
SRI (RUC proveedor, transporte comercial). En vez de implementar a partir de
ese resumen, se descargó y leyó **el texto oficial completo** de la Ficha
Técnica de Comprobantes Electrónicos Esquema Offline **versión 2.34**
(sri.gob.ec, publicada jul-2026 — la más reciente, encontrada vía WebFetch a
la página de facturación electrónica del SRI, descargada con `curl` y leída
con `pymupdf`, mismo patrón que la sesión de retenciones del 07-30).

El **Anexo 26** ("REQUISITO OBLIGATORIO DE INFORMACIÓN DE RUC DE PROVEEDOR DE
SISTEMAS INFORMÁTICOS O SERVICIOS DE FACTURACIÓN ELECTRÓNICA") da la
especificación exacta:
- Nodo: `<infoAdicional>`, tag `<campoAdicional>`.
- Atributo `nombre`: **"RUC Proveedor"** (no "RUC Proveedor Sistema", la
  etiqueta propia sin verificar que se usaba desde el 29-jul; tampoco
  "Proveedor del Sistema", que fue lo que le compartieron al usuario después).
- Formato: alfanumérico, máx. 300 caracteres. Contenido: número de RUC.

**Fix**: corregido el `nombre` del campo en el XML (`_agregarInfoAdicional`
en `sri.js`) y en las 5 etiquetas del RIDE (antes "Prov. Sistema Fact.",
ahora "RUC Proveedor"). El mecanismo (mismo `campoAdicional` genérico dentro
de `infoAdicional`, que ya se usaba para Email/Teléfono/Observación) siempre
fue correcto — solo cambió el texto del atributo `nombre`. Esto también
resuelve el punto 7 pendiente de `pendientes-2026-08-03.md`.

De paso se confirmó que las otras 2 leyendas que preguntó el usuario
("Contribuyente Régimen RIMPE" y "Agente de Retención Nro.") **ya estaban
implementadas** en los generadores de RIDE — nada que agregar ahí.

---

## Parte 3 — Sector transporte terrestre comercial: Anexo 25 (commit `99c5535`)

Mismo documento oficial (Ficha Técnica v2.34), **Anexo 25** — "REQUISITOS
OBLIGATORIOS DE LLENADO PARA EL XML DE FACTURAS EMITIDAS POR LAS OPERADORAS Y
SUS SOCIOS O ACCIONISTAS, DE TRANSPORTE COMERCIAL, EXCEPTO TAXIS". Dos
requisitos técnicos distintos (el resumen que compartió el usuario los
mezclaba en uno y traía un plazo equivocado):

1. **`<codigoAuxiliar>`** por cada `<detalle>` — `H492001` (operadora →
   cliente) o `H492002` (socio/accionista → operadora). **Ya obligatorio
   desde el 01-nov-2025** (no es nuevo).
2. **`<placa>`** a nivel de comprobante (entre `<moneda>` y `<pagos>`),
   formato sin espacios (`ABC1234`, o `ABC0123` si son 3 dígitos).
   Obligatorio a los 90 días de publicada la Res. NAC-DGERCGC26-00000024 en
   el Registro Oficial (≈oct-2026 — el usuario había mencionado 31-dic-2026,
   pero esa fecha corresponde a otra obligación distinta: la actualización/
   incorporación de RUC de los transportistas, extendida por una resolución
   posterior del 31-jul).

El usuario confirmó que **próximamente tendrá un cliente de este sector** —
se implementó el feature completo, no solo se documentó:

- `configuracion_sri.sectorTransporte` (`'OPERADORA'` | `'SOCIO'` | null) —
  columna nueva + migración `20260804000000_sector_transporte_comercial` +
  entrada en `applySchemaFixes.js` (para que llegue a las BDs de tenants en
  producción, no solo a esta BD local).
- `facturas.placaVehiculo` — columna nueva.
- `ConfiguracionSRI.jsx`: selector "Sector Transporte Terrestre Comercial"
  (No aplica / Operadora / Socio-Accionista).
- `FormFactura.jsx`: campo "Placa del vehículo" que solo aparece (y es
  obligatorio) si la empresa tiene `sectorTransporte` configurado — se lee
  `GET /facturas/configuracion` al montar el formulario.
- `POST /facturas`: valida la placa (obligatoria + formato) antes de
  consumir secuencial, mismo patrón que las demás validaciones del endpoint.
- `generarXMLFactura` (`sri.js`): agrega `<placa>` y `<codigoAuxiliar>` en el
  orden correcto dentro del XML (confirmado contra el XSD: codigoPrincipal →
  codigoAuxiliar → descripción).
- RIDE: "Placa Vehículo" visible en el cuadro de Información Adicional.

**Verificado**: programáticamente contra la función real de generación de
XML (orden de tags, valores H492001/H492002 según rol, ausencia total de los
campos cuando `sectorTransporte` es null) y visualmente el RIDE (PNG vía
pymupdf).

**Pendiente real que queda**: cuando el usuario active el tenant de
transporte, entrar a Facturación → Configuración SRI y marcar "Operadora" o
"Socio/Accionista" según corresponda. Sin eso, el sistema no agrega nada (así
debe ser para el resto de clientes, que no son de este sector).

---

## Parte 4 — Ajustes visuales del RIDE (commit `d38e597`)

El usuario compartió una captura de una factura real: la tabla "Forma de
pago" se salía de su recuadro con formas de pago de descripción larga (ej.
"20 - Otros con utilización del sistema financiero"), y pidió que el RUC del
encabezado resaltara más y que el logo aprovechara mejor su espacio.

**Causa raíz del desborde**: se comprobó empíricamente que en PDFKit
`lineBreak: false` **no** evita que el texto se envuelva a una segunda línea
cuando se le da un `width` acotado — solo afecta otro comportamiento interno
(no el wrap). La fila de la tabla tenía alto fijo (13pt), así que una
descripción larga se envolvía a 2 líneas y desbordaba el recuadro.

**Fix**: alto de fila dinámico en la tabla de "Forma de pago" (mismo patrón
ya usado en "Información Adicional" con `heightOfString`), aplicado en los 3
generadores de RIDE que comparten ese encabezado (Factura, Retención,
Liquidación de Compra). Además: RUC del encabezado a 11pt centrado (antes
7pt a la izquierda, poco visible) y logo con más alto permitido (65→85pt)
para que ocupe mejor el ancho de su columna — cambiado en los mismos 3
generadores.

**Verificado**: reproducido el escenario exacto de la captura del usuario
(mismo cliente, mismo monto, forma de pago "20") y renderizado a PNG vía
pymupdf — confirmado que ya no se desborda y el encabezado se ve más claro.

---

## Commits de esta sesión (2026-08-04)
`58db3d7` fix estadoSri reportes/declaraciones · `3c48910` docs · `397cf73`
fix nombre campo RUC Proveedor · `99c5535` feat sector transporte comercial ·
`d38e597` fix RIDE forma de pago + RUC/logo header.

`node --test`: 29/29 después de cada cambio. `vite build`: sin errores.

---

## 🔴 PARA RETOMAR (consolidado, reemplaza la lista del 2026-08-03)

1. **Verificar visualmente en emulador** el gating de módulos de la app móvil
   (`docs/pendientes-2026-08-03.md` punto 3) — no se pudo hacer en este
   equipo, sigue pendiente.
2. ✅ RESUELTO — auditoría estadoSri (Parte 1 de este documento).
3. **App móvil "onrender"** — recompilar con `eas build` y reinstalar para
   confirmar que ya toma la URL de Railway; si persiste, revisar env vars en
   expo.dev.
4. **Buzón SRI — descarga automática** sigue sin confirmarse en Railway
   producción (fix de Puppeteer pusheado desde el 07-29, nunca verificado
   end-to-end en prod real).
5. **16 registros de Puchaicela** con ratio de IVA fuera del patrón conocido
   — esperando que la contadora confirme el valor correcto antes de tocarlos.
6. **Backlog "más PRO"** (auditoría 2026-07-29), sin implementar: Anticipo de
   Impuesto a la Renta, Anexo RDEP, avisos de entrada/salida IESS, F101
   completo (hoy solo resumen orientativo), notas a los EEFF, apertura
   automática del año siguiente tras el cierre de ejercicio.
7. ✅ RESUELTO — nombre exacto del campo RUC Proveedor (Parte 2 de este
   documento).
8. **Utilidades 15% y Liquidación de haberes** (nómina) — implementadas pero
   no se alcanzaron a probar en navegador real.
9. Dos bugs de timezone/drift de baja prioridad (ver memoria persistente):
   `startOfDay`/`endOfDay` en `contabilidad.js` sensible al offset UTC del
   servidor; y 5-7 tablas en la BD sin definición en `schema.prisma`
   (`cheques_recibidos`, `comprobantes_bancarios*`, `movimientos_tarjeta`,
   `proformas`, `tarjetas_credito`).
10. **Nuevo — activar `sectorTransporte`** en Configuración SRI cuando se dé
    de alta el próximo cliente de transporte (Parte 3 de este documento) —
    el código ya está listo, solo falta el toggle en ese tenant específico.
11. **Nuevo — placa del vehículo obligatoria a nivel SRI** (no solo AELA):
    el plazo real de 90 días desde la publicación de la Res.
    NAC-DGERCGC26-00000024 vence ≈oct-2026 — confirmar la fecha exacta de
    publicación en el Registro Oficial cuando se acerque, para no perder el
    plazo con el cliente de transporte.
