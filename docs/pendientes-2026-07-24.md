# AELA ERP — Sesión 2026-07-24 — Sucursales y Puntos de Venta (multi-caja), Fase 0+1

## 🟢 PARA RETOMAR — checklist rápido

**Código**: commiteado y pusheado a `main`. Nada sin commitear.

1. **Probar en producción con datos reales** (todo verificado localmente con
   scripts ad-hoc en transacción con rollback, nunca contra producción ni en
   el navegador):
   - Confirmar que `applySchemaFixes.js` corrió sin errores en el deploy de
     Railway (buscar `[schema-fix]` en los logs de arranque, para la BD
     principal, master y cada tenant activo) — la migración agrega la tabla
     `sucursales`, la columna `puntos_emision.sucursalId`, y
     `establecimiento`/`puntoEmision` a `facturas`, `notas_credito`,
     `notas_debito`, `retenciones`, `liquidaciones_compra`, `notas_venta`.
   - Ir a Configuración → Sucursales y Puntos de Venta con un tenant real,
     confirmar que aparece automáticamente una sucursal "Matriz" con un punto
     de venta "Caja General" (creados de forma perezosa la primera vez que se
     visita Configuración SRI o Facturación/POS/Guías — no requieren ninguna
     acción manual).
   - Crear una 2ª sucursal + 2ª caja en un tenant de prueba REAL (no local) y
     emitir facturas desde ambas para confirmar en el navegador que la
     numeración es independiente y no se pisa.
2. **Cliente que pidió esto** (supermercado con 2→4 cajas + nueva sucursal):
   avisarle que ya puede crear sus sucursales/cajas en Configuración →
   Sucursales y Puntos de Venta, y que al facturar/vender aparecerá un
   selector para elegir con cuál está trabajando (el selector se oculta solo
   si hay 1 solo punto de venta, así que los demás tenants no ven nada nuevo).
3. **Fases 2, 3 y 4 — NO implementadas todavía, quedan para sesiones
   siguientes** (ver detalle en la sección final de este documento):
   - Fase 2: Caja Diaria independiente por punto de venta (hoy sigue siendo
     UNA sola caja por empresa por día — `cajas_diarias.@@unique([empresaId,
     fechaOperacion])` no se tocó en esta sesión). Si el cliente abre 2 cajas
     en la misma sucursal y ambas venden, **hoy comparten la misma caja
     diaria** — esto es una limitación conocida, no un bug, documentada aquí
     a propósito para no olvidarla.
   - Fase 3: Stock por sucursal (hoy el inventario sigue siendo global por
     empresa, no por sucursal — dos sucursales comparten el mismo stock).
   - Fase 4: Reportes/filtros por sucursal.

---

## Contexto

Un cliente (supermercado) preguntó si AELA maneja "ventas por sucursal".
Investigación confirmó que **no existía nada real**: había una tabla
`puntos_emision` que solo servía para configurar secuenciales iniciales al
migrar de otro sistema (sin CRUD, sin selector en ningún lado), y un único
establecimiento/punto de emisión fijo por empresa en `configuracion_sri`.

Aclarado con el cliente el modelo real que necesita: tiene 1 local con 2
cajas (va a subir a 4) y va a abrir una segunda sucursal. Confirmado:
**Sucursal** = local físico = "establecimiento" SRI; **Punto de
Venta/Caja** = caja registradora dentro de una sucursal = "punto de
emisión" SRI. Caja Diaria debe ser independiente por caja (Fase 2, no
implementada aún); Stock debe ser independiente por sucursal (Fase 3, no
implementada aún).

**Hallazgo crítico durante la investigación** (no reportado por el cliente,
encontrado leyendo el código): `facturas.js`, `notasDebito.js`,
`liquidacionesCompra.js` y `retenciones.js` calculaban el siguiente
secuencial con `findFirst({ where: { empresaId } }, orderBy: secuencial
desc)` **sin filtrar por establecimiento/puntoEmision** — un bug de
cumplimiento SRI ya presente, listo para explotar en cuanto cualquier
tenant activara 2+ puntos de venta (la numeración de una caja se pisaría
con la de otra). `guias_remision.js` ya tenía el patrón correcto
(filtraba por el par completo) y sirvió de plantilla para corregir los
otros 4.

---

## Implementado (Fase 0 + Fase 1)

### Modelo de datos

- **Nueva tabla `sucursales`**: `nombre`, `establecimiento` (único por
  empresa), `direccion`, `telefono`, `esMatriz`, `activo`.
- **`puntos_emision`** (ya existía): se le agregó `sucursalId` (FK a
  `sucursales`, nullable — se completa perezosamente, ver abajo).
- **5 modelos de documentos SRI** ganaron `establecimiento`/`puntoEmision`
  (mismo patrón que ya tenía `guias_remision`): `facturas`, `notas_credito`,
  `notas_debito`, `retenciones`, `liquidaciones_compra`. `notas_venta`
  también, pero su secuencial sigue siendo único GLOBAL por empresa (no es
  comprobante electrónico SRI — deuda técnica documentada en el propio
  schema, no se tocó el `@@unique`).
- **Backfill incluido en la misma migración**: para documentos históricos ya
  numerados con un establecimiento/punto distinto de 001-001 (detectado un
  caso real en desarrollo: `numeroFactura: '002-002-000000002'` con las
  columnas nuevas en default '001'/'001' antes del backfill), se parsea el
  establecimiento/puntoEmision directo del número ya formateado
  (`numeroFactura`, `numeroNC`, etc.) en vez de dejar el default parejo —
  evita que activar un punto de venta que coincida con un establecimiento
  histórico reinicie su secuencial desde 1 (riesgo de numeración/clave de
  acceso duplicada).
- Migración `20260724000000_sucursales_puntos_venta` + reflejada
  íntegramente en `backend/scripts/applySchemaFixes.js` (obligatorio: cada
  tenant tiene su propia BD física en producción, ver incidente del
  2026-07-23 documentado en la sesión anterior).

### Migración perezosa (sin script de backfill separado)

En vez de un script que recorra todos los tenants para crear su sucursal
"Matriz" + punto de venta default, se aprovechó que
`GET /puntos-emision/activo` **ya existía** y ya auto-creaba el punto de
emisión activo si no existía (usado por Configuración SRI desde antes de
esta sesión). Se extendió esa misma función para también auto-crear/vincular
la sucursal correspondiente. Se agregó además `GET /puntos-emision/activos`
(plural), que hace lo mismo pero para poblar el selector del frontend. Así,
cualquier tenant existente obtiene su Matriz + Caja General la primera vez
que toca Configuración SRI, Facturación, POS o Guías de Remisión — sin
ejecutar nada manualmente ni arriesgar un script de backfill separado
corriendo contra producción.

### Backend

- **`backend/routes/sucursales.js` (nuevo)**: CRUD completo (`GET/POST/PUT/
  DELETE`), permiso `sucursales.gestionar` (rol admin/contador). La Matriz
  no se puede desactivar ni eliminar. El `establecimiento` no se puede editar
  después de creado (cambiaría la numeración SRI de documentos ya emitidos).
- **`backend/routes/puntosEmision.js`**: agregado `POST /` (crear punto de
  venta bajo una sucursal — el `establecimiento` siempre se deriva de la
  sucursal, nunca se acepta del body), `DELETE /:id` (soft-delete), `GET
  /activos`. `PUT /:id` ahora también permite togglear `activo`.
- **Corrección del bug de numeración** en los 5 archivos: cada uno acepta
  `establecimiento`/`puntoEmision` en el body (fallback a
  `configuracion_sri` si no viene, retrocompatible con integraciones/offline
  que no seleccionan punto de venta), y el cálculo de `maxEnBD` ahora filtra
  por ese par — verificado con un script ad-hoc (transacción con rollback)
  que dos puntos de venta numeran de forma independiente y consecutiva sin
  pisarse (Matriz: 1,2,3,4 con una Sucursal Norte intercalada en 1,2 — cada
  una mantiene su propia secuencia).
- Permiso `sucursales.gestionar` agregado en `backend/utils/roles.js` **y**
  en su copia duplicada `frontend/src/utils/roles.js` (el frontend
  mantiene su propio mapa de permisos por rol, separado del backend).

### Frontend

- **Página nueva** "Sucursales y Puntos de Venta"
  (`frontend/src/components/Configuracion/Sucursales.jsx`, ruta
  `/configuracion/sucursales`, entrada en el menú de Configuración) — crear
  sucursales, y dentro de cada una, agregar/desactivar sus puntos de venta.
- **`SelectorPuntoVenta.jsx`** (componente reutilizable,
  `frontend/src/components/shared/`): cotiza `GET /puntos-emision/activos`,
  persiste la elección en `localStorage` (`aela_punto_venta_activo`), y
  notifica al padre vía `onChange` — incluso con 1 solo punto (para que el
  padre siempre tenga el establecimiento/puntoEmision a incluir en el
  payload). **Se oculta visualmente si hay 0 o 1 punto de venta** — los
  tenants de una sola caja no ven ningún cambio en la UI.
- Integrado en `PuntoVenta.jsx` (POS, factura y nota de venta),
  `FormFactura.jsx`, y `FormGuiaRemision.jsx` (reemplazando los 2 inputs de
  texto libre de 3 dígitos que tenía antes, solo para creación nueva — en
  edición se mantienen los inputs originales para no reasignar el punto de
  una guía ya emitida).

---

## Verificación realizada

- Migración aplicada limpiamente contra la BD de desarrollo local
  (`prisma migrate deploy`, ya que `migrate dev` requiere terminal
  interactiva no disponible en este entorno).
- `applySchemaFixes.js` corrido localmente **dos veces seguidas** (143
  sentencias, 0 advertencias la segunda vez) — confirma idempotencia real,
  no solo teórica.
- Backfill de establecimiento/puntoEmision verificado contra datos reales
  de desarrollo: una factura histórica con número `002-002-000000002` pasó
  de columnas `001/001` (default) a `002/002` (correcto) tras el backfill.
- Numeración multi-punto de venta verificada con script ad-hoc (transacción
  con rollback, sin dejar datos de prueba): 2 sucursales + 2 puntos de
  venta, facturas intercaladas entre ambos, cada uno mantiene su propia
  secuencia consecutiva sin pisarse.
- `npx vite build` limpio, incluyendo los 2 componentes nuevos
  (`Sucursales`, `SelectorPuntoVenta`) compilados en chunks separados.
- Backend reiniciado (nodemon) sin errores tras cada cambio; `GET
  /api/health` responde `ok` en todo momento; rutas nuevas confirmadas
  montadas correctamente (401 "no autorizado", no 404 "no existe").
- **No probado**: flujo completo en navegador (login real, crear sucursal
  desde la UI, facturar desde 2 cajas distintas visualmente) — todo lo
  anterior es verificación de backend/datos, no de UI end-to-end. Ver
  checklist al inicio de este documento.

---

## Pendiente — Fases 2, 3 y 4 (sesiones futuras)

### Fase 2 — Caja Diaria independiente por Punto de Venta

`cajas_diarias.@@unique([empresaId, fechaOperacion])` → agregar
`puntoVentaId` (nullable al inicio, backfill al punto de venta default) y
cambiar a `@@unique([empresaId, puntoVentaId, fechaOperacion])`.
`backend/utils/caja.js` y `backend/routes/caja.js` necesitan recibir
`puntoVentaId` en apertura/movimientos/cierre/historial. Todos los
callers de `registrarMovimientoCaja()` (ventas desde POS/Facturación, ya
tienen el punto de venta activo disponible desde esta sesión) deben
propagarlo. `CajaDiaria.jsx` necesita el selector + probablemente una vista
tipo "tablero" si hay varias cajas simultáneas. Revisar también
`backend/routes/sync.js` (offline) y el dashboard de `empresas.js` (hoy
asume una sola caja abierta por día).

### Fase 3 — Stock por Sucursal

Tabla nueva `stock_sucursal` (productoId, sucursalId, stockActual,
stockMinimo), aditiva — mantener `productos_servicios.stockActual` como
agregado sincronizado para no romper los ~10 sitios que hoy leen el stock
consolidado (reportes, alertas, dashboard con SQL crudo). Actualizar
`aplicarMovimientoInventario()` y sus callers (`compras.js`, `buzon.js`,
`comprasInventario.js`, ventas) para resolver y pasar `sucursalId`.

### Fase 4 — Reportes por sucursal

Filtro y columna de sucursal/punto de venta en reportes de ventas (ya
trivial, los documentos ya guardan establecimiento/puntoEmision desde esta
sesión), caja, e inventario (probablemente requiere agregar `sucursalId` a
`movimientos_inventario` en Fase 3 para poder filtrar el histórico).

---

## Cola de tareas de la sesión (sin empezar todavía)

- Rediseñar/actualizar la landing page con los planes nuevos (cards de
  precios compartidas por el usuario, estilo "593 Sistemas" como
  referencia) — pedido explícitamente para después de esta feature.
