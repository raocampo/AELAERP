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
| `frontend/src/components/Ayuda/AyudaSistema.jsx` | 6 secciones nuevas |
