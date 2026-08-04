# AELA ERP — Sesión 2026-08-04 — Auditoría completa del filtro `estadoSri`

## Contexto

Continuación del punto 2 pendiente de `docs/pendientes-2026-08-03.md`: "Auditar
el resto del código por el mismo patrón" del bug del Dashboard (`af12c3a`,
2026-08-03) — queries que suman `facturas`/`notas_credito`/`liquidaciones_compra`
sin filtrar `estadoSri`, contando documentos RECHAZADOS o atascados en
PENDIENTE_FIRMA/ENVIADO/ERROR como si fueran ventas reales.

## Bugs reales encontrados y corregidos (commit `58db3d7`)

Se auditaron **todos** los usos de `.aggregate()`/`.count()`/`.findMany()` sobre
`facturas`, `notas_credito`, `liquidaciones_compra` y `retenciones` en todo
`backend/` (rutas + `utils/colaSRI.js`). Se encontraron 2 archivos con el
mismo bug, ninguno de los cuales había sido tocado por el fix del Dashboard:

### 1. `backend/routes/declaraciones.js` — Formularios 104 y 101
- F104 ventas: `facturas.findMany` (+ su `notas_credito` anidada) sin filtro.
- F104 liquidaciones: `liquidaciones_compra.findMany` sin filtro.
- F101 (IR anual): `facturas.aggregate` sin filtro.
- `/disponibles` (selector de períodos): `facturas.groupBy` sin filtro.

### 2. `backend/routes/facturas.js` — `GET /reportes/tributario`
Este es el endpoint real que consume la página **Reportes Tributarios** del
frontend (`ReportesTributarios.jsx`) — un endpoint totalmente distinto a
`declaraciones.js`, así que el fix del punto 1 no lo cubría. Faltaba el
filtro en las 4 queries que arman el resumen: `facturas`, `notasCredito`,
`retenciones` y `liquidaciones`.

**Fix aplicado** (mismo criterio ya usado en el Dashboard y en `ats.js`/`cxc.js`,
que sí filtraban correctamente):
- `facturas`/`liquidaciones` con estado válido: `AUTORIZADO` o `HISTORICO`
  (venta real importada de un período anterior, sin flujo SRI).
- `notas_credito`/`retenciones`: solo `AUTORIZADO` (no aplica `HISTORICO`).

**Verificado contra datos reales** (empresa Corp Simtelec, `aela_db` local):
existían 2 facturas de mayo/2026 por $241.50 cada una a la misma clienta, una
AUTORIZADA y otra RECHAZADA. Antes del fix, tanto `declaraciones.js` como
`facturas.js /reportes/tributario` sumaban **$483.00** (duplicando la
rechazada); después del fix, ambos reportan correctamente **$241.50**.
`node --test`: 29/29. `vite build`: sin errores.

## Confirmado SIN bug (ya filtraban correctamente, no se tocó nada)

- `backend/routes/ats.js` (Anexo Transaccional Simplificado) — todas las
  queries de ventas ya filtran `estadoSri: 'AUTORIZADO'`.
- `backend/routes/cxc.js` (Cuentas por Cobrar) — las 5 queries de facturas
  (`/vigentes`, `/canceladas`, `/reporte/antiguedad`, `/reporte/estado-cuenta`
  x2) ya filtran `estadoSri: 'AUTORIZADO'`.
- `backend/routes/empresas.js` (`/estadisticas`, Dashboard) — ya corregido el
  2026-08-03 en `af12c3a`.
- `backend/utils/colaSRI.js` (worker de reintento + contador de pendientes
  para el badge del frontend) y `backend/routes/sync.js` (`/estado`) —
  consultan `estadoSri: 'PENDIENTE_FIRMA'`/`'FIRMADO_PENDIENTE_ENVIO'` a
  propósito (es su función: encontrar lo que falta procesar), no es el mismo
  bug.
- `backend/routes/facturas.js` — listados/exports (`GET /`, `/exportar/pdf`,
  `/exportar/xlsx`, "Libro de Ventas"): son ledgers filtrables por el usuario
  que muestran el estado por fila (columna "Estado SRI" visible) en vez de
  ocultarlo detrás de un total agregado — no es el mismo patrón de bug
  (KPI/reporte que oculta el estado y sólo muestra un número).

## Conclusión

La auditoría del punto 2 de `pendientes-2026-08-03.md` queda **cerrada**. El
patrón del bug del Dashboard existía en 2 lugares más (ambos con impacto
directo en los formularios de declaración de impuestos reales, F104/F101, más
grave que el bug original del Dashboard que solo afectaba una tarjeta
informativa) y ya están corregidos y verificados.

## Commit de esta sesión
`58db3d7` fix reportes tributarios y declaraciones — facturas rechazadas
contadas como ventas.

## Pendientes que siguen abiertos (sin cambios desde el 2026-08-03)
Ver la lista consolidada "🔴 PARA RETOMAR" en `docs/pendientes-2026-08-03.md`,
puntos 1, 3, 4, 5, 6, 7, 8, 9 (el punto 2 de esa lista es el que este
documento cierra).
