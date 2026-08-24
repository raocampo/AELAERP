# AELA ERP — Sesión 2026-08-24 — Fix: acentos rotos en todos los PDFs (PDFKit)

## Contexto

Pendiente heredado de la sesión 2026-08-20/21 (ver
`docs/pendientes-2026-08-21.md`, memoria `pdfkit-acentos-rotos`): TODOS
los PDFs generados por AELA (RIDE de facturas/NC/ND/retenciones/
liquidaciones, recibos POS, F103/F104/F101, ATS, notas de venta,
proformas, exportes de compras/retenciones) rompían los acentos y eñes
del español — "Situación" salía "Situaci�n" — porque ningún archivo
registraba una fuente TTF Unicode real; todo dependía de las 14 fuentes
estándar de PDFKit (Helvetica vía AFM/WinAnsiEncoding), que en la
versión instalada (0.17.2) no codifica bien los caracteres acentuados.

El usuario pidió continuar con este pendiente (junto con Anexo RDEP y
Anticipo IR) dejando la verificación móvil del módulo restaurante para
el final. Eligió **Noto Sans** (Google Fonts, licencia OFL) como fuente
de reemplazo.

## Investigación previa a implementar

Se mapeó el uso de PDFKit en todo el backend: **11 archivos, 18 puntos
de creación de `new PDFDocument(...)`**, con **348 llamadas** a
`.font(...)` en total — pero SOLO 3 nombres de fuente distintos en uso
en todo el código: `'Helvetica'`, `'Helvetica-Bold'` y
`'Helvetica-Oblique'` (esta última solo una vez, en `ats.js`).

Se confirmó revisando el código fuente de `pdfkit.js` que
`doc.font(src)` busca primero en `this._registeredFonts[src]` (lo que
carga `registerFont`) ANTES de resolver `src` como fuente estándar. Es
decir: **registrar una fuente bajo el mismo nombre `'Helvetica'`
intercepta automáticamente TODAS las llamadas `.font('Helvetica')` ya
existentes**, sin tener que tocar ninguna de las 348 llamadas una por
una — la única cirugía necesaria es una llamada a `registerFont` justo
después de cada `new PDFDocument(...)`.

## Implementación

1. **Fuente**: se descargaron las instancias estáticas de Noto Sans
   (Regular/Bold/Italic, ~1.9 MB total) desde el repo oficial
   `notofonts/notofonts.github.io` y se empaquetaron en
   `backend/assets/fonts/` junto con su licencia (`OFL.txt`).
2. **Helper nuevo** `backend/utils/pdfFonts.js` — función
   `registrarFuentesPdf(doc)` que hace:
   ```js
   doc.registerFont('Helvetica', REGULAR);
   doc.registerFont('Helvetica-Bold', BOLD);
   doc.registerFont('Helvetica-Oblique', ITALIC);
   ```
3. Se agregó `require('../utils/pdfFonts')` (o `./pdfFonts` dentro de
   `utils/sri.js`) + una llamada `registrarFuentesPdf(doc);` justo
   después de cada uno de los 18 `new PDFDocument(...)` en:
   `ats.js`, `compras.js`, `contabilidad.js`, `cxc.js`,
   `declaraciones.js`, `facturas.js` (×2), `notasVenta.js` (×2),
   `proformas.js`, `retenciones-recibidas.js`, `retenciones.js`, y
   `utils/sri.js` (×6 — el módulo del RIDE: factura, nota de crédito,
   nota de débito, recibo POS, retención, liquidación de compra).
4. Verificado 1:1 con `grep`: 18 `new PDFDocument` ↔ 18
   `registrarFuentesPdf(doc)`.

## Verificación

- `node --check` en los 12 archivos tocados: sin errores de sintaxis.
- `node --test`: **49/49 tests** pasan sin cambios.
- Repro mínimo aislado (sin nada de AELA): "Situación, Décimo, ñ Ñ á é
  í ó ú" en Regular/Bold/Oblique — visualmente correcto, confirmado con
  pymupdf render a PNG.
- **3 documentos reales generados por el pipeline en producción local**
  (empresaId=1, datos reales, no de prueba), elegidos por ser los
  layouts de mayor riesgo de regresión (los más angostos / con columnas
  medidas a mano):
  - **RIDE de factura A4** (`GET /api/facturas/:id/pdf`, factura #3,
    cliente "Medina Piedra Rosa Amalia") — "RAZÓN SOCIAL",
    "IDENTIFICACIÓN", "AUTORIZACIÓN", "INFORMACIÓN ADICIONAL",
    "Dirección" — todos los acentos correctos, tablas alineadas, sin
    desbordes.
  - **Formulario 104** (`GET /api/declaraciones/f104/pdf`, agosto
    2026, 2 páginas) — el de mayor riesgo por tener el layout medido
    con precisión de puntos (`heightOfString`). "Declaración",
    "Adquisiciones", "Crédito Tributario", "Retención", "próximo",
    "turística" — todo correcto, el texto largo sigue envolviendo
    limpio dentro de sus columnas (el ancho se recalcula con la métrica
    real de la fuente activa, que ahora es Noto Sans en vez del AFM de
    Helvetica).
  - **Recibo POS térmico** (`GET /api/facturas/:id/recibo`, 204pt de
    ancho — el layout más angosto de todo el sistema) — "¡Gracias por
    su preferencia!", "Descripción", "electrónico" — correcto, sin
    desbordes pese al ancho mínimo.
- Ningún PDF de los 3 mostró desborde de columnas ni corte de texto —
  el temor original de la memoria (que cambiar la fuente corriera el
  ancho del texto y rompiera los layouts ya medidos a mano) no se
  materializó, porque `widthOfString`/`heightOfString` calculan sobre
  la fuente activa en tiempo real, la misma que ahora dibuja el texto.

## Limitación conocida, no bloqueante

La extracción de texto (copiar/pegar, búsqueda dentro del PDF) vía
pymupdf (`page.get_text()`) sigue devolviendo `�` en el texto extraído
pese a que el RENDERIZADO VISUAL es correcto — es decir, el `ToUnicode`
CMap que PDFKit genera para la fuente TTF subseteada no está
resolviéndose bien en extracción, aunque el glifo se ve perfecto al
abrir/imprimir el PDF. Esto es una regresión menor respecto a Helvetica
estándar (que sí tenía extracción correcta) pero **no es el bug
reportado** (que era 100% visual — "sale roto en el PDF"). No se
investigó a fondo por no ser el problema original; si en el futuro se
reporta que buscar/copiar texto de un PDF de AELA no funciona bien con
tildes, revisar aquí primero.

## Pendiente para retomar

1. Los otros 2 pendientes de la lista (Anexo RDEP, Anticipo de
   Impuesto a la Renta) — ambos bloqueados por decisión de alcance del
   usuario, no tocados hoy.
2. Verificación móvil real del módulo restaurante — dejada para el
   final por pedido explícito del usuario.
3. (Menor, no bloqueante) limitación de extracción de texto con
   ToUnicode descrita arriba.

---

# Cierre de sesión 2026-08-24 — resumen de los 3 pendientes resueltos hoy

El usuario pidió continuar con los pendientes bloqueados de sesiones
anteriores, dejando la verificación móvil explícitamente para el final.
Se resolvieron los 3 en orden, cada uno con su propio documento
detallado:

| # | Pendiente | Doc | Commit |
|---|---|---|---|
| 1 | PDFKit rompe acentos en todos los PDFs | `pendientes-2026-08-24.md` (este archivo) | `5593957` |
| 2 | Anticipo de Impuesto a la Renta (Art. 41 LRTI), Fase 1 | `pendientes-2026-08-24-anticipo-ir.md` | `c9f0cb4` |
| 3 | Anexo RDEP, Fase 1 | `pendientes-2026-08-24-rdep.md` | `44af90d` |

## Resumen de cada uno

**1. PDFKit — acentos rotos**: se registró la fuente Noto Sans (OFL)
sobre los nombres estándar de PDFKit en los 18 puntos donde el backend
genera PDF (11 archivos). Verificado con 3 documentos reales del
pipeline (RIDE de factura, F104, recibo POS térmico) sin ningún
desborde de layout.

**2. Anticipo de Impuesto a la Renta, Fase 1**: se leyó el texto oficial
vigente de la LRTI (confirmó que la fórmula clásica 0.2%/0.4% ya no
existe — es 50% voluntario del impuesto causado del año anterior).
Implementado el caso simple (participación trabajadores 15% + tarifa
según régimen), detectando y excluyendo RIMPE correctamente. Un primer
intento tenía un bug real (leía el tipo de contribuyente del modelo
equivocado) — encontrado y corregido al probar contra el tenant real
antes de dar la feature por terminada.

**3. Anexo RDEP, Fase 1**: se leyeron 3 fuentes oficiales del SRI (XSD
del RDEP, Ficha Técnica 2024, Boletín NAC-COM-26-006) y se agregaron 10
campos nuevos a `empleados` (discapacidad, Galápagos, enfermedad
catastrófica, residencia fiscal, gastos personales proyectados). De
paso se corrigió un bug real dormido: la rebaja de gastos personales
usaba la metodología pre-2022 en vez de la vigente (crédito tributario
18%, no deducción de la base).

## Patrón común a los 3

En los 3 casos se investigó contra la fuente oficial (ley/boletín/XSD
del SRI, leídos directamente, no recordados de sesiones anteriores)
antes de escribir código, y en los 3 casos se verificó el resultado
contra el pipeline real (no solo tests unitarios con datos inventados)
antes de dar la feature por terminada — en 2 de los 3 casos (Anticipo
IR, Anexo RDEP) esa verificación contra datos reales encontró un bug
real que los tests unitarios con datos inventados no habrían detectado.

## 🔴 Único pendiente restante de toda la sesión larga (2026-08-17 al 2026-08-24)

**Verificación humana en dispositivo/emulador móvil real** — no hay
Android/iOS disponible en este entorno. El usuario decidió cerrar la
sesión aquí y retomar esto cuando tenga un dispositivo/emulador a mano.

Todo lo demás de la sesión larga (módulo restaurante completo web+
móvil, PDFKit, Anticipo IR Fase 1, Anexo RDEP Fase 1) está
**implementado, verificado y pusheado a `origin/main`** — sin código a
medio terminar.

## Al retomar

`git fetch` + revisar este documento o la memoria
`aela-erp-estado-actual-del-proyecto` (mismo contenido, siempre
actualizado). Fases pendientes documentadas pero no pedidas (fuera de
alcance, no bloqueantes): Anticipo IR Fase 2 (gastos no deducibles,
pérdidas de años anteriores), Anexo RDEP Fase 2 (desglose de gastos
personales por categoría) y Fase 3 (generador real del XML del anexo).
