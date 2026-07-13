# AELA ERP — Sesión 2026-07-12

## Resumen ejecutivo

Sesión de correcciones sobre módulos ya existentes, disparada por preguntas concretas
del cliente sobre sus declaraciones tributarias reales (F104/F103) y capturas de pantalla
de bugs visuales reproducidos en vivo. A diferencia de sesiones anteriores (features
nuevas), esta fue mayormente **debugging de datos y cálculos reales** — dos de los
hallazgos (retenciones recibidas y F104) eran bugs que llevaban semanas afectando
silenciosamente los números que el cliente usa para declarar al SRI.

Commits de esta sesión (cronológico):
```
0d7c903  fix: retenciones recibidas $0.00 (schema SRI v2.0.0), modal asiento compacto, race condition CxC/CxP
04b8af5  fix: F104 restaba las retenciones equivocadas + documentar módulos nuevos en Ayuda
711aa0e  fix: fechaEmision no se corregía en /recalcular + agregar crédito tributario arrastrado a F104
9598db4  fix: DetalleCompra — reemplazar grid frágil por flexbox en filas de detalle
b0c9145  fix: DetalleCompra — página se ensanchaba más allá de la pantalla
1f1c29c  feat: excluir de declaraciones las compras facturadas a cédula (no a RUC)
71ce673  feat(cxc): recibo de cobro imprimible (PDF)
dc711ff  docs: sesión 2026-07-12 — bug real F104/retenciones recibidas, RUC vs Cédula, responsividad, recibo CxC
5887d40  fix: asiento de compra descuadrado, impresión bloqueada por popup, UX de ListaCompras y filtros contables
```

---

## 1 — Retenciones Recibidas en $0.00 (bug real de parseo, no de UI)

**Síntoma reportado**: la pantalla Tributario → Retenciones recibidas mostraba todos los
comprobantes con Ret. Renta / Ret. IVA / Total en $0.00, a pesar de que el cliente
confirmó que los XML sí traían valores.

**Causa raíz** (`backend/utils/buzon.js`, `parsearRetencionRecibida`): el parser solo
soportaba el schema **v1.0.0** del comprobante de retención SRI (`impuestos.impuesto[]`
plano — el mismo formato que este sistema usa al EMITIR sus propias retenciones, ver
`sri.js`). Los agentes de retención reales usan el schema **v2.0.0**, con las retenciones
anidadas por documento sustento: `docsSustento.docSustento[].retenciones.retencion[]`.
Confirmado con 3 XML reales de producción que el cliente compartió — los tres v2.0.0.

Además, el campo de monto se leía como `<valorRetener>` cuando el tag real del SRI (en
ambos schemas) es `<valorRetenido>`. Y `fechaEmision` caía siempre en la fecha de
**importación**, no la fecha real del comprobante — bug de fallback silencioso:
`infoCompRetencion.fechaEmisionDocSustento` no existe como campo (se buscaba en el lugar
equivocado), y `parsearFecha('')` devuelve `new Date()` en vez de fallar.

**Fix**: el parser ahora soporta ambos schemas (v2.0.0 primero, v1.0.0 como fallback),
lee `valorRetenido` con fallback tolerante a variaciones, y usa
`infoCompRetencion.fechaEmision` (el campo correcto) para la fecha.

**Reparación de datos ya importados**: `POST /api/retenciones-recibidas/recalcular` +
botón "🔄 Recalcular totales" en la UI — re-parsea el `xmlAutorizado` ya guardado de
cada registro y corrige totales/detalles/fecha. Idempotente.

**Nota para quien retome esto**: el primer intento de este endpoint (mismo commit) se
olvidó de incluir `fechaEmision` en los campos que actualiza — quedó reparado a medias
hasta el commit `711aa0e`, cuando el cliente reportó que F104 seguía sin encontrar las
retenciones en el mes correcto. Si se vuelve a tocar este endpoint, verificar que
actualiza **todos** los campos que el parser corrige.

---

## 2 — F104 restaba las retenciones equivocadas

**Pregunta del cliente**: "¿lo retenido se calcula para la declaración de IVA?" — llevó
a revisar el código de `GET /api/declaraciones/f104` y encontrar un bug real.

El cálculo de "IVA a pagar" restaba las retenciones que **la empresa emite a sus
proveedores** (tabla `retenciones`, poblada correctamente y ya usada — sin bug — por el
F103). Esas retenciones son una obligación aparte: dinero que la empresa retuvo de sus
proveedores y debe remitir al SRI, **no** un crédito propio contra su IVA.

Lo que sí reduce el IVA a pagar es el IVA que **los clientes le retienen a la empresa**
al pagarle sus ventas (tabla `retenciones_recibidas` — la misma del punto 1). Como esa
tabla estaba en $0.00 por el bug de parseo, este crédito nunca se aplicó — el "IVA a
pagar" mostrado al cliente estuvo **sobreestimado** desde que existe el feature.

**Fix**: F104 ahora resta `retenciones_recibidas` (filtrado por código IVA: 2/4/6) del
período. El desglose 30%/70%/100% se calcula por el valor real de `porcentajeRetener`
en vez de por `codigoRetencion` — ese código varía entre emisores (confirmado con los 3
XML reales: usaban código `"2"` para 70%, no el `"726"` esperado de la tabla oficial de
catálogos SRI) y no es confiable para clasificar.

**De paso**: todo `declaraciones.js` (F104/F103/F101/disponibles) usaba el cliente
Prisma global en vez de `req.prisma` — potencial bug de aislamiento en cuentas con base
de datos propia por tenant. Migrado al patrón `req.prisma || prisma` ya usado en el
resto de rutas multi-tenant.

---

## 3 — Crédito tributario arrastrado del mes anterior

**Pregunta del cliente**: "¿en dónde puedo cargar el crédito tributario que arrastro
hasta el mes de mayo o abril?" — no existía ningún campo para esto.

Nueva tabla `declaraciones_credito_iva` (empresaId+anio+mes único) + endpoint
`PUT /api/declaraciones/f104/credito-anterior` + campo editable en la UI del F104
("Crédito tributario arrastrado del mes anterior"). Se resta del IVA a pagar del
período. **Deliberadamente no se encadena automático mes a mes** — el saldo oficial
ante el SRI puede no coincidir con lo que este sistema calcularía solo (por ejemplo si
el cliente empezó a usar AELA a mitad de año, o tiene ajustes de declaraciones
sustitutivas). El usuario lo ingresa una vez por período.

---

## 4 — DetalleCompra no se veía bien en pantallas angostas (2 bugs distintos)

El cliente reportó el mismo síntoma dos veces con capturas comparativas, y resultaron
ser **dos bugs de CSS independientes**, no el mismo problema mal arreglado:

**Bug A — valores en blanco** (commit `9598db4`): `.detalle-compra-row` usaba
`grid-template-columns: max-content 1fr` combinado con `max-width: 55%` en porcentaje
sobre la etiqueta. Esta combinación es conocida por calcularse de forma inconsistente
entre navegadores en el algoritmo de sizing de `max-content`, colapsando la columna de
valor a 0 en ciertos anchos — confirmado comparando capturas del mismo registro en
ancho normal (datos visibles) vs. ventana angosta (en blanco). Reemplazado por flexbox
explícito, el mismo patrón que ya usa sin problemas `DetalleFactura.css`.

**Bug B — la página se ensanchaba más allá de la pantalla** (commit `b0c9145`,
reportado por el cliente DESPUÉS del fix A con "el width sobresale la pantalla"):
`.detalle-compra-page` (el grid contenedor de toda la página) no tenía
`grid-template-columns: minmax(0, 1fr)` — a diferencia de los grids internos
(`.detalle-compra-grid`, `.detalle-compra-bottom`) que sí lo tenían. La tabla de
detalle de ítems (`min-width: 1024px`, con su propio `overflow-x: auto`) igual
empujaba el ancho MÍNIMO de toda la página más allá del viewport. Como
`.layout-root` tiene `overflow-x: hidden`, en vez de aparecer un scroll horizontal
visible, el contenido de la derecha simplemente se recortaba — exactamente lo que
mostraban las capturas.

**Lección para bugs similares en el futuro**: cuando algo se ve "cortado" o "en blanco"
solo en pantallas angostas, revisar **todos** los niveles de grid/flex anidados en
busca de `minmax(0, 1fr)` / `min-width: 0` faltante — el causante suele estar uno o más
niveles arriba de donde se ve roto el síntoma, no en el elemento que aparenta el
problema.

---

## 5 — RUC vs Cédula: compras no deducibles excluidas de declaraciones

**Pregunta del cliente**: "para las declaraciones, solo sirven las facturas de compras
realizadas con RUC, no con la cédula, son dos cosas diferentes."

Correcto tributariamente: una compra solo es deducible / genera crédito de IVA si el
comprobante fue emitido a nombre del RUC de la empresa. Si llegó dirigido a una cédula
personal (aunque el SRI trate ambos como el mismo contribuyente para persona natural),
no cuenta para las declaraciones.

**Implementación**: nueva columna `facturas_compra.receptorEsRuc` (nullable — `NULL`
significa "se desconoce", no se excluye nada sin certeza; solo se excluye lo marcado
explícitamente `false`). Se calcula al importar del Buzón SRI reutilizando
`extraerIdentificacionReceptorXml` (ya existía desde la sesión 07-09 para validar que
el documento pertenece a la empresa activa — solo no se persistía el resultado).
F104/F101 excluyen `receptorEsRuc === false` del cálculo, con aviso visible en pantalla
de cuántas compras se excluyeron. Badge de advertencia en el listado de Compras y en
`DetalleCompra.jsx`.

**Backfill retroactivo**: botón "🪪 Marcar RUC/Cédula" en Compras —
`POST /api/compras/backfill-receptor-ruc` re-lee el `xmlOrigen` guardado de cada
compra ya importada y la clasifica. El cliente debe darle clic una vez.

---

## 6 — Cuentas por Cobrar: recibo de cobro imprimible

Benchmark contra "Sofía" (otro ERP): el cliente compartió capturas de los submódulos
"próximamente" de CxC (Recibos, Importar, Órdenes de pago) preguntando qué priorizar.
Se le preguntó explícitamente cuál priorizar — eligió **Recibos**.

`GET /api/cxc/cobros/:id/recibo` — PDF A4 de una página (pdfkit, mismo patrón de
"archivo temporal + stream a la respuesta" que ya usan notas de venta y proformas) con
datos de la empresa, cliente, factura, forma de pago, total de la factura y saldo
pendiente actualizado, monto recibido destacado. Botón "🧾 Recibo" en Historial de
cobros + se abre automáticamente al registrar un cobro nuevo. Se retiró la pestaña
"Recibos" (quedaba redundante, su función vive ahora en Historial de cobros). Las
pestañas "Importar" y "Órdenes de pago" siguen como placeholder a propósito — no se
pidieron en esta sesión.

---

## 7 — Otros fixes menores

**Race condition en `getTenantPrisma`** (`backend/config/prismaTenant.js`): aplicaba
schema fixes en segundo plano sin esperarlos — los primeros requests tras cada deploy
(cold start) podían pegarle a tablas nuevas (`tarjetas_credito`, `movimientos_tarjeta`)
antes de que `applySchemaFixes.js` terminara de crearlas, causando 500 intermitentes.
Ahora se espera antes de servir el cliente (cacheado por tenant, sin costo en requests
posteriores). Diagnosticado a partir de un screenshot de consola del navegador que el
cliente compartió (`AxiosError: Request failed with status code 500` en
CuentasPorPagarHub/CuentasPorCobrarHub).

**ContabilidadHub — modal de asiento**: agrandado (900px→1180px, más padding y
tipografía) por queja de "muy compacto". "Ir al documento" ahora abre en pestaña nueva
en vez de navegar fuera del modal (para no perder el hilo del asiento que se está
viendo/editando).

**AyudaSistema.jsx**: 6 secciones nuevas (Cuentas por Cobrar/Pagar, Caja Chica,
Retenciones Recibidas, Declaraciones Tributarias F104/F103/F101, cuentas contables por
referencia, catálogo de transportistas) — módulos que ya existían en el sistema pero no
estaban documentados en la Ayuda in-app.

---

## Parte 2 — Segunda ronda: bugs reproducidos en vivo por el cliente

Tras la primera ronda de fixes, el cliente probó en producción y compartió 5 capturas
más con problemas concretos — dos eran bugs reales (uno de correctitud contable), tres
eran UX a mejorar.

## 8 — Asiento de compra descuadrado ("Partida descuadrada: debe=X.XX haber=X.XX")

**Reproducido por el cliente**: al dar clic en "Generar asiento" sobre una compra
específica (PC LAPTOP ECUADOR S.C.C., $878.25), el sistema rechazaba la operación con
`Partida descuadrada: debe=878.26 haber=878.25` — un descuadre real de 1 centavo, no
solo un mensaje de validación de más.

**Causa raíz** (`backend/utils/contabilidad.js`, `crearAsientoFacturaCompraRegistrada`):
el desglose por línea de la compra (suma de `detalle.subtotal` de los ítems
inventariables) puede tener 1 centavo de drift de redondeo frente a los totales
guardados a nivel de compra (`importeTotal`/`totalIva`) — perfectamente posible cuando
esos totales se calcularon en otro punto del código sumando IVA por línea sin redondear
hasta el final. El código calculaba `subtotalGasto = Math.max(total - iva -
subtotalInventario, 0)`: cuando ese residuo daba negativo (el drift hacía que
inventario+IVA ya superaran el total), el `Math.max(..., 0)` lo descartaba en silencio
en vez de conciliarlo, y como además `subtotalGasto` quedaba en 0, ni siquiera se
generaba la línea de "gasto" — el debe (inventario + IVA) quedaba $0.01 por encima del
haber (el total real).

**Fix**: el residuo negativo ahora se absorbe restándolo de `subtotalInventario` en vez
de descartarse, garantizando por construcción que inventario + gasto + IVA siempre
sumen exactamente el total de la compra. Verificado con varios escenarios de drift
simulados (incluyendo el caso exacto reportado) — todos cuadran ahora.

**Para la compra que falló**: el clic en "Generar asiento" no llegó a crear nada (el
error se lanza antes de persistir) — el cliente solo necesita volver a intentar
"Generar asiento" sobre esa misma compra, ahora debería funcionar.

## 9 — "Imprimir PDF" bloqueado por el navegador (ATS, Reportes Tributarios)

**Reproducido por el cliente**: clic en "Imprimir PDF" en el módulo ATS → alerta "No se
pudo abrir la ventana de impresión. Habilita las ventanas emergentes." + una ventana
externa en negro.

**Causa**: `frontend/src/utils/reportPrint.js` usaba `window.open('', '_blank', ...)`
para armar el HTML a imprimir y luego disparar `window.print()`. Los bloqueadores de
popups (Firefox en particular, que es el navegador de las capturas) bloquean con más
frecuencia una ventana abierta con URL vacía que una con URL real — y no hay forma de
"habilitar" esto de antemano para el usuario, tiene que pasar por la configuración del
navegador cada vez.

**Fix**: se reemplazó la ventana nueva por un `<iframe>` oculto en la página actual — se
escribe el mismo HTML ahí y se llama `iframe.contentWindow.print()`. Un iframe no abre
ninguna ventana ni pestaña, así que un bloqueador de popups nunca lo detecta. Afecta
tanto a ATS como a Reportes Tributarios (ambos comparten `printHtmlReport`).

## 10 — Filtros de Libro Diario / Cierre y Estados colapsaban mal en pantallas medianas

**Reproducido por el cliente**: en Contabilidad → Libro Diario (y Cierre y Estados), los
filtros (hasta 9 controles: buscador, período, 2 fechas, 2 selects, 3 botones) se veían
como una lista vertical larguísima de campos angostos en pantallas de ancho medio.

**Causa**: `.conta-filters` era un grid con 5 columnas fijas (`1.5fr repeat(2,
minmax(140px,1fr)) auto auto`) diseñado para paneles de ~5 campos — con 9 elementos, el
grid ya se veía raro incluso en desktop (los ítems de más se envolvían a una segunda
fila usando las mismas 5 columnas, sin relación con su tipo). Por debajo de 1100px, una
regla forzaba `grid-template-columns: 1fr` — colapso total a una columna, sin ningún
punto intermedio.

**Fix**: `.conta-filters` pasó de grid fijo a flexbox con `flex-wrap: wrap` — cada campo
tiene un ancho mínimo (140px) y crece para llenar el espacio disponible, reordenándose
de forma continua según el ancho real en vez de saltar entre "5 columnas" y "1 columna".
Los checkboxes anidados (ej. "Solo movimiento" en Plan de Cuentas) quedan excluidos de
este estirado para no verse deformados.

## 11 — Columna "Operación" en Compras — demasiados badges, poca claridad

**Pedido del cliente**: la columna mostraba 2 filas de chips/badges siempre visibles
(tipo de gasto, origen BUZON_SRI/MANUAL, aviso "A cédula", cuenta contable personalizada,
Inventario/Caja/Solo registro, Con asiento/Generar asiento) más un menú "···" — mucha
información compitiendo por atención. Pidió dejar solo botones de acción visibles
(Clasificar, Ver, Cuenta contable, Generar asiento) y mover la información de estado
(origen, aviso de cédula, si tiene asiento) al menú "···".

**Implementación**: la columna ahora muestra un solo grupo de 4 controles compactos:
✏️ Clasificar (tipo de gasto), 👁 Ver detalle, 📒 Cuenta contable, y ⚠ Generar asiento
(solo si aún no tiene uno — si ya lo tiene, el botón desaparece en vez de mostrar un
badge "✓ Con asiento" permanente). El botón "···" (renombrado internamente a
`InfoOps`) ahora abre un popover de solo lectura con Origen, estado del asiento e
Inventario/Caja — y si la compra está facturada a cédula, se pone en rojo para llamar
la atención sin ocupar espacio en la fila.

---

## 🔴 VERIFICAR EN PRODUCCIÓN

1. **Retenciones Recibidas** — ir a Tributario → Retenciones recibidas, dar clic en
   "🔄 Recalcular totales" (una sola vez), confirmar que los 3 comprobantes de mayo
   muestran valores reales (no $0.00) y fecha de mayo (no de importación).
2. **F104 de mayo** — tras el paso anterior, ir a Declaraciones → F104, mes Mayo,
   confirmar que aparece la sección "Retenciones de IVA recibidas" con los montos
   correctos y que el IVA a pagar baja en consecuencia.
3. **Crédito tributario arrastrado** — en F104, ingresar un valor de prueba en el
   campo nuevo, guardar, confirmar que se resta del IVA a pagar y que persiste al
   recargar la página.
4. **DetalleCompra responsiva** — abrir cualquier compra y achicar la ventana del
   navegador; confirmar que los datos de Proveedor/Comprobante siguen visibles y que
   la página no se ensancha más allá de la pantalla.
5. **RUC/Cédula** — en Compras, dar clic en "🪪 Marcar RUC/Cédula" (una sola vez),
   confirmar que las compras que correspondan muestran el badge "⚠️ A cédula" y que
   desaparecen del cálculo del F104/F101 del período correspondiente.
6. **Recibo de cobro** — en Cuentas por Cobrar, registrar un cobro de prueba y
   confirmar que el PDF se abre automáticamente con los datos correctos; también
   probar el botón "🧾 Recibo" desde Historial de cobros sobre un cobro ya existente.
7. **Asiento de compra descuadrado** — reintentar "Generar asiento" sobre la compra
   PC LAPTOP ECUADOR S.C.C. (u otra que haya fallado con "Partida descuadrada"),
   confirmar que ahora se genera sin error y que debe=haber en el Libro Diario.
8. **Imprimir PDF (ATS)** — en Tributario → ATS, generar el ATS de un mes con datos y
   dar clic en "Imprimir PDF"; confirmar que aparece el diálogo de impresión del
   navegador sin ningún aviso de ventana emergente bloqueada.
9. **Filtros de Libro Diario** — achicar la ventana del navegador a un ancho medio
   (~800-1000px) y confirmar que los filtros se acomodan en 2-3 columnas en vez de
   colapsar todos a una sola columna vertical.
10. **Columna Operación en Compras** — confirmar que cada fila muestra solo 4 botones
    (Clasificar, Ver, Cuenta contable, Generar asiento si aplica) y que el botón "···"
    abre un popover con Origen / Asiento / Inventario-Caja (y el aviso de cédula si
    corresponde, con el botón en rojo).

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (railway + aela_lsac + aela_mprq)
```

**Archivos clave modificados/creados esta sesión:**

| Archivo | Cambio |
|---------|--------|
| `backend/utils/buzon.js` | Parser de retenciones recibidas soporta schema v2.0.0 + `valorRetenido` + fecha correcta |
| `backend/routes/retenciones-recibidas.js` | `POST /recalcular` (reparación retroactiva) |
| `backend/routes/declaraciones.js` | F104 usa fuente correcta de retenciones + crédito tributario arrastrado + `req.prisma` |
| `backend/prisma/migrations/20260712000000_declaraciones_credito_iva` | Tabla nueva |
| `backend/prisma/migrations/20260712010000_receptor_es_ruc` | Columna `facturas_compra.receptorEsRuc` |
| `backend/routes/compras.js` | `POST /:id/reparar-proveedor`, `POST /backfill-receptor-ruc` |
| `backend/routes/cxc.js` | `GET /cobros/:id/recibo` (PDF) |
| `backend/config/prismaTenant.js` | Fix race condition en schema fixes al arrancar |
| `frontend/src/components/Compras/DetalleCompra.css` | 2 fixes de responsividad |
| `frontend/src/components/Declaraciones/Declaraciones.jsx` | Crédito tributario arrastrado + aviso compras excluidas |
| `frontend/src/components/CuentasPorCobrar/CuentasPorCobrarHub.jsx` | Botón/flujo de recibo de cobro |
| `frontend/src/components/Ayuda/AyudaSistema.jsx` | 6 secciones nuevas + notas de esta ronda |
| `backend/utils/contabilidad.js` | Fix descuadre en asiento de compra (residuo de redondeo) |
| `frontend/src/utils/reportPrint.js` | Impresión vía iframe oculto en vez de `window.open` |
| `frontend/src/components/Contabilidad/ContabilidadHub.css` | `.conta-filters` de grid fijo a flexbox |
| `frontend/src/components/Compras/ListaCompras.jsx` / `.css` | Columna Operación simplificada (4 botones + popover de info) |
