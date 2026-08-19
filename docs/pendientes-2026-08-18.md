# AELA ERP — Sesión 2026-08-18 — ATS: Ventas No Objeto/Exenta invisible + compras a cédula sin filtrar

## Contexto — sincronización entre equipos

Antes de empezar se hizo `git pull` (3 commits nuevos de la sesión 2026-08-15/16
en la otra máquina, ver `docs/pendientes-2026-08-15.md` y `-16.md`). El
checkout local tenía 6 archivos "modificados" + 2 docs sin trackear que
resultaron ser duplicados byte a byte de esos mismos commits (la carpeta del
repo vive en MEGA, que sincroniza archivos en crudo entre equipos pero no el
índice de git) — se descartaron sin pérdida. Sigue pendiente sin resolver un
cambio real y trivial en `.env.example` (un `)` de más en una línea comentada
de Railway) de antes del 2026-08-14, sin confirmar con el usuario si fue
intencional.

## Pedido del usuario

Con una captura de la pestaña Compras del ATS: (1) el ATS no muestra las
ventas exentas o no objeto de IVA, (2) el ATS está tomando en cuenta facturas
que llegan facturadas a cédula personal, cuando eso no debería contar hasta
que el contador la acepte para fines tributarios.

## Investigación y causa raíz

**1. Ventas sin columna de No Objeto/Exenta** — el backend (`GET /ats/preview`)
ya seleccionaba `subtotalNoObjetoIva` de `facturas` desde el fix del
2026-08-15, pero `TabVentas` en `ATS.jsx` nunca la mostraba (ni columna en la
tabla ni fila de totales) — el dato llegaba al frontend y se perdía ahí. El
lado de Compras (`TabCompras`) sí la mostraba desde esa misma sesión — la
inconsistencia era solo entre las 2 pestañas.

**2. Compras a cédula personal sin aprobar SÍ se contaban en el ATS** — el
sistema ya tiene, desde julio, una regla fiscal completa para esto:
`backend/utils/comprasFiscal.js` (`condicionComprasDeducibles()`,
`CUTOFF_APROBACION_CEDULA` = 2026-01-01) — una compra facturada a la cédula
personal del dueño (no al RUC de la empresa) no cuenta como deducible salvo
que el contador la revise y marque `aprobadaPorContador`, o sea de antes del
corte (contabilidad atrasada, cuenta automático). El docstring del propio
archivo dice explícitamente "Usado por routes/declaraciones.js (F104, F101)
y routes/facturas.js (reporte tributario)" — **el ATS nunca estuvo en esa
lista**, a pesar de ser el reporte que se sube directo al SRI. Se encontró
de paso el mismo vacío para `esGastoPersonal` (tampoco se excluía en el
ATS, aunque declaraciones.js sí lo hace).

## Fix (commit `e03f3da`)

- `backend/routes/ats.js`: nueva `whereComprasAts()` que envuelve el `where`
  de las 3 consultas de `facturas_compra` (`/preview`, `/exportar`,
  `/exportar/pdf`) con `esGastoPersonal: { not: true }` +
  `OR: condicionComprasDeducibles()` — misma regla compartida que ya usan
  declaraciones.js/facturas.js.
- `/preview` ahora también cuenta `comprasExcluidasCedula` y
  `gastosPersonalesExcluidos` (mismo patrón que declaraciones.js) y los
  expone en la respuesta.
- `frontend/.../ATS.jsx`: nueva columna "No obj./Exenta" en la tabla de
  Facturas emitidas (Ventas) usando `f.subtotalNoObjetoIva`; 2 avisos
  visuales nuevos (arriba de las pestañas, visibles siempre) cuando hay
  compras excluidas por cédula sin aprobar o por gasto personal — mismo
  texto/estilo que ya usa Declaraciones.jsx para el mismo caso.

## Verificado

Contra el tenant local (empresaId=1) con datos de prueba aislados (prefijo
`QATEST`, eliminados al terminar — 4 filas de compra + 1 factura de venta):
- Compra facturada al RUC de la empresa → cuenta normalmente.
- Compra facturada a cédula personal, sin aprobar, fecha reciente (post-corte)
  → excluida del `/preview`, del XML real de `/exportar` (confirmado
  buscando el RUC del proveedor en el XML descargado — no aparece) y del
  PDF; contada en `comprasExcluidasCedula`.
- Compra marcada como gasto personal → excluida igual; contada en
  `gastosPersonalesExcluidos`.
- Compra facturada a cédula sin aprobar pero de ANTES del corte
  (contabilidad atrasada) → SÍ cuenta, sin necesitar aprobación (regla de
  excepción funcionando correctamente).
- Factura de venta con `subtotalNoObjetoIva=$40` → aparece en la nueva
  columna de la tabla de Ventas y en su fila de totales.
- Capturas de pantalla con Playwright (Ventas y Compras) confirmando la
  columna nueva y ambos avisos visibles en pantalla real.
- `node --test`: 44/44. `npm run build`: sin errores.

## Pendiente real — continuación del plan del 2026-08-16

El plan de generar el PDF real de declaración F104/F103/F101 (ver
`docs/pendientes-2026-08-16.md`) sigue bloqueado en el mismo punto: hace
falta que el usuario verifique en vivo, contra "SRI en Línea", los
casilleros de la tarifa 5% (post-reforma 2024) — la única fuente disponible
hasta ahora es el instructivo oficial de 2017, que no cubre esa tarifa. No
es algo que se pueda hacer desde este entorno (requiere las credenciales
reales del usuario en el portal del SRI). Sin ese dato confirmado, no se
debe empezar a construir `GET /declaraciones/f104/pdf`.

**Checklist exacto que se le pasó al usuario (queda pendiente de su lado,
sin fecha — dijo "ya luego reviso eso y te comparto")**: entrar a
`sri.gob.ec` → Servicios en Línea → Formulario 104 (declaración del período
actual o un borrador, no hace falta presentar nada) y confirmar con captura
de pantalla:
1. Sección Ventas: ¿la tarifa 5% tiene casillero propio, separado de 12% y
   15%? Números exactos de los 3.
2. Sección Compras: misma pregunta para 5% vs 12%/15%; confirmar si 531
   (No Objeto) y 532 (Exenta) siguen siendo casilleros separados o
   cambiaron de número.
3. Casillero 429 (impuesto generado): ¿sigue siendo uno solo o ahora se
   suma por tarifa antes de totalizar?

Con capturas de esas 2 secciones (Ventas y Compras) alcanza — el mapeo a
`subtotal5`/`subtotal12`/`subtotal15`/`subtotalNoObjeto`/`subtotalExento`/
`subtotalNoObjetoIva` (campos que el sistema ya calcula) se hace desde acá.

## Nota — `.env.example`

Sigue sin resolver desde antes del 2026-08-14: un cambio local real (un `)`
de más al final de una línea comentada de `DATABASE_URL` de Railway). No se
tocó. Confirmar con el usuario si fue intencional o revertir con
`git checkout -- .env.example`.

## Siguiente — nuevo reporte del usuario: "el ATS no cuadra" (sin detalle aún)

Al cierre de esta sesión el usuario avisó que va a revisar el checklist de
casilleros del SRI **por su cuenta, sin fecha definida** ("ya luego reviso
eso y te comparto") — no es un bloqueo de esta sesión, queda en su cancha.

Además adelantó que el **siguiente tema a retomar es el ATS: dijo
literalmente "no cuadra"**, y va a compartir un resumen con el detalle
concreto. **Sin información todavía** de qué específicamente no cuadra (¿un
total? ¿el XML vs lo que la contadora esperaba? ¿una comparación contra otro
reporte?) — no se investigó nada todavía, a propósito, hasta tener ese
resumen. Podría o no estar relacionado con los 2 fixes de ATS de hoy mismo
(commit `e03f3da`) — no asumir que es continuación de lo mismo sin
confirmarlo primero.

## Continuación mismo día — "no cuadra" SÍ era el fix de hoy mismo: se revierte parcialmente

El resumen prometido llegó el mismo día: `Reporte_Facturas (1).xlsx` en
`UtilitariosSCFI/ATS/`, un reporte independiente (no generado por AELA) de
las 91 compras de julio 2026 de un tenant real ("CONTAMATIC EVOLUCIONA"),
clasificadas por tipo de identificación del comprador (76 a RUC, 15 a
cédula personal) con desglose de IVA 0/5/15%, No Objeto y Exento.

**Análisis**: el reporte es matemáticamente consistente por dentro (0
descuadres en 91 filas) y coincide exacto con la suma de sus propias filas
crudas — no hay bug en el reporte. El "no cuadra" real: con el fix de esta
misma mañana (`e03f3da`), las 15 compras a cédula (proveedores reales:
EERSSA luz, CONECEL teléfono, Banco del Pacífico, Seguros del Pichincha,
Municipio de Loja, Corporación Favorita, etc. — gastos de negocio
legítimos, no personales) quedaban excluidas del ATS al no estar
`aprobadaPorContador`. Eso hacía caer el total de compras de $3,565.63 a
$2,460.61 y ponía en $0 el "No Objeto"/"Exento" de compras (el 100% de esas
2 categorías en julio venía justo de esas 15 facturas a cédula).

**Causa raíz del error de ayer**: el ATS es un reporte **transaccional**
— informa al SRI qué compras existieron, para que el SRI cruce contra lo
que cada proveedor declaró vender. El F104/F101 son distintos: determinan
si una compra da derecho a **crédito tributario/deducción**. La regla de
"necesita aprobación del contador" (`comprasFiscal.js`,
`condicionComprasDeducibles()`) se diseñó originalmente en julio
específicamente para F104/F101 (su propio comentario en el código lo decía
explícitamente) — al extenderla también al ATS el 2026-08-18 por la mañana
(a pedido explícito del usuario, pero sin haber caído en esta distinción
todavía), el ATS pasó a **sub-reportar** transacciones reales al SRI, un
riesgo de cumplimiento mayor que el problema que se intentaba resolver.

**Decisión del usuario** (confirmada explícitamente, ver conversación): el
ATS debe volver a reportar TODAS las compras (RUC y cédula), igual que
antes del fix de la mañana — la regla de aprobación del contador se queda
exclusivamente en F104/F101, donde sí corresponde.

**Fix (mismo commit del día, revierte parte de `e03f3da`)**:
- `whereComprasAts()` en `ats.js` ya no aplica `condicionComprasDeducibles()`
  — solo sigue excluyendo `esGastoPersonal` (eso sí se mantiene: un gasto
  marcado explícitamente como no-de-negocio no es una transacción comercial
  de la empresa, no corresponde reportarlo en su anexo transaccional, y no
  fue parte de la duda planteada).
- Se quitó `comprasExcluidasCedula` de la respuesta de `/preview` y su
  aviso en `ATS.jsx` (ya no aplica). El aviso de `gastosPersonalesExcluidos`
  se mantiene.

**Verificado**: mismos 3 casos de prueba de esta mañana (prefijo `QATEST`,
eliminados al terminar) — compra a RUC cuenta, compra a cédula sin aprobar
**ahora también cuenta** (revertido), compra de gasto personal sigue
excluida. `node --test`: 44/44. `vite build`: sin errores.

## Continuación misma tarde — el "No Objeto"/"Exento" de Compras seguía en $0 incluso después del revert

El usuario compartió el Talón Resumen PDF real (tenant "Puchaicela Abendaño
Daniel Ramiro", período 07-2026) y una captura de la pantalla en vivo:
ambos mostraban "No Obj." en $0.00 en Compras (y el PDF ni siquiera tiene
columna "Exento" — la combina con "No Obj." por espacio), a pesar del
revert de arriba y de que el Excel de ayer confirmaba $21.60/$2.84 reales
en julio.

**Causa raíz real — NO estaba en `ats.js`, sino en el parser de XML de
compras** (`backend/utils/importacionProductos.js`,
`parsearFacturaCompraDesdeXml`, usado por `utils/buzon.js` al importar del
Buzón SRI): tenía su propia tabla de `codigoPorcentaje` — **incorrecta y
contradictoria con la ya verificada en `utils/sri.js`** (código `'4'` lo
trataba como "No objeto" cuando en realidad es **15%** según la tabla 17 de
la ficha técnica SRI v2.26; no tenía ningún código para "Exento" en
absoluto; "5%(bienes)"/"15%(servicios)" en códigos que no corresponden a
ningún IVA real). Además, el cálculo de `totales` solo tenía 2 baldes
(`subtotal0`/`subtotal15`) — **cualquier detalle a 5%, 12%, No Objeto o
Exento de una compra importada por XML quedaba mal clasificado**, sin
excepción, desde que existe esta función. `utils/buzon.js` tampoco ayudaba:
al crear la compra solo pasaba `subtotal0`/`subtotal5`/`subtotal15` al
`create()` — nunca `subtotal12`/`subtotalNoObjeto`/`subtotalExento`,
quedando siempre en su default de esquema (0) pasara lo que pasara en el
parser.

Confirmado que el patrón CORRECTO ya existía en 2 lugares del sistema
(`routes/compras.js`, importación manual por Excel y creación con detalle,
líneas ~1027-1039 y ~1195-1215) — el bug era exclusivo del camino de
importación por XML/Buzón SRI.

**Fix**:
- `importacionProductos.js`: `extraerTarifaIvaDetalle()` reescrita con la
  tabla de códigos real (reutilizando el mismo catálogo ya verificado en
  `sri.js` — 0%→'0', 5%→'5', 12%→'2', 15%→'4', No Objeto→'6', Exento→'7',
  más los códigos históricos '1'/'3' para XMLs antiguos), devolviendo los
  mismos sentinels numéricos 6/7 que ya usa el resto del sistema (ej.
  `productos_servicios.tarifaIva`). El cálculo de `totales` en
  `parsearFacturaCompraDesdeXml()` ahora separa las 6 categorías completas
  (mismo criterio que ya usaba `routes/compras.js`), y ya no calcula un IVA
  falso para detalles No Objeto/Exento (antes `porcentajeIva > 0` disparaba
  `subtotal * (6/100)` o `*(7/100)` por accidente, tratando el sentinel
  como si fuera un % real).
- `buzon.js`: el `create()` de la compra ahora sí pasa
  `subtotal12`/`subtotalNoObjeto`/`subtotalExento` (antes solo
  `subtotal0`/`subtotal5`/`subtotal15`).
- 3 tests nuevos en `test/importacionProductos.test.js` con XML sintético
  cubriendo código '4' (debe ser 15%, no "No objeto"), códigos '6'/'7'
  (deben separarse en `subtotalNoObjeto`/`subtotalExento`, sin generar IVA
  falso) y códigos '5'/'2' (deben ir a `subtotal5`/`subtotal12`, no
  colapsarse en `subtotal15`). `node --test`: 47/47.
- Verificado extremo a extremo contra el tenant local: se insertó una
  compra sintética con los 6 campos ya bien poblados (simulando el output
  del parser corregido) y se confirmó que tanto `/preview` como el PDF real
  del Talón Resumen (`/exportar/pdf`) ya muestran "No Obj." correctamente
  (`24.44` = No Objeto + Exento combinados, tal como el PDF ya documentaba
  que hace a propósito por espacio de columna) — la lógica de agregación de
  `ats.js` para Compras YA estaba bien escrita desde antes, el dato
  simplemente nunca le llegaba bien desde el parser.

**⚠️ Este fix solo previene el problema en importaciones NUEVAS del Buzón
SRI — NO corrige retroactivamente las compras históricas ya mal
importadas.** Nuevo script de diagnóstico/corrección (solo lectura por
defecto): `backend/scripts/corregirComprasNoObjetoExentoBuzon.js` —
re-parsea el `xmlOrigen` ya guardado de cada compra `BUZON_SRI` con el
parser corregido y compara contra lo que hay en la fila (mismo patrón que
`corregirCorteIva15Abril2024.js`: diagnóstico por defecto, `--fix` con
backup previo).

## Continuación misma tarde — conexión a producción, segundo bug encontrado, aplicado

El usuario compartió las credenciales de la BD de Railway en `.env.local`
y autorizó conectarse a producción para correr el diagnóstico. La cadena
del `.env.local` apunta a la BD **`railway`** (principal, sin slug) — el
tenant real "Puchaicela Abendaño Daniel Ramiro" (RUC 1104196546001) no
está ahí, sino en la BD **`aela_lsac`** (mismo servidor Postgres, mismo
usuario/clave, solo cambia el nombre de la BD — confirmado contra
`aela_master.tenants`: slug `lsac` → `dbName: aela_lsac`), empresaId **4**.

**Antes de tocar nada**, el primer diagnóstico contra producción reveló
algo inesperado: 65 compras con diferencia, varias de **febrero 2023**
reclasificando `subtotal12→subtotal15` — sospechoso, porque en 2023 la
tarifa vigente era 12%, no 15%. Se investigó contra el XML real
(`facturas_compra#8`, `007-002-000006320`, 2023-02-01): el XML trae
`<codigoPorcentaje>2</codigoPorcentaje><tarifa>12</tarifa>` explícito —
correcto, 12% real. **Causa: un SEGUNDO bug preexistente**,
`normalizarTarifaIva()` (usada por `extraerTarifaIvaDetalle` para el
campo `<tarifa>` explícito del XML — el que traen los comprobantes reales,
no solo el `codigoPorcentaje` de respaldo) solo reconocía 0%/5%/15% —
cualquier valor entre 6 y 14 (incluido 12% real) se redondeaba hacia
arriba a 15%. Si se hubiera aplicado `--fix` sin detectar esto, se habría
**inflado el IVA de compras históricas reales de 2023-2024** — un daño
nuevo, en dirección opuesta al problema original.

**Fix** (commit `c3b511b`): `normalizarTarifaIva()` reconoce ahora
0/5/12/14/15. Nuevo test con el caso exacto de producción. `node --test`:
48/48. Re-diagnosticado contra `aela_lsac` después del fix: bajó de 65 a
**30 compras** con diferencia real — ya ninguna de 2023-2024 (12%
correcto se queda igual), solo las que genuinamente tienen 5%/12%/No
Objeto/Exento mal clasificados. Se verificó además contra el XML crudo una
muestra de la reclasificación 15%→5% (`facturas_compra#2215`,
`001-100-000028400`, 2025-05-01: XML trae `<codigoPorcentaje>5</codigoPorcentaje><tarifa>5</tarifa>`,
base $1,390.48, IVA $69.52 = exactamente 5% — confirmado). **Ninguna de
las 30 compras cambia `totalIva` ni `importeTotal`** — solo el casillero
fiscal donde se clasifica cada monto (lo que alimenta ATS/F104), no el
monto adeudado al proveedor ni el crédito de IVA total — por lo que no
hace falta regenerar ningún asiento contable ya posteado.

**Aplicado con `--fix`** (confirmación explícita del usuario) contra
`aela_lsac`, empresaId=4 — 30 compras corregidas, backup guardado en
`backend/scripts/_backup_comprasNoObjetoExentoBuzon_4_2026-08-18.json`
— **solo local, no committeado** (`.gitignore` excluye
`backend/scripts/_backup_*.json` a propósito, para no subir datos reales
de clientes al repo; el archivo queda disponible en esta máquina si hace
falta restaurar).

**Verificado con consulta SQL directa post-fix** — julio 2026, empresa 4:
Base 0% $1,581.18, Base 15% $1,704.33, **No Objeto $21.60**, **Exento
$2.84**, IVA pagado $255.62 — **coincide exacto** con el
`Reporte_Facturas (1).xlsx` del usuario del día anterior (base0 RUC
920.69 + Cédula 660.49 = 1581.18 ✓; No Objeto 21.60 ✓; Exento 2.84 ✓). El
viejo "Base 0% $1,605.62" que mostraba la pantalla real era exactamente
1581.18 + 21.60 + 2.84 — el No Objeto/Exento estaba ahí, escondido dentro
de la base 0%, tal como se sospechaba desde el principio.

Sin pendientes abiertos de este tema. Solo queda pendiente correr el mismo
script para OTROS tenants si el usuario quiere confirmar que no tienen el
mismo problema (no se hizo — solo se corrigió el tenant que reportó el
caso concreto).

## Continuación misma tarde — auditoría general de tributación (pedido del usuario)

El usuario pidió revisar que todo lo de tributación funcione de acuerdo al
SRI y resolver lo que se encuentre. Se buscó sistemáticamente el mismo
patrón de bug (confundir `codigoPorcentaje` con otro campo, o clasificar
IVA con una tabla de códigos incompleta) en el resto del sistema.

**Tercer bug encontrado y corregido** (commit `78a1d9e`):
`utils/importarFacturasVentaXML.js` (usado por
`POST /facturas/importar/xml-ejecutar` y el script standalone
`scripts/importarFacturasVentaXML.js`, para clientes con contabilidad
atrasada que ya tienen a mano el XML de sus facturas de venta emitidas)
comparaba `imp.codigo === '6'/'7'` para detectar No Objeto/Exento — pero
`<codigo>` es el TIPO de impuesto (siempre `'2'` para IVA, sea cual sea la
tarifa); la categoría real vive en `<codigoPorcentaje>` (confirmado contra
el propio `generarXMLFactura` de ese mismo archivo, que siempre escribe
`<codigo>2</codigo>` en sus 6 bloques `totalImpuesto`). El check nunca era
cierto — cualquier línea No Objeto/Exento (con `valor=0`) se colaba en
`inferirTarifa(base, 0)=0%` y se mezclaba en silencio con `subtotal0`,
tanto a nivel de cabecera como de cada detalle. Corregido en ambos puntos,
con los mismos sentinels 6/7 del resto del sistema. 1 test nuevo. `node
--test`: 49/49.

**Impacto en producción — limitación real, sin acción posible por ahora**:
se encontraron 40 facturas ya importadas por esta vía en `aela_lsac`
(empresa 1: 3, empresa 4: 35, empresa 5: 2), **todas con
`subtotalNoObjetoIva=0`** — sin forma de saber si es correcto (ninguna
tenía realmente No Objeto/Exento) o si todas sufrieron el bug, porque a
diferencia de `facturas_compra`, el modelo `facturas` **no guarda el XML
original** (`xmlOrigen`) para poder re-parsear y confirmar, como sí se
pudo hacer con las compras. No se tocó ningún dato. Si el usuario todavía
conserva los `.zip`/XML originales que subió, se puede volver a correr
`scripts/importarFacturasVentaXML.js "<carpeta>" <empresaId>` (sin
`--ejecutar`, modo dry-run) para comparar contra lo ya guardado sin
escribir nada — pendiente de que el usuario decida si quiere hacerlo.

**Decisión del usuario**: son facturas antiguas (contabilidad atrasada,
empresas 1/4/5 de `aela_lsac`) — queda en manos de la contadora de cada
cliente revisarlas si hace falta, no se va a re-correr el importador desde
este lado. Cerrado sin acción de código.

**Áreas revisadas sin encontrar problemas** (mismo patrón buscado
explícitamente, no solo lectura superficial):
- `utils/sri.js` — generación de XML de factura/liquidación de compra/nota
  de crédito, y el parser de NC recibida (`parsearNotaCreditoRecibidaXml`)
  — todos usan la tabla de códigos correcta y consistente entre sí (son la
  fuente de verdad contra la que se corrigieron los otros 3 bugs).
- `utils/retenciones.js` / `utils/buzon.js` (`parsearRetencionRecibida`) —
  usan `codigo` para distinguir Renta(1)/IVA(2)/ISD en retenciones, que es
  el campo correcto para ESE catálogo (distinto del de tarifas IVA) — sin
  bug.
- No se encontró ningún otro reductor de totales con solo 2 baldes
  (`subtotal0`/`subtotal15`) en el resto del código.

**Verificación final de consistencia F104 vs ATS** (confirmando que ambos
reportes ahora leen los mismos datos ya corregidos, cada uno aplicando su
propia regla correcta): para julio 2026, empresa 4, el F104 (que sí debe
excluir compras a cédula sin aprobar) da Base0=$920.69, No
Objeto=$0.00, Exento=$0.00 — correcto, porque las 15 compras a cédula de
julio (que son el 100% del No Objeto/Exento de ese mes) siguen
"pendientes de revisión" del contador. El ATS (que si debe reportarlas
todas) sigue dando No Objeto=$21.60/Exento=$2.84. Ambos números son
correctos y consistentes con la regla de cada reporte — no hay
contradicción entre ellos.
