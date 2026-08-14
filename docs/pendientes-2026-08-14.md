# AELA ERP — Sesión 2026-08-14 — Contabilidad: naming de descargas, tema oscuro, paginación del mayor y totales del asiento

## Pedido del usuario (4 partes, con capturas y PDFs de ejemplo)

1. El archivo descargado del Libro Mayor general (todas las cuentas) debe
   llamarse `reportemayorgeneral`; el de una cuenta puntual,
   `reportemayor<nombredecuenta>`.
2. Las listas de Contabilidad (Libro Diario, Libro Mayor, etc.) se veían con
   un fondo negro que no tiene el resto del sistema (Compras, Facturación) —
   deben verse todas igual.
3. El PDF del Libro Mayor general no debe separar cada cuenta en una hoja
   nueva — deben fluir con un espacio prudencial entre ellas y saltar de
   página solo cuando no entren.
4. El PDF de un asiento individual tenía el "Total Debe / Total Haber" mal
   formateado (montado sobre el pie de página), "un champús".

## Implementado (commit `e57908d`)

**1. Naming de descargas del Libro Mayor** — nueva `nombreArchivoMayor(mayor)`
en `backend/routes/contabilidad.js`: sin cuenta filtrada devuelve
`reportemayorgeneral`; con cuenta filtrada, `reportemayor<Cuenta>` (nombre de
cuenta sin tildes/espacios/símbolos, ej. `reportemayorCuentasporCobrarClientes`).
Aplica a los 3 formatos (`csv`, `xlsx`, `pdf`) — antes los tres usaban el
genérico `libro_mayor_<fecha>`.

**2. Fondo oscuro de Contabilidad** — causa raíz: `ContabilidadHub.css` tenía
22 bloques `@media (prefers-color-scheme: dark)` que ningún otro CSS de
listados (`ListaCompras.css`, `ListaFacturas.css`) tiene. Con el navegador/SO
en modo oscuro, Contabilidad se oscurecía sola mientras el resto de la app
seguía claro siempre (esos otros CSS no soportan modo oscuro, están fijos en
claro). Se eliminaron los 22 bloques — Contabilidad ahora se ve igual que el
resto del sistema sin importar la preferencia de tema del navegador.

**3. Paginación del mayor general** — antes, `doc.addPage()` se llamaba sin
condición antes de cada cuenta (una cuenta con 1 solo movimiento ya ocupaba
una hoja completa). Ahora se calcula el espacio restante en la página: si el
bloque de la siguiente cuenta (título + saldo + encabezado de tabla + al
menos 1 fila, ~80pt) no entra en lo que queda, recién ahí se agrega página
nueva; si entra, solo se deja un espacio prudencial (`doc.moveDown(1.2)`) y
se sigue en la misma hoja.

**4. Totales DEBE/HABER del asiento** — causa raíz encontrada en la función
compartida `dibujarTablaPdf()`: dibuja cada celda con `doc.text(valor, x, y)`,
y esa llamada deja `doc.x`/`doc.y` donde terminó la ÚLTIMA celda de la ÚLTIMA
fila (dentro de la tabla), no debajo de ella — el `y` final "correcto" se
calculaba en una variable local que nunca se aplicaba a `doc.y`. Por eso todo
lo que se dibujaba después de cualquier tabla del sistema heredaba una
posición incorrecta. Se corrigió sincronizando `doc.x`/`doc.y` al final de
`dibujarTablaPdf()` (beneficia a los 6 sitios que la usan, no solo al
asiento). Además, en el PDF del asiento se agregó una línea separadora y se
alinearon los totales al ancho real de la tabla en vez de heredar `align:
'right'` desde una posición arbitraria.

## Verificado

Contra el tenant local (empresaId=1, Corp Simtelec):
- `node --test`: 42/42 sin regresiones.
- `npm run build` (frontend): sin errores.
- PDFs generados con datos reales y renderizados a PNG (pymupdf) para
  inspección visual: `reportemayorgeneral.pdf` (6 cuentas, todas fluyendo en
  una sola página con espaciado, sin saltos forzados), `reportemayor
  CuentasporCobrarClientes.pdf` (una cuenta), y `asiento_202605-0001.pdf`
  (totales ahora separados con línea y sin superposición con el pie
  "Generado / Elaborado por / Creado").
- Content-Disposition confirmado por `curl` para los 3 formatos (csv/xlsx/pdf)
  × 2 casos (general / una cuenta) = 6 combinaciones, todas con el nombre
  esperado.
- CSS verificado con Playwright emulando `colorScheme: 'light'` y `'dark'`:
  capturas idénticas en ambos casos (antes, en `dark` se habría visto negro) —
  confirma que Contabilidad ya no reacciona a la preferencia de tema del
  sistema, igual que Compras/Facturación.

No quedan pendientes abiertos de la Parte 1 — las 4 partes del pedido están
implementadas y verificadas.

## Parte 2 — mismo día: detalle truncado en PDF, botones y acciones sin estilo

El usuario volvió con 3 capturas nuevas (comprobante de asiento con el
Detalle cortado, tab Libro Mayor con "Procesar mayorización" pegado al
título, tab Estados Financieros con sub-tabs sin estilo) y una lista de 6
observaciones más.

### Pedido del usuario

1. En el PDF de un asiento, el Detalle se corta ("Ingreso de inventario
   por…") — debe mostrarse completo, en varias líneas si hace falta.
2. Los botones "Exportar Excel" y "PDF Servidor" deben estar en la misma
   línea; el nombre "PDF Servidor" debe cambiar; falta un Excel real (no
   CSV) en algún lado.
3. El botón "Procesar Mayorización" está muy pegado — necesita estilo y
   espacio.
4. El botón de imprimir el mayor a PDF debe llamarse "Impresión de mayor"
   o "PDF de mayor", no "PDF Servidor".
5. Los iconos de imprimir/duplicar en la lista de asientos no se entienden
   — deberían ser acciones por ícono como en las listas de facturas.
6. Los botones de sub-tabs de Estados Financieros no tienen estilo del
   sistema y están muy pegados.

### Implementado (commit `11f7fb5`)

**1. Detalle truncado (causa raíz en `dibujarTablaPdf`)** — la función
compartida por los 6 reportes PDF de Contabilidad dibujaba cada fila con
alto **fijo** (16pt) y `ellipsis: true`, cortando cualquier texto que no
cupiera en una línea. Mismo patrón de bug ya documentado para el RIDE de
factura ([[project-ride-pdf-layout-dinamico]]): PDFKit no calcula solo el
alto de una fila con texto largo, hay que medirlo con `doc.heightOfString()`
ANTES de dibujar el `rect()` de fondo. Corregido: alto de fila dinámico
= `Math.max(16, alto medido de la columna más alta)`. Se quitó también el
`.slice(0, 55)` que truncaba a mano el detalle de movimientos en el Libro
Mayor (ya innecesario). Verificado con un script aislado de PDFKit (fuera
de la BD, para no crear asientos de prueba en `empresaId=1`) con un detalle
de 190 caracteres — se envuelve en 7 líneas sin solaparse con las filas
siguientes ni con los totales.

**2-4. Botones renombrados y agrupados** — "PDF Servidor" → "PDF del
Diario" (tab Libro Diario) / "PDF de Mayor" (tab Libro Mayor). El Diario
solo tenía un CSV mal etiquetado "Exportar Excel (CSV)"; nuevo
`GET /contabilidad/reportes/diario?formato=xlsx` (Excel real, mismo patrón
que ya tenía el Mayor: encabezados en negrita, Fecha/Debe/Haber con formato
real). Los 3 botones de exportación (Excel/CSV/PDF) de cada tab se agrupan
ahora en un `.conta-btn-group` (flex propio) para que cuando no quepan en
la línea, se vayan juntos a la siguiente en vez de partirse entre sí.

**3. "Procesar mayorización"** — se agregó un texto de ayuda debajo del
título de la tarjeta (explica qué hace el botón) y más espacio antes de
las tarjetas KPI de abajo; el botón pasó de `btn-secondary` a `btn-primary`
(verde) para que se note que es la acción principal de esa tarjeta.

**5. Acciones de la lista de asientos → iconos** — Ver/Editar/Imprimir/
Duplicar/Cerrar/Bloquear/Desbloquear/Anular pasaron de texto suelto +
emoji a `.btn-icon` con tooltip (`title`), el mismo patrón que ya usa
`ListaFacturas.jsx` (`.tbl-acciones` + `.btn-icon.ic-*`). Se agregaron los
3 iconos SVG que faltaban a `utils/icons.jsx` (compartido, no solo de
Contabilidad): `IcDuplicar` (copiar), `IcCandado`/`IcCandadoAbierto`
(bloquear/desbloquear) — y sus variantes de color en `App.css`
(`.ic-duplicar`, `.ic-cerrar`, `.ic-bloquear`, `.ic-desbloquear`).

**6. Sub-tabs de Estados Financieros** — usaban una clase `conta-subtabs`
(plural) que nunca tuvo CSS definido, así que salían como botones de
navegador sin estilo. Se reemplazó por `.conta-subtab-nav`/`.conta-subtab`,
la misma píldora con subrayado verde que ya usa Libro Diario/Corrección
(se le agregó `flex-wrap: wrap` porque acá son 5 pestañas con nombres
largos en vez de 2).

### Verificado

`node --test`: 42/42. `npm run build`: sin errores. PDF de prueba aislado
(sin tocar la BD) confirmó el ajuste de altura de fila. Excel del Diario
verificado con `openpyxl` (encabezado en negrita, Fecha como fecha real,
Debe/Haber con formato moneda). Capturas con Playwright contra el tenant
local (empresaId=1) de las 3 pantallas reportadas — Libro Diario (iconos +
botones en una línea), Libro Mayor (botones agrupados + Mayorización con
espacio), Estados Financieros (sub-tabs con estilo de píldora).
