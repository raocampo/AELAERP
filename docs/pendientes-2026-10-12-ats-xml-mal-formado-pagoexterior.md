# Sesión 2026-10-12 (continuación) — ATS: "El XML esta mal formado" en DIMM

Continuación directa de `docs/pendientes-2026-10-12-ats-dimm-tpidprov-fechas-pagolocext.md`
(mismo día, otra máquina) — el usuario regeneró el ATS de 2026-09 con ese fix
ya aplicado y DIMM rechazó el archivo con un error nuevo: **"El XML esta mal
formado (xml)"**, repetido en decenas de líneas (37, 67, 96, 125...), siempre
columna 19.

## Diagnóstico — con el XML real, no por prueba y error

1. Pedí el archivo real al usuario (`ats_202609.xml`, LABORATORIO CLINICA
   SAN JOSE RUIZ Y GUARICELA, RUC 1191794911001) en vez de seguir probando
   con datos sintéticos — con mis propios datos de prueba (compra normal,
   con retención, con `formaPago` por monto, 5 compras simples) el XML
   siempre salía bien formado, sin reproducir el bug.
2. Validé el archivo real con `fast-xml-parser` (`XMLValidator.validate`,
   el mismo parser estricto con línea/columna usado en la sesión del
   09-29) — **vino bien formado**. Contradicción aparente con DIMM.
3. Localicé la línea exacta de cada error reportado por DIMM en el archivo
   real: **las 51 veces es la misma línea, `<pagoLocExt>01</pagoLocExt>`**
   (confirmado con `sed -n '37p;67p;96p;...'`).
4. Conclusión: el error de DIMM no es de buena formación XML genérica sino
   de **validación contra el XSD** (DIMM reporta "mal formado" para
   cualquier fallo de su validador, no solo sintaxis). Descargué el XSD
   oficial real (`https://descargas.sri.gob.ec/download/anexos/ats/ats.xsd`,
   vía WebSearch + curl) y lo leí directo — **no volver a confiar solo en
   la Ficha Técnica en PDF para esto**, el XSD es la fuente exacta.

## Causa raíz confirmada

El fix de la sesión anterior (commit `5f51031`) emitía `<pagoLocExt>` y
`<formaPago>` como hijos **directos y sueltos** de `<detalleCompras>`. El
XSD real no los define así — ninguno de los dos existe como hijo directo de
`detalleComprasType`. La estructura real:

```
detalleComprasType
  ...
  totbasesImpReemb
  pagoExterior (opcional)          ← contenedor que faltaba
    pagoLocExt        (01=local, 02=exterior)
    tipoRegi          (opcional, no usado)
    ...
    aplicConvDobTrib  (SI/NO/NA — OBLIGATORIO dentro de pagoExterior)
    pagExtSujRetNorLeg(SI/NO/NA — OBLIGATORIO dentro de pagoExterior)
    pagoRegFis        (opcional, no usado)
  formasDePago (opcional)          ← contenedor que faltaba
    formaPago (1 o más)
  air
  estabRetencion1...
```

Validé esto con `lxml.etree.XMLSchema` (Python) contra el XSD descargado:
el XML real del usuario falla con exactamente
`Element 'pagoLocExt': This element is not expected. Expected is one of
(pagoExterior, formasDePago, air, estabRetencion1, ...)` — en las mismas
51 líneas que reportó DIMM.

**Bonus explicado**: el "warning de doble tributación" que la sesión
anterior dejó "sin investigar" (visible en la captura original, sin texto
exacto) corresponde a `aplicConvDobTrib` — nunca se emitía, porque
`pagoExterior` nunca se construyó correctamente.

## Fix (`backend/routes/ats.js`, commit pendiente de hash en este cierre)

- Nuevas funciones puras `construirPagoExteriorXML(pagoLocExt)` y
  `construirFormasDePagoXML(codigos)` (mismo patrón que
  `tipoIdProveedorAts`, exportadas para test unitario).
- `pagoLocExt` ahora usa `esImportacion` (ya calculado antes en el loop)
  para reportar `02` en compras de importación en vez de `01` fijo
  siempre — mejora real sobre el fix anterior, no solo el bug.
- `aplicConvDobTrib`/`pagExtSujRetNorLeg` se reportan `"NA"` (No Aplica)
  — AELA no registra convenios de doble tributación ni retenciones por
  pago al exterior, y ambos son específicos de pagos AL EXTERIOR.
- `formasDePagoXML` solo se agrega si hay al menos 1 código (el
  contenedor es opcional; antes podía quedar vacío si `pagosArr` no
  tenía formaPago pero el monto superaba $1000 — ahora simplemente se
  omite el bloque, igual de válido).
- Mismo fix aplicado al bloque de notas de crédito recibidas (línea
  ~648), que tenía el mismo `<pagoLocExt>` suelto.

## Verificación

- **Validación completa contra el XSD oficial** (no solo bien-formado):
  instalé `lxml` (Python) y usé `XMLSchema.validate()` — el XML real del
  usuario (con el bug) falla con el error exacto de DIMM; el XML
  regenerado con el fix (datos sintéticos cubriendo compra con retención,
  compra con `formaPago` activado, compra simple) **pasa limpio**.
- 163/163 tests backend (7 en `ats.test.js`, 4 nuevos: estructura de
  `pagoExterior`/`formasDePago`, caso vacío, combinación de ambos
  fragmentos).
- `node --check` limpio.

## Pendiente / salvedad

- **Falta que el usuario regenere el ATS de 2026-09 con este fix y lo
  vuelva a validar con DIMM** — confirmado contra el XSD oficial con
  herramientas externas, pero no contra DIMM mismo (no tengo el programa).
- No se probó un caso de compra de IMPORTACIÓN real (pagoLocExt=02) con
  datos reales del cliente — la lógica se agregó porque el XSD lo permite
  y es lo semánticamente correcto, pero no hay un caso reportado que lo
  confirme en vivo todavía.
- El bloque de NC recibida (notas de crédito de proveedores) se corrigió
  con el mismo fix pero no se verificó con un XML de NC real (requiere
  `nc.xmlAutorizado` parseado, más complejo de reproducir sintéticamente)
  — si el cliente tiene NC recibidas en su período, revisar si aparece
  algún problema ahí puntualmente.
