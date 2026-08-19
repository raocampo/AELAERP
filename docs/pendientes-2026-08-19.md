# AELA ERP — Sesión 2026-08-19 — Exportar a Excel escribía montos/fechas como texto

# Parte 2 — PDF de apoyo para el Formulario 104 (IVA)

## Pedido del usuario

Compartió tres cosas: la "Guía para el llenado del Formulario IVA" oficial
del SRI (27 páginas, vigente post-reforma abril/2024), el archivo
`FORMULARIO IVA.xlsx` (diseño oficial casillero por casillero, carpeta
`UtilitariosSCFI/Declaraciones/`) y la URL
`https://www.sri.gob.ec/formularios-e-instructivos`. Pidió investigar,
analizar, planear e implementar — esto desbloqueaba el pendiente que
había quedado abierto el 2026-08-16 (generar un PDF real del F104).

## Mapeo de casilleros confirmado

Contra el Excel oficial se confirmó el diseño vigente: la tarifa
diferente de cero (12%/15%) ya NO tiene casilleros separados por tasa —
comparten un solo bloque (ventas 401/411/421, compras 500/510/520). Solo
la tarifa 5% (materiales de construcción, Ley de Bienestar) tiene
casillero propio (425/435/445 ventas, 540/550/560 compras). Los
casilleros 531/532 (No objeto/Exenta de compras) no cambiaron desde el
instructivo de 2017. Mapeo completo (activos fijos, exportaciones,
importaciones, factor de proporcionalidad, resumen impositivo,
retenciones, etc.) documentado en el commit.

## Implementación

- `backend/routes/declaraciones.js`: se extrajo el cálculo del F104 (que
  ya vivía en `GET /f104`) a una función reutilizable `calcularF104()`,
  usada tanto por el endpoint JSON existente como por el nuevo
  `GET /f104/pdf`. De paso se expuso `retencionIvaCompras` (ya se
  calculaba pero nunca se usaba) como `retencionesEmitidas` — es el IVA
  que la empresa retiene a sus proveedores (casillero 799/801).
- `GET /f104/pdf`: genera un PDF (PDFKit, mismo lenguaje visual que
  `contabilidad.js` — encabezado corporativo, tablas con alto de fila
  dinámico) con tres tablas (Ventas, Compras, Liquidación/Resumen) donde
  cada fila muestra el casillero oficial junto al valor que el sistema
  calcula. Incluye un aviso destacado ("documento de apoyo, no reemplaza
  el formulario oficial") y, al final, la lista explícita de casilleros
  que AELA NO puede llenar solo (activos fijos por separado,
  exportaciones, importaciones DIM/DAU, tarifa turística variable,
  factor de proporcionalidad, NC por compensar, desglose de retención
  IVA por %, saldo de crédito tributario por origen) para que el
  contador sepa qué revisar a mano.
- `frontend/src/components/Declaraciones/Declaraciones.jsx`: botón
  "📄 Generar Formulario (PDF)" en el header del F104, descarga vía blob
  (mismo patrón que `imprimirAsiento` en `ContabilidadHub.jsx`).

## Verificado

Contra empresaId=1 local: primero con el único dato real disponible
(mayo/2026, solo ventas), luego con datos `QATEST` insertados a mano
(compra con IVA 0%/5%/15%/No Objeto/Exento + retención de IVA a
proveedor, una liquidación de compra, una retención de IVA recibida de
cliente) para ejercitar todas las ramas — el PDF resultante se renderizó
a PNG con `pymupdf` y se verificó a ojo (y a mano, casillero por
casillero) que la aritmética cierra: 601/602 = 429−529, 620/699 =
máx(0, IVA a pagar), 859/902 = 620+799. Datos de prueba eliminados al
terminar. `node --test`: 49/49. `vite build`: sin errores.

No se probó en un navegador real (no hay herramienta de automatización
de navegador disponible en este entorno) — el botón se verificó por
lectura de código (mismo patrón ya probado en Contabilidad) y build
exitoso, no por clic real. Pendiente de que el usuario lo pruebe en
`Declaraciones → F104 → Generar Formulario (PDF)`.

# Parte 3 — PDF de apoyo para el Formulario 103 (Retenciones en la Fuente)

## Pedido del usuario

Compartió la URL `https://www.sri.gob.ec/formularios-e-instructivos`
("los demás formularios están en esta URL") pidiendo investigar, revisar,
analizar, planear e implementar — continuación directa del pendiente de
F103/F101 dejado abierto el 2026-08-16.

## Investigación

Se descargó de la propia página del SRI (vía `WebFetch` para ubicar los
links reales, luego `curl` directo con User-Agent de navegador — sin UA
el servidor del SRI colgaba la conexión): el Excel oficial del
Formulario 103 (`FORMULARIO RETENCIONES EN LA FUENTE.xls`, con una hoja
por versión histórica — la más reciente, **"Formulario RF desde ago
2026"**, es la vigente) y la "Guía del contribuyente Formulario 103" (19
páginas, resolución NAC-DGERCGC26-00000009 de feb/2026).

**Hallazgo clave**: los códigos que usa `utils/sri.js`
(`CODIGOS_RETENCION_RENTA`) en el XML del comprobante de retención SON,
en su mayoría, casi literalmente los casilleros del formulario en papel
(303, 304, 307, 308, 310, 312, 319, 320, 322, 323, 325, 327, 328, 332,
343, 346, 350...) — confirma lo que la sesión del 08-16 ya sospechaba
("F103 más simple, ya casi listo estructuralmente"). Pero AELA también
tiene códigos más granulares con sufijo de letra (303A, 304A-E, 312A,
312C, 323A-U, 332B-I, 343A-C, 344A-B, 346A-D) que representan categorías
más finas del comprobante electrónico y que el formulario en papel
agrupa bajo un casillero más general — construir el PDF exigía mapear
cada uno de esos ~84 códigos contra su casillero real, no solo los
"planos".

Se hizo ese mapeo cruzando **ambas fuentes oficiales línea por línea**
(no por inferencia) y la guía corrigió dos supuestos iniciales sacados
solo del Excel:
- Código **343A** (Energía eléctrica) es **1%** y cae en el casillero
  **343/393**, no en 344/394 como sugería la redacción agrupada de la
  celda del Excel.
- Códigos **332E/332F** (cooperativas de transporte / compraventa de
  divisas) caen en el casillero **3230** (rendimientos financieros 0%),
  NO en el casillero 332 genérico como el resto de la familia 332B-332I.

Quedaron sin mapeo confirmado (la guía no los menciona de forma
inequívoca): `346` (genérico), `346A`, `346C`. Y se encontró que el
código `3481` está marcado por la propia guía como **vigente solo hasta
junio 2021** — no debería seguir ofreciéndose en comprobantes nuevos
(no se tocó el catálogo, solo se documenta el hallazgo).

## Implementación (mismo patrón que F104)

- `calcularF103()` extraída de `GET /f103` para reutilizar en el PDF.
- `CASILLEROS_F103`: tabla de mapeo código→{casillero base, casillero
  retenido} para los ~64 códigos con mapeo confirmado.
- `GET /f103/pdf`: tabla con cada código del período junto a su
  casillero oficial, fila TOTAL (399/499), aviso de "documento de
  apoyo" y nota al final listando lo no soportado (relación de
  dependencia/nómina, pagos al exterior, IRU banano, pronósticos
  deportivos, los 3 códigos sin mapeo confirmado, código 3481 obsoleto).
  Los códigos sin mapeo se marcan `(!)` en vez del número de casillero
  — **al principio usé el glifo ⚠, que salió como un carácter roto en
  el PDF** (Helvetica/WinAnsiEncoding de PDFKit no lo tiene — el mismo
  bug ya documentado el 2026-08-13 con ✓/⚠ en el balance general).
  Corregido a texto plano `(!)` antes de terminar.
- Botón "Generar Formulario (PDF)" en `F103View` (`Declaraciones.jsx`),
  mismo patrón blob-download que F104.

## Verificado

QATEST con 7 comprobantes cubriendo códigos representativos (303, 304C,
312A, 332E, 343A, 343B, 346C) — PDF renderizado a PNG con `pymupdf`,
confirmado casillero por casillero contra la tabla mapeada a mano, y
que el código sin mapeo (346C) sale marcado `(!)` con su nota al pie.
Total 399/499 = suma exacta de bases/retenidos. Datos de prueba
eliminados al terminar. `node --test`: 49/49. `vite build`: sin errores.

## F101 — solo investigación, sin implementar (a propósito)

Se descargó también el Excel oficial de F101 (Renta Sociedades): **869
filas** — confirma lo ya anotado el 2026-08-16, es un formulario mucho
más grande (balance completo + conciliación tributaria, cientos de
casilleros), un proyecto aparte. No se implementó nada — queda para
cuando el usuario decida abordarlo como su propio proyecto.


## Contexto — sincronización entre equipos

Antes de empezar se hizo `git pull` (1 commit nuevo de la otra máquina,
cerrando el pendiente de las 40 facturas antiguas sin `subtotalNoObjetoIva`
— decisión del usuario: queda en manos de la contadora de cada cliente, sin
acción de código). Mismo patrón de siempre: el checkout local tenía 3
archivos "modificados" que resultaron ser duplicados byte a byte de ese
mismo commit (MEGA sincroniza el archivo en crudo antes del `git pull`) —
descartados sin pérdida.

## Pedido del usuario

Compartió el archivo `compras-2026-08-19.xlsx` descargado desde el sistema
(carpeta `UtilitariosSCFI/compras/`): "no se puede trabajar en este
archivo ya que se descarga todo en tipo texto" — pidió que el Excel
descargado permita trabajar en él (sumar, ordenar, usar en fórmulas).

## Causa raíz

`GET /compras/exportar/xlsx` (y, se encontró al auditar el resto del
sistema con el mismo patrón, 4 rutas más) usaban `xlsx` (SheetJS
community) con `XLSX.utils.aoa_to_sheet()`, alimentado con un array de
arrays donde los montos y fechas ya venían **pre-formateados a string**
(`fmtNum` → `.toFixed(2)`, `fmtDate` → `.toLocaleDateString()`) antes de
pasarlos a la hoja. `aoa_to_sheet()` infiere el tipo de celda del valor JS
recibido — un string sale siempre como celda de texto en Excel, aunque
"se vea" como un número (alineado a la izquierda, no se puede sumar con
`=SUMA()`, no ordena numéricamente). Exactamente el mismo motivo por el
que el Libro Mayor de Contabilidad se migró a `exceljs` en una sesión
anterior (ver `docs/pendientes-2026-08-13.md`) — ese cambio nunca se
replicó al resto de los exportadores del sistema.

## Fix (commit `e7c5dc5`)

Migradas a `exceljs` (ya es dependencia del proyecto, usado en
`contabilidad.js`) las 5 rutas `/exportar/xlsx` que tenían el problema —
escriben números y objetos `Date` reales, con su propio `numFmt` (moneda
`"$"#,##0.00` / fecha `dd/mm/yyyy`):

1. `GET /compras/exportar/xlsx` — el que reportó el usuario.
2. `GET /facturas/exportar/xlsx` (Ventas) — mismo bug exacto, encontrado
   al buscar el patrón en el resto del código.
3. `GET /facturas/notas-credito/exportar/xlsx`
4. `GET /retenciones/exportar/xlsx`
5. `GET /retenciones-recibidas/exportar/xlsx`

**No se tocó** `GET /compras/exportar/csv` (el CSV plano no tiene este
problema — Excel autodetecta números al abrirlo, no hay metadata de tipo
de celda que lo fuerce a texto) ni la plantilla de
`GET /cxc/cobros/importar/plantilla` (ya usaba números literales JS
reales en el `aoa_to_sheet`, no pre-formateados a string — revisada y
confirmada sin problema).

## Verificado

Contra el tenant local (empresaId=1) con datos de prueba insertados
directamente (prefijo `QATEST`, eliminados al terminar): se descargó cada
uno de los 5 archivos vía HTTP real y se inspeccionó con `openpyxl`
(librería independiente de la que generó el archivo) — confirmado que
cada columna de monto es ahora `int`/`float` con formato `"$"#,##0.00` y
cada columna de fecha es un objeto `datetime` con formato `dd/mm/yyyy`
(antes: `str` en las 5, sin excepción). `node --test`: 49/49.

Sin pendientes abiertos de este tema.

# Parte 4 — F104 refinado con declaración real + checkbox ATS + crédito 605/606 + gastos

## Pedido del usuario

Cuatro pedidos en un solo mensaje, además de compartir el PDF de una
declaración F104 REAL descargada del portal del SRI (con número de
serial y fecha de recaudación) y, después, capturas de pantalla del
formulario F104 cargado con datos en el sistema "SOFIA WEB 2" (una
plataforma contable de terceros, no el SRI, pero que replica el
formulario oficial con el mismo layout):

1. En el ATS, agregar un checkbox para excluir compras a cédula que el
   contador YA revisó y NO aprobó (distinto de las que aún no revisó) —
   ejemplo del usuario: de 11 facturas a cédula, la contadora aprobó 5,
   el sistema debe avisar que hay 6 para excluir con un check.
2. Replicar el formato exacto del PDF de declaración del SRI para el
   reporte del F104.
3. Separar el crédito tributario arrastrado en 2 casilleros (605
   adquisiciones / 606 retenciones) en vez de un solo valor combinado.
4. Simplificar la clasificación de gastos personales a 3 categorías
   (personales/profesionales/otros deducibles).

## 1. ATS — checkbox de exclusión de cédula no aprobada

`whereComprasAts()` (`routes/ats.js`) ahora acepta un segundo parámetro
opcional `excluirCedulaNoAprobada` — por defecto `false` (comportamiento
idéntico al de siempre, reporta TODO, sin repetir el error revertido el
2026-08-18). Cuando el contador marca el checkbox, aplica el mismo `OR`
de `condicionComprasDeducibles()` que ya usa F104 (no una regla nueva).
Nuevo conteo `cedulaNoAprobada` en `/preview` (siempre calculado,
esté o no marcado el checkbox) para que el contador vea cuántas hay
antes de decidir. Aplicado también a `/exportar` (XML) y
`/exportar/pdf` (talón resumen).

**Bug encontrado y corregido en la propia verificación**: la primera
implementación usaba `NOT: { OR: condicionComprasDeducibles() }` como
filtro de exclusión — lógicamente invertido: eso SELECCIONA las que no
pasan ninguna condición (justo las que había que excluir), en vez de
excluirlas. Se detectó de inmediato al probar con datos reales (11
compras: 6 sin aprobar + 5 aprobadas) — con el checkbox activado
quedaban 6 en vez de 5. Corregido a `where.OR = condicionComprasDeducibles()`
(mismo patrón ya usado en declaraciones.js), verificado de nuevo: 11 sin
marcar, 5 con el checkbox activado.

## 2. F104 PDF — replicado contra la declaración real

Con el PDF real del SRI (RUC 1103568240001, julio 2026) se verificaron
campo por campo las fórmulas de la sección "RESUMEN IMPOSITIVO" (601-620)
y se confirmó que el factor de proporcionalidad (563) es **1.0000** por
defecto cuando no hay ventas mixtas gravadas/exentas (antes se excluía
todo ese bloque del PDF por prudencia) — ahora se incluye (563/564/565).

## 3. Crédito tributario — 605/606 separados (antes: 1 solo campo)

Confirmado con la declaración real: 605 (saldo por adquisiciones) y 606
(saldo por retenciones de IVA) son casilleros independientes, cada uno
arrastra su propio 615/617 del período anterior — **no se suman**.
Nuevo esquema: `declaraciones_credito_iva.creditoPorAdquisiciones` +
`.creditoPorRetenciones` (columnas nuevas, agregadas también a
`applySchemaFixes.js`; el campo viejo `creditoTributarioAnterior` se
mantiene sincronizado como la suma, por si algo viejo todavía lo lee).
`PUT /f104/credito-anterior` acepta ambos valores por separado.
`Declaraciones.jsx` ahora tiene 2 inputs en vez de 1.

**Algoritmo de consumo verificado exacto contra la declaración real**
(605=0, 606=1487.68, 609=62.07, 601=163.89 → esperado 617=1385.86,
620=0.00): el crédito disponible se agrupa en 2 orígenes — "adquisiciones"
(605 arrastrado + 602 generado este mismo período si lo hay) y
"retenciones" (606 arrastrado + 609 de este período) — y se consume
secuencialmente contra el 601 en ese orden (adquisiciones primero,
retenciones después), dejando el remanente de cada origen en 615/617
para el próximo mes. Reproducido exacto con datos QATEST usando los
mismos montos de la declaración real (mismas facturas 15%: ventas
1387.43/compras 294.80, mismo 606=1487.68, mismo 609=62.07) — 601, 617,
620 y 859 salieron exactos a los del PDF real.

También se agregó el desglose de "Agente de retención del IVA" (IVA que
la empresa retiene a SUS proveedores, casilleros 721-731 por tramo de
10/20/30/50/70/100%) — antes solo se sumaba `facturas_compra.retencionIVA`
como un bloque; ahora se lee directo de la tabla `retenciones` (mismo
patrón que ya usa el detalle de retenciones recibidas) para poder
desglosar por porcentaje real.

**Bug de glifo roto encontrado DOS VECES la misma tarde** (ver memoria
`feedback_pdfkit_unicode_glyphs.md`, actualizada): primero ⚠ en el PDF
del F103 (sesión de la mañana), después → en una nota nueva del PDF del
F104 — mismo bug documentado horas antes, repetido por no revisarlo
antes de escribir texto nuevo. Ambos corregidos a texto plano.

## 4. Clasificación de gastos personales simplificada

Se aclaró con el usuario (2 preguntas, había 2 campos distintos y
parcialmente redundantes: `tipoGasto`, 9 opciones siempre visible, y
`categoriaGastoPersonal`, 5 opciones solo bajo el checkbox "Es gasto
personal") — el pedido era sobre `categoriaGastoPersonal` únicamente,
sin tocar `tipoGasto` ni la lógica de exclusión del F104 (que depende
solo de `esGastoPersonal`, no de esta categoría). Sus 5 opciones
(alimentación/salud/vivienda/vestimenta/educación, pensadas para los
rubros de deducción personal del F101) se reemplazaron por 3: personales
/ profesionales / otros deducibles, en `FormCompra.jsx` y
`DetalleCompra.jsx`. Sin datos existentes que migrar (campo de texto
libre, sin registros locales con los valores viejos).

## Verificado

`node --test`: 49/49 en todo momento. `vite build`: sin errores. F104
verificado dato por dato contra la declaración real del usuario
(601=163.89, 605=0, 606=1487.68, 609=62.07, 615=0, 617=1385.86,
620=0.00, 799/801=10.00 con datos de retención sintéticos, 859=10.00 —
todos exactos). ATS checkbox verificado con 11 compras sintéticas (6
sin aprobar + 5 aprobadas), confirmado 11→5 al activar el checkbox.
Todos los datos QATEST eliminados al terminar.

## Pendiente para retomar

No se probó nada de esto en un navegador real (sin herramienta de
automatización disponible en este entorno) — verificado solo por HTTP
directo + PDF renderizado a PNG + lectura de código. Sugerir al usuario
una pasada por Declaraciones (F104, los 2 inputs de crédito) y ATS (el
nuevo checkbox) antes de darlo por cerrado del todo.
