# AELA ERP — Sesión 2026-08-19 — Exportar a Excel escribía montos/fechas como texto

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
