# AELA ERP — Sesión 2026-08-13 — Contabilidad: imprimir/duplicar asientos, mayor general, balance con firmas

## Pedido del usuario (4 partes)

1. Poder imprimir un asiento contable con todos sus datos.
2. Poder copiar/duplicar un asiento para editarlo y guardarlo como uno
   nuevo (asientos repetitivos).
3. Que el Libro Mayor general se imprima con el mismo nivel de detalle que
   el libro mayor de una cuenta puntual.
4. Verificar que el Balance no muestre una cuenta duplicada, y que termine
   con firma de Gerente y Contador.

## Implementado (commit `4a851b4`)

**1. Imprimir asiento (PDF)** — nuevo `GET /contabilidad/asientos/:id/pdf`:
cabecera completa (fecha, tipo, referencia, descripción, estado
abierto/cerrado/bloqueado), tabla de detalle (cuenta, centro de costo,
descripción, debe, haber) y totales. Botón `🖨` en el listado de asientos
y dentro del modal de ver/editar.

**2. Duplicar asiento** — `duplicarAsiento()` en el frontend: carga el
asiento como base de uno NUEVO (`id: null`, fecha de hoy), listo para
editar y guardar sin tocar el original. Un asiento automático (FACTURA,
COMPRA, etc.) se duplica como `MANUAL` — el tipo original queda reservado
para asientos que el sistema genera desde su documento fuente. Botón `📋`
en el listado.

**3. Libro Mayor general con detalle completo** — antes, sin filtrar por
cuenta, el PDF solo traía el resumen de mayorización (una fila por cuenta
con totales). Ahora imprime ese resumen y, a continuación, **una página
por cada cuenta con su detalle movimiento por movimiento** — mismo formato
exacto que el reporte de una sola cuenta (se factorizó
`dibujarDetalleMayorCuentaPdf()` para no duplicar el código de la tabla).

**4. Balance General**:
- `obtenerBalanceGeneral()` deduplica por `id` de cuenta antes de calcular
  totales. **Nota honesta**: `plan_cuentas` ya tiene
  `@@unique([empresaId, codigo])` a nivel de base de datos, así que en la
  práctica no debería ser posible que una cuenta aparezca duplicada — no
  se pudo reproducir un caso real. Se agregó igual como salvaguarda barata
  (si el usuario ve una cuenta duplicada en pantalla, mandar captura —
  sería señal de otra causa, no cubierta por este fix).
- Nuevo `GET /contabilidad/reportes/balance-general?formato=csv|pdf`:
  versión detallada e imprimible del Estado de Situación Financiera (no
  existía — el único PDF de balance que había era un resumen de una
  línea, parte de "Estados Financieros"). Termina con líneas de firma para
  **Gerente General** y **Contador**. Botón `📄 Balance General (para
  firmar)` en el tab Estados Financieros.

**Bug encontrado y corregido de paso**: los símbolos `✓`/`⚠` usados en el
balance salían como un glifo roto en el PDF — la fuente base Helvetica de
PDFKit usa `WinAnsiEncoding` y no los tiene (es la única función de todo
`contabilidad.js` que usaba símbolos Unicode dentro de `doc.text()`).
Reemplazados por texto plano ("Balance cuadrado" / "ATENCIÓN: el balance
NO cuadra").

## Verificado

Contra un tenant local aislado (empresaId=1, Corp Simtelec — el único
asiento real preexistente no se tocó): se creó un asiento de prueba
`MANUAL` con 2 líneas, se imprimió, se leyó para simular "duplicar", se
generaron los 4 PDFs (asiento individual, mayor de una cuenta, mayor
general, balance general) y se renderizaron a PNG con `pymupdf` para
revisión visual — cabecera de asiento completa, detalle de mayor idéntico
entre "una cuenta" y "cada cuenta del general", firmas visibles al final
del balance, símbolo de balance cuadrado ya sin el glifo roto. Asiento de
prueba y usuario QA eliminados al terminar. `node --test`: 42/42. `vite
build`: sin errores.

## Para el usuario

- Los 3 primeros puntos (imprimir, duplicar, mayor general) están listos
  para usar tal cual los pediste.
- El punto 4 (duplicado en el balance): no encontré cómo podría estar
  pasando dado que el código de cuenta es único a nivel de base de datos.
  Agregué una protección de todos modos, pero si sigues viendo una cuenta
  repetida en el Balance después de este fix, compárteme una captura — eso
  confirmaría que la causa es otra (por ejemplo, algo distinto a lo que se
  cubrió aquí) y hay que investigarlo puntual.
