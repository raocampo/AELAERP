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
