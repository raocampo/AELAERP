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
