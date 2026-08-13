# AELA ERP — Sesión 2026-08-12 (continuación) — Error SRI 35 por saltos de línea en nombres de producto importados

## Contexto

El usuario reportó, con captura real: la factura 001-001-000000004
("Comercial S&S", tenant "sys") fue rechazada por el SRI con:

> 35 ARCHIVO NO CUMPLE ESTRUCTURA XML — cvc-pattern-valid: Value 'RUFFLES
> TWIST LIMON 38GX60X1 RM' is not facet-valid with respect to pattern
> '[^\n]*' for type 'descripcion'.

## Causa raíz

El XSD del SRI valida los campos de texto libre (`descripcion`,
`razonSocial`, `direccion`, `motivo`, etc.) contra el patrón `[^\n]*` — no
admite saltos de línea. El nombre del producto en la base de datos real
tenía un salto de línea **embebido**: `"RUFFLES TWIST LIMON\r\n38GX60X1
RM"`. Confirmado contra `aela_sys`: no es un caso aislado, **31 productos**
tenían el mismo problema (RUFFLES, DORITOS, CHEETOS, AMOR WAFERS, LUX,
SEDAL, REXONA, CRISMELO, etc.) — invisible al ojo porque Excel muestra una
celda con "ajuste de texto" (Alt+Enter) como si fuera una sola línea, pero
internamente guarda un salto de línea real. Origen: la plantilla real de
productos que Comercial S&S subió ayer (confirmado en
`docs/pendientes-2026-08-11-parte2.md`).

**Dos capas sin protección para esto**:
1. `mapearFilaProducto()` (`backend/utils/importacionProductos.js`) limpiaba
   el nombre con `limpiarTexto()`, pero esa función solo hacía `.trim()` —
   quita espacios al principio/final, no saltos de línea en medio del texto.
2. `backend/utils/sri.js` insertaba `det.descripcion` (y otros campos de
   texto libre: razón social, dirección, motivo) directo en el XML sin
   sanitizar — cualquier dato sucio que llegara hasta ahí, sin importar el
   origen (importación, POS, proformas, edición manual), iba a producir el
   mismo rechazo.

## Fix

**`backend/utils/importacionProductos.js`** — `limpiarTexto()` ahora
reemplaza `\r`, `\n`, `\t` por un espacio y colapsa espacios múltiples,
además del `.trim()` que ya tenía. Corta el problema en la puerta de
entrada: una futura importación con celdas envueltas ya no va a crear
productos con el nombre roto.

**`backend/utils/sri.js`** — nueva función `t(valor)` (normaliza saltos de
línea/tabs a espacio simple, colapsa, trim) aplicada a **todos** los campos
de texto libre que se insertan en los 6 generadores de XML (factura, nota
de crédito, nota de débito, comprobante de retención, liquidación de
compra, guía de remisión): `descripcion` de detalle, `razonSocial`,
`nombreComercial`, `dirMatriz`, `dirEstablecimiento`, `contribuyenteEspecial`,
`agenteRetencion`, `razonSocialComprador`/`Proveedor`/`SujetoRetenido`,
`direccionComprador`/`Proveedor`, `motivoModificacion`, motivos de nota de
débito, datos de transportista/destinatario y motivo de traslado en guías
de remisión. Esta es la capa de defensa real — protege sin importar de
dónde venga el dato sucio (importación ya corregida, pero también entrada
manual, proformas convertidas a factura, copy-paste con saltos de línea,
etc.), no solo el caso puntual reportado hoy.

## Verificado

- Reproducido el bug real: `generarXMLFactura()` con la descripción exacta
  `'RUFFLES TWIST LIMON\r\n38GX60X1 RM'` — antes del fix el XML quedaba con
  el salto de línea embebido; después, `<descripcion>RUFFLES TWIST LIMON
  38GX60X1 RM</descripcion>` limpio.
- 3 tests nuevos en `backend/test/sri.test.js` (limpia el caso real, no
  altera texto ya limpio, colapsa tabs/espacios múltiples sin perder
  contenido) + 1 test nuevo en `test/importacionProductos.test.js`
  (`mapearFilaProducto` con celda de Excel envuelta).
- `node --test`: 42/42.

## Acción en producción (`aela_sys`)

1. **31 productos corregidos** — se limpiaron los nombres reales en la BD
   (mismo criterio: `\r\n\t` → espacio, colapsar espacios, trim). Ninguno
   quedó con caracteres de control tras la corrección (verificado con un
   `SELECT` posterior, 0 filas).
2. **Factura 001-001-000000004 (id=5, RECHAZADO) anulada** vía el endpoint
   real de producción (mismo procedimiento que ayer con la 002: login real
   + `POST /facturas/5/anular`, no SQL manual) — había descontado inventario
   real de 25 productos al crearse, nunca revertido por estar rechazada sin
   anular. Verificado: 25 movimientos `ANULACION_FACTURA` nuevos (uno por
   cada `VENTA_FACTURA` original), factura `ANULADO`/`anulada:true`.

## Para el usuario

Con el fix desplegado y los 31 productos corregidos, esos productos ya se
pueden facturar normalmente — el stock también quedó restaurado. La próxima
venta de ese pedido saldrá con el siguiente secuencial disponible.

**Nota para otros tenants**: este problema viene de cómo Excel guarda las
celdas con "ajuste de texto" — cualquier tenant que haya importado un
catálogo con celdas así (no solo "sys") puede tener el mismo problema
latente en nombres de producto ya existentes, aunque el fix de
`limpiarTexto()` ya evita que se repita en importaciones nuevas. No se
revisaron otras BDs de tenants para esto — si aparece el mismo error 35 en
otro negocio, el diagnóstico es el mismo y el fix de `sri.js` ya lo cubre
en el momento de facturar (aunque el nombre del producto siga sucio en la
BD, el XML ya sale limpio).
