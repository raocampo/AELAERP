# AELA ERP — Sesión 2026-08-16 — Plan: generar los formularios reales de declaración (F104/F103/F101)

## Pedido del usuario

Aclaración sobre el propósito real del módulo Declaraciones: no basta con
mostrar un resumen en pantalla — el objetivo es **generar el formulario**
para que ahí las contadoras llenen/presenten la declaración real ante el
SRI. Pidió investigar, planear (sin implementar todavía) y documentar para
retomar mañana desde la oficina.

## Estado actual (auditado hoy, sin cambios de código)

`backend/routes/declaraciones.js` expone `GET /f104`, `/f103`, `/f101` —
los 3 devuelven JSON con montos ya calculados y agrupados, pero **ninguno
tiene exportación a PDF ni usa la numeración real de casilleros del SRI**.
`frontend/.../Declaraciones.jsx` los muestra con etiquetas humanas ("Ventas
tarifa 15%") en vez de los casilleros oficiales. En la práctica, hoy es un
resumen de referencia interno — no un documento que la contadora pueda usar
directamente para transcribir a "SRI en Línea" ni para archivar como
respaldo de la declaración presentada.

**Contraste con el ATS** (que sí genera un artefacto real): `routes/ats.js`
tiene `/exportar` (el XML real que se sube al SRI) y `/exportar/pdf` (un
"talón resumen" con PDFKit, logo del SRI, diseño tipo comprobante). El F104/
F103/F101 no tienen su equivalente del `/exportar/pdf`. Ese es el patrón a
replicar.

## Investigación — Formulario 104 (IVA mensual)

Se descargó el **instructivo oficial del SRI** para el Formulario 104
(`sri.gob.ec`, "Instructivo Formulario 104", fechado sept-2017) y se extrajo
el texto real con `pdf-parse` (no un resumen de blog — el documento
completo, 20 páginas). Mapa de casilleros confirmado contra la fuente
oficial:

### Ventas
| Casillero | Concepto |
|---|---|
| 401–402 | Ventas locales gravadas tarifa diferente de cero (bruto/neto) |
| 403–404 | Ventas tarifa 0% que **no** dan derecho a crédito tributario |
| 405–406 | Ventas tarifa 0% que **sí** dan derecho a crédito tributario |
| 407 | Exportaciones de bienes |
| 408 | Exportaciones de servicios/derechos |
| **431** | **Transferencias no objeto o exentas de IVA — un solo casillero, combinado** (confirma exactamente lo que se implementó ayer: `facturas.subtotalNoObjetoIva` ya combina ambas a propósito) |
| 442–443 / 453 | Notas de crédito no compensadas, a arrastrar al mes siguiente (base/impuesto) |
| 429 | Impuesto generado (total IVA de ventas) |
| 483–485 | Impuesto a liquidar (arrastre de un mes a otro por ventas a crédito) |

### Compras
| Casillero | Concepto |
|---|---|
| 500–501 | Adquisiciones gravadas tarifa diferente de cero (con derecho a crédito) |
| 502 | Adquisiciones gravadas tarifa diferente de cero SIN derecho a crédito |
| 507 | Adquisiciones tarifa 0% |
| 508 | Adquisiciones a contribuyentes RISE/Negocio Popular |
| **531** | **Adquisiciones No Objeto de IVA** |
| **532** | **Adquisiciones Exentas del Pago de IVA** — confirma que compras SÍ necesita 2 casilleros separados (igual a lo que ya estaba implementado en `facturas_compra.subtotalNoObjeto`/`.subtotalExento`) |
| 526–527 | Ajustes de IVA por notas de crédito con tarifa distinta a la compra original |
| 543–544 / 554 | Notas de crédito recibidas no compensadas, a arrastrar |
| 563–564 | Factor de proporcionalidad + crédito tributario aplicable (ver "Vacío" abajo) |

### Resumen impositivo / valores a pagar
601 (impuesto causado) / 602 (crédito tributario, mutuamente excluyentes) /
605–606 (saldo crédito tributario arrastrado — **el sistema YA pide este
dato al usuario** vía `PUT /f104/credito-anterior`, coincide con el diseño
real) / 609 (retenciones de IVA recibidas — **ya implementado**,
`retenciones_recibidas`) / 615–617 (saldo a arrastrar al próximo mes).

**Caveat importante**: el instructivo fuente es de 2017 — Ecuador tuvo la
reforma tributaria de 2024 (tarifa general 12%→15%, nueva tarifa 5% "Ley de
Bienestar"). Los casilleros estructurales de arriba casi seguro se
mantienen (el SRI típicamente agrega casilleros nuevos en vez de
renumerar), pero **hace falta confirmar los casilleros específicos para la
tarifa 5%** contra el formulario real vigente en "SRI en Línea" antes de
construir nada — ningún blog consultado hoy dio una lista completa y
confiable, y los que dieron números puntuales se contradecían entre sí.

## Vacíos identificados en los datos que ya calcula el sistema

1. **Factor de proporcionalidad (563/564)**: el F104 real exige separar las
   ventas tarifa 0% en dos grupos — las que dan derecho a crédito
   tributario (405–406) y las que no (403–404) — porque el crédito fiscal
   de compras "mixtas" (usadas tanto para ventas gravadas como exentas) se
   prorratea con ese factor. Hoy `subtotal0` es un solo balde sin esa
   distinción; ninguna venta real la necesita todavía (0 casos), pero es
   una pieza real del formulario que falta si se quiere completar un F104
   fiel.
2. **Arrastre de notas de crédito no compensadas (442/443/453 y 543/544/554
   del lado compras)**: el sistema no lleva ese saldo de un mes a otro
   hoy — cada `GET /f104` es independiente por período.
3. **Exportaciones (407/408)** no tienen su propio campo — hoy
   probablemente caerían en `subtotal0` si acaso se dan de alta como venta
   normal.
4. **F103**: ya agrupa por código de retención de renta (`303`, `312`,
   `343A`, etc.), que en la práctica ES la estructura real del formulario —
   más cerca de "listo" que el F104. Falta la exportación a PDF/formulario,
   no se investigó a fondo hoy (tiempo).
5. **F101** (Renta anual, sociedades): revisado su instructivo oficial
   (11 páginas) — es un formulario **mucho más grande** que F104/F103
   (balance completo: activos/pasivos/patrimonio/ingresos con conciliación
   tributaria, cientos de casilleros). Generar un F101 fiel es un proyecto
   aparte, bastante más grande que F104/F103 — no se plane a detalle hoy.

## Plan propuesto (no implementado — para decidir mañana)

1. **Verificar en vivo** los casilleros de la tarifa 5% (post-2024) contra
   el formulario real en "SRI en Línea" antes de escribir cualquier número
   — la fuente de hoy es de 2017 y no cubre esa tarifa.
2. Construir `GET /declaraciones/f104/pdf` (mismo patrón que
   `ats.js` `/exportar/pdf`: PDFKit, logo SRI, diseño tipo formulario) que
   liste cada valor junto a su casillero real, con una nota clara tipo
   "Ayuda para declarar — no reemplaza SRI en Línea, verificar antes de
   presentar" (dado que el sistema no cubre el factor de proporcionalidad
   ni el arrastre de NC no compensadas todavía).
3. Repetir para F103 (más simple, ya casi listo estructuralmente) y — como
   proyecto separado, más grande — F101.
4. Agregar botón "Generar Formulario (PDF)" en `Declaraciones.jsx`, junto a
   los resúmenes ya existentes.

## Nada implementado hoy — solo investigación y este plan

Sin cambios de código. Retomar mañana con el paso 1 (verificar en vivo los
casilleros 2026) antes de tocar el backend.
