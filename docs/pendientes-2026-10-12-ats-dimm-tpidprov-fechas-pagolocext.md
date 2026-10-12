# Sesión 2026-10-12 — ATS: 4 errores de DIMM corregidos + warning de IVA investigado y cerrado

## Reportado

El usuario compartió capturas del validador oficial DIMM del SRI (software
de escritorio que valida el .zip/.xml del Anexo Transaccional Simplificado
antes de subirlo) rechazando el ATS generado por el sistema para el tenant
LABORATORIO CLINICA SAN JOSE RUIZ Y GUARICELA Y CIA (RUC 1191794911001),
período 2026-09, junto con el XML real (`ats_202609.xml`, 51 facturas de
compra). Errores reportados por DIMM:

1. "El código del TIPO DE IDENTIFICACIÓN DEL PROVEEDOR reportado [04] no
   es un valor permitido para COMPRAS." (repetido en todas las líneas)
2. "El CÓDIGO DE SUSTENTO TRIBUTARIO reportado [01] no es permitido para
   COMPRAS con comprobantes de TIPO [01]."
3. "El TIPO DE COMPROBANTE reportado [01] no es permitido para proveedores
   de TIPO [04]."
4. "La FECHA DE REGISTRO CONTABLE DEL COMPROBANTE [12/10/2026] debe
   pertenecer al periodo informado [2026/9]."
5. "No se ha reportado la información de PAGO LOCAL O AL EXTERIOR."
6. "No ha reportado las FORMAS DE PAGO utilizadas, aun cuando... exceden
   los USD. 1000.00."
7. WARNING: "EL MONTO DE IVA reportado [0.26] es diferente al esperado
   [0.21]" (una línea puntual) + warning de doble tributación.

## Diagnóstico (contra la Ficha Técnica oficial del SRI, no por prueba y error)

Antes de tocar código se descargó y leyó la Ficha Técnica oficial del ATS
(`descargas.sri.gob.ec/download/anexos/ats/FICHA_TECNICA_ATS_JULIO2016.pdf`,
159 págs — sin poppler disponible en el entorno, se extrajo texto con
pymupdf) para confirmar nombres de campo, catálogos y orden exacto, en
línea con [[feedback_verificar_fuente_antes_de_fix_masivo]].

Hallazgo clave: el SRI usa **dos catálogos "tipo de identificación"
distintos y paralelos**:

- El de **comprobantes electrónicos** (el que AELA guarda en toda la BD:
  `tipoIdentificacionProveedor`, `tipoIdentificacionComprador`, etc.) —
  04=RUC, 05=Cédula, 06=Pasaporte, 07=Consumidor Final.
- El de **ATS "Tabla 2"** (pág. 62 de la Ficha Técnica), que reutiliza los
  mismos números pero con significado **distinto según el tipo de
  transacción**: 01=COMPRA+RUC, 02=COMPRA+Cédula, 03=COMPRA+Pasaporte,
  04=VENTA+RUC, 05=VENTA+Cédula, 06=VENTA+Pasaporte, 07=VENTA+Consumidor
  Final.

`ats.js` reportaba el código crudo de comprobantes (04) directo en
`tpIdProv` — válido solo para **VENTA** en la Tabla 2, nunca para COMPRA
(de ahí el error #1). Los errores #2 y #3 citan literalmente los valores
ya presentes en el XML (codSustento=01, tipoComprobante=01) — son
síntomas en cascada: al no reconocer tpIdProv=04 como un código de COMPRA
válido, DIMM no puede validar el resto de reglas de esa línea en el
contexto correcto. **Importante**: el lado `<ventas>` (tpIdCliente) NO
necesita conversión — ahí la Tabla 2 coincide exactamente con el catálogo
de comprobantes, así que `acumularVenta()` no se tocó.

El error #4 (fecha de registro) se debía a que `fechaRegistro` usaba
`compra.createdAt` (fecha en que el documento se importó al sistema) en
vez de `compra.fechaEmision` — estas 51 facturas se importaron por lote
semanas después de su emisión real de septiembre, así que `createdAt`
caía en octubre, fuera del período informado.

Los errores #5 y #6 son campos que `ats.js` nunca emitía:
`pagoLocExt` (obligatorio, pág. 6 de la Ficha Técnica: 01=pago local,
02=pago al exterior) y `formaPago` (condicional, pág. 7: obligatorio solo
cuando base+IVA+ICE de la línea supera USD 1000, repetible por cada
código distinto de la Tabla 13 usado en el pago).

El warning #7 (IVA) se investigó por separado pidiendo al usuario el XML
autorizado real de esa factura puntual (proveedor TECNOAUSTRAL
1190047276001, secuencial 000057244, 29/09/2026). El XML certificado por
el SRI declara `codigoPorcentaje=4` (tarifa 15%) y `valor=0.26` —
exactamente lo que AELA reportó. DIMM esperaba $0.21 (= 12%, la tarifa
vieja pre-2024). Como el resto de líneas del mismo ATS también están al
15% sin que DIMM las marcara todas, se concluyó que es una inconsistencia
puntual del propio validador DIMM (no de AELA) — **no se tocó código**,
para no falsificar el ATS frente al valor real autorizado por el SRI.

## Fix (`backend/routes/ats.js`, commit `5f51031`)

1. Nuevo helper `tipoIdProveedorAts()`: convierte 04/05/06 (catálogo de
   comprobantes) a 01/02/03 (Tabla 2-COMPRA); pasa sin cambio un valor ya
   en 01-03; default seguro RUC (01) ante código vacío/desconocido. Usado
   en `tpId` del bloque principal de `<detalleCompras>` y hardcodeado a
   `01` en el bloque de notas de crédito recibidas (`nc.rucEmisor` siempre
   es RUC).
2. `fechaRegistro` en ambos bloques (`detalleCompras` principal y NC
   recibidas): usa `fechaEmision`, ya no `createdAt`.
3. `<pagoLocExt>01</pagoLocExt>` insertado en ambos bloques, en la
   posición exacta confirmada por la Ficha Técnica (después de
   `totbasesImpReemb`, antes de `air`/`docModificado`).
4. `<formaPago>` condicional (solo si `baseNoObjeto+base0+baseGravada+
   baseExenta+ICE+IVA > 1000`), construido desde `compra.pagos`
   (deduplicado por código — ya usa el mismo catálogo Tabla 13 que
   `backend/utils/formasPago.js`, sin necesidad de conversión).

Nuevo test `backend/test/ats.test.js` (3 casos) para `tipoIdProveedorAts()`,
exportado junto al router (`module.exports.tipoIdProveedorAts`).

## Verificación

- 159/159 tests backend (3 nuevos), sin regresiones.
- Diff revisado línea por línea contra el XML real compartido por el
  usuario antes de comitear.
- Warning de IVA verificado contra el XML autorizado real de la factura
  puntual (no supuesto) — confirmado que no es un bug.

## Pendiente / salvedad

- **Falta que el usuario regenere el ATS de 2026-09 con el fix ya
  desplegado y lo vuelva a validar con DIMM** para confirmar en vivo que
  los 6 errores desaparecen (los 4 confirmados por investigación directa
  + los 2 que se asumen cascada del mismo bug raíz, sin verificación
  independiente de esos 2 puntualmente).
- El warning de doble tributación (visible en la captura original, sin
  texto exacto ni línea identificada) no se investigó — si reaparece tras
  regenerar, pedir la captura completa y la factura puntual.
- El warning de IVA de la línea TECNOAUSTRAL se da por cerrado sin cambio
  de código — si DIMM sigue marcando IVA en otras líneas del mismo u
  otros ATS, revisar si es un patrón (parámetro de tarifa de DIMM
  desactualizado) antes de asumir que es siempre así de inofensivo.
