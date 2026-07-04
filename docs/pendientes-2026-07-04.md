# AELA ERP — Sesión 2026-07-04

## Resumen ejecutivo

Sincronización de git (HEAD local desactualizado, sin pérdida de trabajo), seguimiento
de pendientes de sesiones anteriores, diseño + implementación de la primera pieza del
"motor de reglas contables" pedido por un cliente (configuración de cuentas contables
para asientos automáticos de compras), cierre del gap de "POS + inventario permanente"
de los 5 principios ERP (asiento automático de costo de ventas para facturas, y luego
para notas de venta también), fix de aislamiento multiempresa en el módulo Bancos +
vínculo con Plan de Cuentas, y actualización completa de la Ayuda del sistema y el
manual de usuario.

Commits pusheados: `de6b37e`, `6b081f3`, `c7adfd7`, `59b673d`, `2886f8b`, `b46a3b2`, `5c429dd`, `08c2018`, `a3ee110`, `62ed9f6`, `5776d08`, `cbe029f`

---

## 🔴 PENDIENTES PARA MAÑANA — verificar en producción, en orden

1. **Confirmar deploy de Railway** — abrir pestaña "Details" del deployment activo y
   confirmar que corresponde al commit `62ed9f6` (o posterior). Si Railway no lo tomó,
   forzar redeploy manual ("Clear build cache & redeploy").
2. **Bancos en Consorcio Vial** — recargar (Ctrl+Shift+R), confirmar que el modal
   "Nueva Cuenta Bancaria" se ve sólido (no transparente) y que el selector "Cuenta
   contable" muestra las cuentas ya creadas en el Plan de Cuentas de esa empresa.
   Crear una cuenta bancaria de prueba vinculada, guardar, y confirmar que aparece
   bajo Consorcio Vial (no bajo la empresa base del usuario).
3. **Configuración contable de compras** — en Contabilidad → Plan de Cuentas, elegir
   una cuenta de gasto propia en "Configuración de asientos automáticos", registrar
   o importar una compra no inventariable, confirmar en el Libro Diario que usa esa
   cuenta (no la genérica "5.2.01.001 Compras Locales").
4. **Costo de ventas en facturas** — emitir una factura con un producto inventariable,
   esperar autorización SRI, confirmar asiento `COSTO_VENTA` en el Libro Diario además
   del `FACTURA`.
5. **Asientos de Notas de Venta** — crear una nota de venta (POS) con producto
   inventariable, confirmar asientos `NOTA_VENTA` + `COSTO_VENTA`; anularla y
   confirmar `ANULACION_NOTA` que reversa ambos.
6. **Buzón SRI genera asiento** — importar una factura de compra por el Buzón
   (XML/ZIP/scraper) y confirmar que aparece un asiento `COMPRA` en el Libro Diario.
7. **Scraper SRI login** — pendiente desde antes, el cliente priorizó lo contable.
   Confirmar en logs de Railway: `[SRI] sriScraper.js build 2026-07-01 — incluye
   hash MD5+SHA-512`.
8. **Movimientos bancarios con asiento contable** (feature `cbe029f`) — en Bancos,
   registrar un movimiento o emitir un cheque eligiendo una "Cuenta contrapartida",
   confirmar que aparece el asiento `MOVIMIENTO_BANCO` en el Libro Diario. Registrar
   otro SIN elegir contrapartida y confirmar que se sigue guardando normal (sin asiento).

Detalle completo de cada punto (causa raíz, qué se cambió) en las secciones abajo.

---

## ✅ Verificación local (2026-07-04, mañana) — puntos 3, 4, 5, 8 confirmados con datos reales

Se corrió un script de integración contra `scfi_dev` (Postgres local, sin mocks —
llama a las mismas funciones de `utils/contabilidad.js`/`utils/inventario.js` que
usan las rutas reales). 22 asserts, todos ✅:

- **Punto 3 (config contable):** una compra con `codigoCuentaComprasGasto` configurado
  a una cuenta propia usó esa cuenta (no la genérica 5.2.01.001) — confirmado con
  monto exacto.
- **Punto 4 (costo de ventas factura):** venta de 2 unidades a costo 10 → stock
  100→98, asiento `COSTO_VENTA` con Debe Costo=20 / Haber Inventario=20, partida
  cuadrada.
- **Punto 5 (notas de venta):** venta de 3 unidades → asiento `NOTA_VENTA` (Debe
  Caja=30 / Haber Ventas=30, sin línea de IVA — correcto para RIMPE Negocio Popular)
  + asiento `COSTO_VENTA`=30; al anular, el stock se revirtió 95→98 y se generaron
  2 asientos `ANULACION_NOTA` con débito/crédito invertido correctamente.
- **Idempotencia:** llamar `crearAsientoFacturaCompraRegistrada` dos veces con el
  mismo `compraId` NO duplica el asiento.
- **Bancos:** confirmado que `include: { cuentaContable }` devuelve correctamente
  código+nombre de la cuenta vinculada.
- **Punto 8 (movimientos bancarios, feature `cbe029f`):** depósito con contrapartida
  → banco Debe=500 cuadrado; retiro con contrapartida → banco Haber=200 / gasto
  Debe=200; movimiento SIN contrapartida se registra igual sin crear asiento;
  idempotencia; y error claro si la cuenta bancaria no está vinculada al Plan de
  Cuentas — 9/9 asserts.

**Nota sobre el entorno local:** estaba desactualizado (4 migraciones pendientes,
incluida `20260704000000_configuracion_contable` de ayer) — se corrió
`npx prisma migrate deploy` + `node scripts/applySchemaFixes.js` contra `scfi_dev`
antes de probar. Ambos corrieron limpio, validando también que la migración de
ayer es sintácticamente correcta contra Postgres real (no solo contra el schema).

**Lo que esto NO reemplaza:** el flujo HTTP completo (login, autorización SRI real,
UI) sigue sin probarse — eso solo se puede confirmar en producción o con un usuario/
contraseña de prueba a mano. Los puntos 1 (deploy Railway), 2 (Bancos UI en Consorcio
Vial), 6 (Buzón SRI) y 7 (scraper) del listado de arriba siguen pendientes de
verificar ahí.

---

---

## Seguimiento de pendientes (sesión 2026-07-03)

Confirmado por el usuario:
- ✅ Punto 1 (Plan de Cuentas Consorcio Vial) — completado
- ✅ Punto 2 (Facturas históricas) — completado; el XML sí carga las facturas
- 🟡 Punto 3 (Buzón SRI: facturas/NC/ND/retenciones a cada módulo) — **parcialmente confirmado como bug real**, ver abajo
- ⏳ Punto 4 (Scraper SRI login) — aún sin probar, cliente priorizando que la parte contable funcione al 100%
- ✅ Punto 5 (Gestión Empresas — contadora/repLegal) — funciona

## Hallazgo — Buzón SRI: documentos importados no generaban asiento contable (`de6b37e`)

Al revisar el punto 3, se confirmó que el ruteo por tipo de documento SÍ funciona
correctamente (facturas/liquidaciones → `facturas_compra`, NC/ND → `docs_recibidos_otros`,
retenciones → `retenciones_recibidas`, todos visibles en el tab "Historial" del Buzón).

**El problema real:** `crearAsientoFacturaCompraRegistrada()` (que genera el asiento
contable automático) solo se llamaba desde el registro MANUAL de compras
(`routes/compras.js`). Las facturas de compra importadas por el Buzón SRI (los 4
endpoints: `/importar`, `/importar-zip`, `/importar-xml`, `/sri-scraper/importar`)
nunca generaban asiento — quedaban fuera de la contabilidad sin importar cuántas se
importaran.

**Fix:**
- `crearAsientoFacturaCompraRegistrada()` acepta ahora `db` opcional (mismo patrón que
  `getConfigSRI` en `facturas.js`) para respetar el tenant correcto cuando se llama desde
  rutas con `multer` (donde el proxy global de Prisma rompe `AsyncLocalStorage`).
- Nuevo helper `_generarAsientoSiAplica()` en `buzon.js`, llamado tras cada
  `facturas_compra` creada en los 4 endpoints. No bloqueante: si falla, se loguea pero
  no revierte la importación del documento (mismo criterio que `compras.js`).

**Pendiente (fuera de alcance de este fix):** `retenciones_recibidas` y
`docs_recibidos_otros` (NC/ND recibidas) aún no tienen tratamiento contable propio —
no existe una función `crearAsientoXxx` para ellos todavía. Backlog.

---

## Feature — Configuración contable: cuentas enlazadas por el contador (`6b081f3`)

### Pregunta del cliente
"¿Cómo configuro la parte contable para que al ingresar las compras se contabilicen
directamente en la cuenta de gastos [que yo elija]?"

### Estado ANTES de este fix
Toda compra no inventariable se contabilizaba SIEMPRE en una única cuenta genérica
hardcodeada: `5.2.01.001 "Compras Locales"` (tipo GASTO). No existía forma de elegir
otra cuenta. Lo mismo aplicaba a inventario (`1.1.04.001`), IVA compras (`1.1.05.001`),
cuentas por pagar (`2.1.04.001`) y caja (`1.1.01.001`) — todas fijas en el código.

### Diseño elegido
El usuario aclaró que prefiere que **el contador configure manualmente los enlaces**
desde el propio Plan de Cuentas de la empresa, en vez de un motor de reglas por
producto/categoría/proveedor (eso queda como posible v2 si se necesita más adelante).

### Implementación
- **Nueva tabla `configuracion_contable`** (1 fila por empresa, guarda el **código**
  de la cuenta, no el id — porque el plan de cuentas se puede reemplazar/reconstruir
  por empresa y el código es lo estable desde la perspectiva del usuario):
  `codigoCuentaComprasGasto`, `codigoCuentaInventario`, `codigoCuentaIvaCompras`,
  `codigoCuentaCxP`, `codigoCuentaCajaCompras`
- **`utils/contabilidad.js`**: `obtenerConfiguracionContable()` + `_resolverCuenta()`
  — usa la cuenta configurada si existe y acepta movimiento; si no, cae al valor por
  defecto de siempre (nunca rompe el asiento por una configuración inválida o
  desactualizada, solo loguea una advertencia)
- **`routes/contabilidad.js`**: `GET/PUT /api/contabilidad/configuracion-asientos` —
  valida que cada código configurado exista en el Plan de Cuentas de la empresa y
  acepte movimiento antes de guardar
- **`ContabilidadHub.jsx`**: nueva tarjeta "⚙️ Configuración de asientos automáticos —
  Compras" en el tab Plan de Cuentas, con 5 selectores (poblados desde el plan de
  cuentas ya cargado en memoria, filtrados por el tipo de cuenta esperado) y botón
  Guardar

### Cómo lo usa el contador
1. Ir a Contabilidad → Plan de Cuentas
2. Crear (o ya tener) la cuenta de gasto específica que quiere usar (ej. "Gastos de
   Oficina 5.2.03.010")
3. En la tarjeta "Configuración de asientos automáticos — Compras", elegir esa cuenta
   en el selector "Gasto por compra"
4. Guardar — desde ese momento, TODAS las compras (manuales y del Buzón SRI) se
   contabilizan en esa cuenta en vez de la genérica

### Pendiente de verificar
Probar el flujo completo: configurar una cuenta de gasto propia, registrar/importar
una compra no inventariable, y confirmar en el Libro Diario que el asiento usa la
cuenta configurada (no la genérica).

---

## Feature — Asiento automático de costo de ventas (`c7adfd7`)

Al revisar el principio #3 se confirmó que el inventario **sí se descontaba** al vender
(`aplicarMovimientosVentaDesdeDetalles`, ya implementado y funcionando en facturas.js y
notasVenta.js), pero la factura autorizada solo generaba el asiento de venta
(CxC/Ventas/IVA) — nunca el segundo asiento de **Costo de Ventas vs Inventario**. Los
estados financieros no reflejaban el costo de la mercadería vendida.

**Fix:** `crearAsientoCostoVentaFactura()` en `utils/contabilidad.js` — toma el costo
real congelado en `movimientos_inventario` al momento de la venta (no el costoUnitario
actual del producto, que puede haber cambiado desde entonces), y solo genera asiento si
hubo ítems inventariables (facturas de solo servicios no generan nada). Se llama junto a
`crearAsientoFacturaAutorizada`, en el mismo punto (tras autorización SRI), respetando la
regla de no contabilizar en borrador. Reutiliza `configuracion_contable` (feature de
arriba): nuevo campo `codigoCuentaCostoVentas`, default `5.1.01.001` si no se configura.

**Importante — gap distinto sin resolver:** `notas_venta` (POS) **no tiene ningún**
asiento contable propio todavía, ni de venta ni de costo — es un problema más grande y
separado (habría que agregar ambos asientos ahí, no solo el de costo). Queda en backlog.

### Pendiente de verificar
Emitir una factura con al menos un producto inventariable, esperar la autorización SRI,
y confirmar en el Libro Diario que aparece el asiento tipo `COSTO_VENTA` además del de
`FACTURA`, con el monto correcto (cantidad × costoUnitario de esa venta).

---

## Bug — Bancos operaba sobre la empresa base, no la empresa activa (`2886f8b`)

Reportado con captura del módulo Bancos en **CONSORCIO VIAL UCH...** (sub-empresa de
LSAC en modo Macro Empresa) mostrando "No hay cuentas bancarias registradas" pese a
que el Plan de Cuentas de esa empresa ya tenía cuentas de banco cargadas.

**Causa raíz:** `backend/routes/bancos.js` tenía su propio `obtenerEmpresaId(req)` que
devolvía `req.usuario.empresaId` (empresa **base** del usuario, nunca cambia) en vez de
`req.empresa.id` (empresa **activa**, la que refleja el EmpresaSwitcher/cambiar-empresa).
Es el único archivo de rutas con este bug — se confirmó grepeando `req.empresa.id` en
el resto de `routes/*.js`, todos lo usan directamente sin un helper intermedio.
Efecto real: un Admin Macro (como Robert Ocampo) viendo/creando cuentas bancarias
mientras tenía activa Consorcio Vial en realidad operaba sobre las cuentas de su
empresa base — ni siquiera un simple "no se ve nada", sino potencial mezcla de datos
entre empresas.

**Fix:** `obtenerEmpresaId` ahora prioriza `req.empresa?.id`, igual que el resto de rutas.

## Feature — Vincular cuentas bancarias con el Plan de Cuentas (`2886f8b`)

El modelo `bancos.cuentaContableId` (FK opcional a `plan_cuentas`) ya existía en el
schema y el backend (`routes/bancos.js`) ya lo aceptaba en POST/PUT — el gap era
puramente de frontend: el formulario nunca mostraba el selector.

**Fix en `BancosHub.jsx`:**
- Modal Nueva/Editar Cuenta Bancaria: selector de cuenta contable (carga cuentas tipo
  `ACTIVO` con `aceptaMovimiento` desde `GET /contabilidad/plan-cuentas`).
- Tarjeta de cada cuenta y detalle: muestra la cuenta contable vinculada, o un aviso
  "⚠ Sin cuenta contable vinculada" si no se ha configurado.

**Pendiente:** los movimientos bancarios (`movimientos_bancarios`) tienen un campo
`asientoId` en el schema pero no se generan asientos contables automáticamente al
registrar depósitos/retiros manuales todavía — solo los cheques generan su propio
movimiento bancario (sin asiento). Backlog si se necesita conciliar Bancos con el
Libro Diario automáticamente.

## Docs — Ayuda del sistema y manual de usuario actualizados (`2886f8b`)

- `AyudaSistema.jsx`: sección "Multiempresa y Admin Macro" reescrita (estaba
  desactualizada desde hace semanas, backlog recurrente); nuevas secciones Plan de
  Cuentas avanzado, Configuración contable, Bancos, Facturas Históricas; Buzón SRI
  actualizado con el límite de fecha del SRI para documentos antiguos.
- `docs/manual-usuario.md`: mismas actualizaciones en Contabilidad (12.3.1, importación
  de plan de cuentas, NIIF Supercias), Bancos (13.1), Facturación (7.7 reemplaza una
  sección de "Buzón SRI" vieja e **incorrecta** — describía algo que el Buzón SRI real
  nunca hizo) y Compras (9.7, Buzón SRI con el detalle correcto).

---

## Feature — Asientos contables para Notas de Venta (`5c429dd`)

Cerraba el gap más grande que había quedado documentado tras el fix de costo de ventas
de facturas: `notas_venta` (RIMPE Negocio Popular, sin XML electrónico) no generaba
NINGÚN asiento — ni de venta ni de costo.

- `crearAsientoVentaNotaVenta()`: Debe Caja / Haber Ventas por el total (no llevan IVA).
  A diferencia de facturas, no hay autorización SRI que gatee el asiento — la nota es
  válida desde su creación, así que se genera en el mismo request (no en background).
- `crearAsientoCostoVentaNotaVenta()`: mismo patrón que el de facturas, toma el costo
  congelado en `movimientos_inventario` (tipo `VENTA_NOTA`). Reutiliza la MISMA
  configuración contable (`codigoCuentaCostoVentas`/`codigoCuentaInventario`) que
  facturas — es el mismo concepto contable independientemente del tipo de documento.
- `crearAsientoReversoNotaVentaAnulada()`: al anular, reversa ambos asientos (venta y
  costo) invirtiendo débito/crédito de cada línea original.

**Pendiente de verificar:** crear una nota de venta con un producto inventariable,
confirmar en el Libro Diario los asientos `NOTA_VENTA` + `COSTO_VENTA`; anularla y
confirmar el asiento `ANULACION_NOTA` que revierte ambos.

---

## Revisión de los 5 principios de diseño ERP contable (vs. estado real del código)

| # | Principio | Estado |
|---|-----------|--------|
| 1 | Cuentas de control (no "cuentitis") | ✅ Seguido — CxC/CxP usan FK a `clientes`/`proveedores`, una sola cuenta contable genérica por concepto, no una por cliente/proveedor |
| 2 | Motor de reglas / mapeo SRI → cuenta contable | 🟡 Parcial — implementado como **configuración manual del contador** (este fix), no como motor automático por producto/categoría/proveedor. La tabla `sri_mapeo_cuentas` del backlog original (código retención/IVA → cuenta) sigue sin implementar |
| 3 | POS + inventario permanente (2 asientos por venta) | ✅ Resuelto para `facturas` (`c7adfd7`) y `notas_venta` (`5c429dd`) — ambos tipos de venta ya generan asiento de venta + costo |
| 4 | Centros de costo dimensionales | ❌ No implementado — no existe `centroCostoId` en ningún lado del esquema |
| 5 | Provisiones RRHH automáticas | ❌ No implementado — `crearAsientoNominaPeriodo()` literalmente lanza `Error('El módulo de nómina no está implementado en esta versión de AELA')` |

**Con los puntos 1 y 3 resueltos, los pendientes reales del diseño contable quedan en
2 (motor automático de reglas, opcional), 4 (centros de costo) y 5 (provisiones RRHH)
— los tres son mejoras de alcance mayor, no gaps críticos de datos incorrectos.**

---

## Bug — Modal de Bancos transparente + selector de cuenta contable vacío (`a3ee110`)

Reportado con captura: al abrir "Nueva Cuenta Bancaria" en Consorcio Vial, el modal se
veía transparente (el texto "No hay cuentas bancarias registradas" y el botón "+
Agregar primera cuenta" de la página de atrás se veían superpuestos con el formulario),
y el selector "Cuenta contable" no mostraba las cuentas que ya existían en el Plan de
Cuentas de esa empresa.

**Causa raíz #1 (modal transparente):** `Bancos.css` y `BancosHub.jsx` usan variables
CSS que **nunca se definieron en ningún lado del proyecto**: `--color-surface`,
`--color-text-primary`, `--color-text-secondary`, `--color-border`. Solo existen
`--color-bg`, `--color-text`, `--color-text-muted` en `App.css`. `background:
var(--color-surface)` con la variable indefinida y sin fallback resuelve a
`transparent` — de ahí el efecto "modal transparente" superpuesto con el fondo.
**Mismo patrón confirmado en 4 archivos más** (no corregidos en este commit):
`ImportarFacturasHistoricas.css`, `FormEmpleado.jsx`, `Nomina.jsx`, `TalentoHumano.css`.

**Causa raíz #2 (selector vacío):** `GET /contabilidad/plan-cuentas` filtraba `tipo`
con comparación EXACTA sensible a mayúsculas (`where.tipo = String(tipo).toUpperCase()`
sin `mode: 'insensitive'`). Si una cuenta quedó importada con el tipo en otra
capitalización (ej. "Activo" en vez de "ACTIVO" — plausible tras las importaciones
de formato externo de la sesión 07-03), quedaba excluida silenciosamente de cualquier
selector que filtrara por tipo, incluido el nuevo de Bancos.

**Fix:**
- Todas las referencias a variables indefinidas reemplazadas por las reales del
  proyecto (con fallback inline donde aplica) en Bancos.css y BancosHub.jsx.
- `tipo` en `GET /contabilidad/plan-cuentas` ahora usa `mode: 'insensitive'`.
- El selector de Bancos ya NO filtra por `tipo` en el frontend (solo por
  `aceptaMovimiento`+`activo`) — más tolerante a datos mal normalizados, el usuario
  igual puede identificar la cuenta correcta por código/nombre.
- El error de carga del selector ya no se silencia (`catch(() => {})` →
  `console.error(...)`), para diagnosticar más rápido la próxima vez.

**Pendiente de verificar:** recargar Bancos en Consorcio Vial, confirmar que el modal
se ve sólido (no transparente) y que el selector ahora muestra las cuentas del Plan
de Cuentas ya creadas.

## Feature — Asiento contable opcional para movimientos bancarios y cheques (`cbe029f`)

Siguiente punto del backlog de contabilidad: `movimientos_bancarios.asientoId` existía
en el schema pero nunca se usaba — ningún depósito/retiro/cheque manual generaba
asiento contable, a diferencia de compras y ventas.

**Diseño:** a diferencia de compras/ventas, un movimiento bancario manual NO tiene una
contrapartida contable predecible (puede ser un aporte de capital, el pago de un gasto
puntual, un cobro a un cliente, etc.) — por eso no se adivina la cuenta como se hizo con
`configuracion_contable`. El usuario elige la cuenta contrapartida al registrar el
movimiento o emitir el cheque; si no la elige, el movimiento se registra exactamente
igual que antes (sin asiento) — no se fuerza nada.

- `crearAsientoMovimientoBancario()` en `utils/contabilidad.js`: Debe/Haber banco vs.
  la cuenta contrapartida elegida (según el movimiento sea entrada o salida). Requiere
  que la cuenta bancaria ya esté vinculada a una cuenta del Plan de Cuentas (el fix de
  ayer); si no, lanza un error claro pidiendo vincularla primero. Idempotente vía
  `asientoId` (si el movimiento ya tiene asiento, no crea otro).
- `routes/bancos.js`: `POST /:id/movimientos` y `POST /:id/cheques` aceptan
  `cuentaContrapartidaId` opcional en el body.
- `BancosHub.jsx`: selector "Cuenta contrapartida (opcional)" en el modal de
  Movimiento y en el de Cheque. Se extrajo `useCuentasContables()` como hook
  compartido (antes el fetch estaba duplicado solo en ModalCuenta).

**Verificado con script de integración contra `scfi_dev` real** (Postgres, sin mocks,
mismo patrón que ayer): 9/9 asserts — depósito (entrada), retiro (salida), movimiento
sin contrapartida (se registra igual, sin asiento), idempotencia, y error claro cuando
la cuenta bancaria no está vinculada al Plan de Cuentas.

---

## Nota — Deploy de Railway

Se confirmó con una captura de Railway que el deployment "Active" databa de
**3 de julio 22:30**, coincidiendo casi exactamente con los últimos commits de esta
sesión (`2886f8b` 22:18, `5c429dd`/`08c2018` 22:30) — probablemente SÍ incluye esos
fixes, pero no hay 100% de certeza sin revisar la pestaña "Details" del deployment
para confirmar el commit exacto de GitHub asociado. Con el push de `a3ee110` debería
dispararse un nuevo deploy — verificar que se complete antes de volver a probar Bancos.

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway
```

**Archivos clave de esta sesión:**
- `backend/utils/contabilidad.js` — `crearAsientoFacturaCompraRegistrada`,
  `obtenerConfiguracionContable`, `_resolverCuenta`, `crearAsientoCostoVentaFactura`,
  `crearAsientoVentaNotaVenta`, `crearAsientoCostoVentaNotaVenta`,
  `crearAsientoReversoNotaVentaAnulada`
- `backend/routes/contabilidad.js` — `GET/PUT /configuracion-asientos`, filtro `tipo`
  case-insensitive en `GET /plan-cuentas`
- `backend/routes/buzon.js` — `_generarAsientoSiAplica`
- `backend/routes/facturas.js` — llamada a `crearAsientoCostoVentaFactura`
- `backend/routes/notasVenta.js` — llamadas a los 3 asientos de nota de venta
- `backend/routes/bancos.js` — fix `obtenerEmpresaId` (empresa activa, no base)
- `frontend/src/components/Contabilidad/ContabilidadHub.jsx` — tarjeta de configuración
- `frontend/src/components/Bancos/BancosHub.jsx` + `Bancos.css` — selector cuenta
  contable, variables CSS corregidas (`--color-surface` y similares no existían)
- `frontend/src/components/Ayuda/AyudaSistema.jsx` + `docs/manual-usuario.md` —
  documentación actualizada (multiempresa, contabilidad, bancos, Buzón SRI)

**Variables CSS indefinidas — pendiente en otros módulos:** `ImportarFacturasHistoricas.css`,
`FormEmpleado.jsx`, `Nomina.jsx`, `TalentoHumano.css` usan el mismo patrón roto
(`--color-surface`, `--color-text-primary`, `--color-text-secondary`, `--color-border`)
que no existen en `App.css`. No corregido hoy — revisar si causa problemas visuales
reportados en Talento Humano o Facturas Históricas.

**Nota de git:** al iniciar esta sesión, `git pull` fue rechazado porque el HEAD local
estaba en `bc49978` mientras `origin/main` ya iba en `c09e044` (15 commits de sesiones
2026-07-02/03 hechas en otro entorno). Se verificó **byte a byte** que el working tree
ya coincidía con `origin/main` antes de sincronizar — no se perdió nada. Si esto vuelve
a pasar: `git fetch && git diff origin/main --stat` antes de asumir que hay conflictos reales.
