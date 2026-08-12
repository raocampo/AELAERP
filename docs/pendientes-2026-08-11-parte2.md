# AELA ERP — Sesión 2026-08-11 (continuación) — Bug crítico de fecha en producción + auditoría req.prisma

## Contexto

El usuario reportó, con logs reales de Railway y 2 capturas: el POS mostraba
la fecha 12/08/2026 cuando el día real era 11/08/2026, una factura fue
rechazada por el SRI con "FECHA EMISION EXTEMPORANEA", y en el tenant "sys"
la lista de Facturación muestra la 002 pero no la 001.

## 1. Bug real y corregido: fecha del POS en UTC quemaba secuenciales (commit `34faa61`)

**Causa raíz**: `PuntoVenta.jsx` calculaba la fecha por defecto del POS con
`new Date().toISOString().slice(0, 10)`. `toISOString()` siempre devuelve
la fecha en **UTC**, nunca en hora local. Con Ecuador en UTC-5, a partir de
las 19:00 hora local ese cálculo ya muestra el día **siguiente** — se
confirmó en vivo durante esta sesión (21:35 hora Ecuador, UTC ya estaba en
12/08 mientras Ecuador seguía en 11/08).

Resultado: el POS emitía la factura con fecha de "mañana". El SRI la
rechaza de inmediato (un comprobante no puede tener fecha futura,
transmisión inmediata desde 2026-01-01) — pero el secuencial ya se había
consumido antes del rechazo y no se puede reutilizar. Esto explica muy
probablemente por qué la factura 001 "no aparece": lo más probable es que
también haya sido rechazada por el mismo motivo, con el mismo síntoma que
la 002 (visible con estado "Rechazado" en la captura compartida) — **no se
pudo confirmar contra la BD real de "sys"** porque este entorno no tiene
configurado el acceso a producción (`DATABASE_PUBLIC_URL` de Railway); si
se quiere confirmar el estado exacto de la 001, se necesitan esas
credenciales.

**Ya existían utilidades pensadas exactamente para este problema, nunca
aplicadas donde hacía falta**: `frontend/src/utils/fecha.js` tenía
`hoyLocal()` (comentario propio: *"PROBLEMA: new Date(...) parsea como
UTC medianoche... SOLUCIÓN: usar hora local"*) y `backend/utils/fechas.js`
tenía `fechaHoyEC()` — ninguna de las dos se usaba en el flujo de emisión
del POS ni en la validación del backend.

**Fix**:
- Frontend: `PuntoVenta.jsx` usa `hoyLocal()`/`fechaLocalOffset()` en vez
  de `toISOString()` para fechaEmision, min y max del selector.
- Backend: la validación de `POST /facturas` (máximo 3 días de atraso, sin
  fechas futuras) ahora compara por **día calendario en Ecuador**
  (`diaCalendarioEC()`/`fechaECOffset()`, nuevas en `utils/fechas.js`) en
  vez de milisegundos UTC crudos — Railway corre en UTC, así que la
  comparación anterior podía dejar pasar una fecha que el SRI sí iba a
  rechazar. Además, la validación se adelantó para correr **antes** de
  consumir el secuencial (mismo patrón que las demás validaciones del
  endpoint), para no quemarlo también en un rechazo de nuestra propia
  validación.

**Verificado**: con Playwright y `timezoneId: 'America/Guayaquil'`, en el
momento exacto del bug real (no simulado) — el POS pasó de mostrar
12/08/2026 a 11/08/2026. Por HTTP: `POST /facturas` con fecha "mañana" se
rechaza con 400 y el secuencial NO se incrementa (antes sí); con fecha de
hoy, pasa y crea correctamente (201). `node --test`: 38/38.

## 2. Bug real y corregido: `req.prisma` undefined en 8 rutas más (mismo commit)

Los logs de Railway también mostraban `GET /contabilidad/plan-cuentas/estado`
y `/configuracion-asientos` con `TypeError: Cannot read properties of
undefined` — el mismo bug que ya se había corregido en `impresora.js` el
2026-08-02 (`req.prisma` solo existe cuando `resolverTenant` resuelve un
tenant por subdominio SaaS; en monoinstancia/cliente directo queda
`undefined`).

Se auditó **todo** el backend por el mismo patrón:
- `contabilidad.js`: 6 de 8 usos sin el fallback `|| prisma` — corregidos.
- `anticipos.js`, `cajaChica.js`, `cxc.js`, `cxp.js`: **sin ninguna
  protección** — Cuentas por Cobrar, Cuentas por Pagar, Caja Chica y
  Anticipos estaban completamente rotos en monoinstancia. Se agregó el
  guard a nivel de router (mismo patrón que ya usa `empresas.js`).
- `clientes.js`, `proveedores.js`: 1 línea suelta cada uno.
- `facturas.js`: 4 líneas sin el fallback que el resto del archivo ya
  tenía.

Confirmado que `auth.js`, `empresas.js` y `proformas.js` ya tenían el guard
correcto (sin cambios). `external.js` (WebService AVALAB) no lo necesita:
su propio middleware de API key asigna `req.prisma` explícitamente o
devuelve 503 en monoinstancia por diseño — nunca queda undefined ahí.

**Impacto real**: cualquier cliente directo (monoinstancia — Railway
dedicado, sin SaaS) que use Cuentas por Cobrar, Cuentas por Pagar, Caja
Chica o Anticipos estaba recibiendo un error genérico al abrir esos
módulos, sin poder usarlos en absoluto.

**Verificado** por HTTP contra `scfi_dev` real en modo monoinstancia: los 6
endpoints antes rotos ahora responden 200.

## 3. Otros errores en los logs compartidos — no son bugs nuevos

- `Unique constraint failed on the fields: (username)` / `Argument id is
  missing` al crear un usuario: ya corregido hoy más temprano en la sesión
  anterior (`63adddd`, ver `docs/pendientes-2026-08-11.md`) — bug de
  scoping de `empresaId` entre `try`/`catch` en `POST /usuarios`.
- `Error: Stock insuficiente para COCA-COLA E 1250 GRB. Disponible: 1`:
  **no es un bug** — es la validación normal del sistema impidiendo vender
  más unidades de las que hay en inventario. Comportamiento esperado.

## 🔴 Pendiente, necesita que el usuario decida

**Confirmar el estado exacto de la factura 001 en el tenant "sys"** — este
entorno no tiene configurado el acceso a la BD de producción de ese tenant
(`DATABASE_PUBLIC_URL` de Railway — ver memoria persistente
`infra_tenant_db_access` para el procedimiento ya documentado).
Si el usuario comparte esa URL (Railway → proyecto → Postgres → Variables),
se puede confirmar si la 001 quedó como "Rechazado" (visible, mismo caso
que la 002) o si no llegó a grabarse en absoluto (secuencial quemado sin
fila en la tabla — no recuperable, pero sí explicable). Sin esas
credenciales, la explicación de arriba es la hipótesis mejor sustentada por
el código, no una confirmación directa.

## Commits de esta sesión (2026-08-11, continuación)
`34faa61` fix fecha POS UTC + req.prisma en 8 rutas.

`node --test`: 38/38. `vite build`: sin errores.
