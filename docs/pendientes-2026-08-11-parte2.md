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

## 4. Confirmado contra producción real (`aela_sys`, empresaId=1 "DIANA FERNANDA SUCUNUTA ALBAN")

El usuario compartió las credenciales (`.env.local`, conexión externa de
Railway). Consulta directa, de solo lectura, contra `aela_sys`:

- **Solo existe 1 fila en `facturas`** para esta empresa: `id=3`,
  `numeroFactura` 001-001-**000000002**, `fechaEmision`
  **2026-08-12T05:00:00.000Z** (la fecha "de mañana" que causó el bug),
  `estadoSri` RECHAZADO, con el mensaje SRI exacto ya conocido (identificador
  65, FECHA EMISION EXTEMPORANEA).
- **No existe ninguna fila para el secuencial 000000001.** No es un
  problema de filtro/paginación en la lista — la factura 001 nunca llegó a
  grabarse en la base de datos.
- `puntos_emision.ultimoSecuencialFactura` = **2**, confirmando que el
  contador atómico si se incrementó dos veces (dos intentos reales), pero
  solo el segundo produjo una fila.
- Tabla `auditoria` vacía para esta empresa — sin rastro adicional del
  primer intento.

**Conclusión**: el secuencial 001 se consumió (incremento atómico, antes de
cualquier validación) en un primer intento que **nunca llegó a crear la
factura** — muy probablemente rechazado por la validación local de fecha
del propio backend (la versión vieja, con la comparación en milisegundos
UTC) antes de intentar grabar nada. El segundo intento (002) sí pasó esa
validación vieja (la diferencia en milisegundos puede ser chica cerca del
cambio de día UTC, aunque el día calendario en Ecuador ya sea distinto — es
justo la inconsistencia que corrigió el fix de hoy) y llegó hasta el SRI,
que sí la rechazó por día calendario.

**No es recuperable**: ambos secuenciales (001 y 002) quedan permanentemente
inutilizables — ninguna factura real usó el 001, y el 002 quedó marcado
RECHAZADO de forma irreversible ante el SRI. **Acción para el usuario**:
emitir una factura nueva (saldrá con el secuencial 003) para esa venta de
$41.20 a Diana Gabriela Sucunuta Albán — con el fix ya desplegado, debería
salir bien esta vez. Confirmar que el deploy en Railway ya tomó el commit
`34faa61` antes de reintentar.

## 5. Consultado por el usuario: vender con stock negativo a criterio del dueño — YA EXISTÍA, sin cambios de código

El usuario pidió poder vender con stock negativo cuando el dueño lo decida
(ej. se olvidó de registrar stock nuevo). Antes de implementar nada se
revisó si ya estaba cubierto — **sí, completo y funcionando**:

- Backend: `utils/inventario.js` — `aplicarMovimientoInventario()` solo
  bloquea la venta si `!config.permitirStockNegativo && stockNuevo < 0`;
  si el flag está activo, deja pasar el movimiento y el stock queda en
  negativo. Ya conectado desde `POST /facturas` (y notas de venta, mismo
  código compartido `aplicarMovimientosVentaDesdeDetalles`).
- Configuración: `configuracion_sistema.permitirStockNegativo`
  (`backend/utils/configuracionSistema.js`), persistido vía
  `PUT /configuracion-sistema` — requiere permiso `sistema.configurar`
  (admin), consistente con "a criterio del dueño".
- Frontend: checkbox **"Permitir ventas con stock negativo"** en
  Configuración → Config Sistema → sección Inventario, justo debajo de
  "Habilitar control de inventario" (deshabilitado si el inventario está
  apagado).

**Verificado en navegador real**: con el toggle apagado (default), vender 5
unidades de un producto con 1 en stock devuelve 400 "Stock insuficiente...
Disponible: 1". Se activó el checkbox desde la UI real (Playwright),
guardado confirmado con el toast "Configuración del sistema actualizada".
Repetida la misma venta: 201, factura creada, stock del producto queda en
**-4** (1 - 5), exactamente como se espera. Datos de prueba eliminados y
`permitirStockNegativo` revertido a `false` al terminar.

**Para el usuario**: la opción ya está en Configuración → Config Sistema →
Inventario. Actívala cuando haga falta vender sin stock suficiente — el
sistema deja constancia igual en `movimientos_inventario`, así que después
se puede ver qué ventas dejaron el stock en negativo para corregirlo.

## 6. Acción tomada en producción: se anuló la factura 002 (RECHAZADO) para restaurar stock

Al confirmar el punto 4, se detectó el problema real detrás del pedido de "vender con
stock negativo" del punto 5: la factura 001-001-000000002 (RECHAZADO) sí había
descontado inventario real al crearse — el descuento ocurre en la misma transacción
que crea la factura (`aplicarMovimientosVentaDesdeDetalles`, `facturas.js` línea 1174),
**antes** de que se sepa si el SRI la va a aceptar o rechazar (`procesarFacturaEnSRI` se
llama después, en background). Como la factura nunca se anuló, ese descuento nunca se
revirtió.

**Impacto confirmado contra la BD real (`aela_sys`)**: 31 productos con stock
descontado de forma fantasma, 6 de ellos en **stock 0** sin serlo realmente:
COCA-COLA E 1250 GRB, LECHS CHOCO TPK NATURA 750ML, QUESILLO LB, CLOROX ROPA 250 ML,
TE DE MANZANILLA 25 BOL, NESTLE TANGO ORIGINAL 25G. Los otros 25 con 1-3 unidades de
diferencia (LECHE EL RANCHITO -3, DASANI 1.2L -2, POLLO LB -2, etc.).

**Solución**: el sistema ya tiene el mecanismo correcto para esto — `POST
/facturas/:id/anular` (`facturas.js` línea 1288). Para facturas no autorizadas por el
SRI (como esta, RECHAZADO) no requiere Nota de Crédito: solo marca `ANULADO` y revierte
inventario + caja en la misma transacción (además intenta un asiento contable reverso,
best-effort).

**Ejecutado contra producción real**, con autorización explícita del usuario, vía el
endpoint real desplegado (no SQL manual, para no saltarse la lógica de negocio ni el
rastro de auditoría):
1. Login real contra `POST https://aelaerp-production.up.railway.app/api/auth/login`
   con header `x-tenant-slug: sys` y credenciales del propio usuario (admin, empresaId=1).
2. `POST /api/facturas/3/anular` con motivo explicando el rechazo SRI y la corrección
   del bug de fecha ⇒ `200 OK`, `"mensaje":"Factura anulada correctamente (no estaba
   autorizada en el SRI)."`.

**Verificado de nuevo contra la BD real** tras la anulación:
- 31 movimientos `ANULACION_FACTURA` nuevos, uno por cada `VENTA_FACTURA` original
  (62 movimientos totales para la referencia `001-001-000000002`).
- Los 6 productos que estaban en 0 ya muestran su stock real (1, 1, 1, 1, 1, 2).
- `facturas.id=3`: `estadoSri=ANULADO`, `anulada=true`.
- `puntos_emision.ultimoSecuencialFactura` sigue en **2** (correcto — el secuencial no
  se reutiliza, solo queda liberado el inventario).

**Para el usuario**: el stock de esos 31 productos ya está correcto. La próxima factura
por esa venta de $41.20 a Diana Gabriela Sucunuta Albán saldrá con el secuencial 003 y
ya no debería toparse con stock artificialmente bajo.

## Commits de esta sesión (2026-08-11, continuación)
`34faa61` fix fecha POS UTC + req.prisma en 8 rutas.

`node --test`: 38/38. `vite build`: sin errores.

**Acción operativa (no es un commit de código)**: anulación de la factura
001-001-000000002 en producción (`aela_sys`, empresaId=1) vía API real, 2026-08-12,
ver punto 6 arriba.

## Cierre de sesión 2026-08-11 — resumen completo del día y pendientes para mañana

### Resumen de todo lo hecho hoy (2 sesiones/hilos)

**Sesión 1** (`docs/pendientes-2026-08-11.md`, commit `63adddd`): bug real de
scoping `try`/`catch` en `POST /usuarios` — crear un usuario con username ya
usado en OTRA empresa (modo multiempresa/Admin Macro) daba un mensaje
genérico "usuario ya registrado" en vez de ofrecer el modal de reasignación
que el frontend ya sabía mostrar. `empresaId` se declaraba con `const`
dentro del `try`, invisible en el `catch` sibling → `ReferenceError`
silencioso atrapado por un catch interno. Fix: mover la declaración fuera
del `try`. Verificado end-to-end en local.

**Sesión 2** (este archivo, commits `34faa61`, `db4416d`, `6e8af4b`,
`6718683`, `0e83fc9`):
1. **Bug crítico corregido**: POS mostraba la fecha de "mañana" después de
   las 19:00 hora Ecuador (`toISOString()` es UTC) — el SRI rechazaba la
   factura por fecha futura y el secuencial se quemaba igual. Fix en
   frontend (`hoyLocal()`) y backend (comparación por día calendario
   Ecuador, movida antes de consumir el secuencial).
2. **Auditoría completa de `req.prisma` undefined** en modo monoinstancia:
   Cuentas por Cobrar, Cuentas por Pagar, Caja Chica y Anticipos estaban
   **completamente rotos** para cualquier cliente directo — corregidos los
   4, más líneas sueltas en `contabilidad.js`/`clientes.js`/`proveedores.js`/
   `facturas.js`.
3. **Confirmado contra producción real** (`aela_sys`): la factura 001 nunca
   grabó fila (secuencial quemado antes del INSERT); la 002 quedó RECHAZADO
   por el SRI con el mismo bug de fecha.
4. **Verificado que "vender con stock negativo a criterio del dueño" ya
   existía** — toggle `permitirStockNegativo` en Configuración → Config
   Sistema → Inventario, sin cambios de código necesarios.
5. **Encontrada y corregida la causa real** de por qué hacía falta esa
   opción en este caso puntual: la factura 002 (RECHAZADO) había descontado
   inventario real de 31 productos al crearse, sin revertirlo nunca (6 en
   stock 0 sin serlo). **Anulada en producción** vía el endpoint real
   (`POST /facturas/3/anular`, login real con `x-tenant-slug: sys`) —
   verificado que el stock de los 31 productos quedó restaurado.

`node --test`: 38/38 en ambas sesiones. `vite build`: sin errores.

### ✅ Confirmado por el usuario 2026-08-12 (los 3 pendientes de verificación de campo)

1. **Fix de usuario en modo multiempresa confirmado en producción real**:
   el usuario ya se pudo crear en "Deportivo CAT" (antes "CAT DISEÑO
   DEPORTI..."). Cierra el pendiente de `63adddd` — el fix del bug de
   scoping `try`/`catch` en `POST /usuarios` funciona también fuera de
   local.
2. **Comercial S&S subió la plantilla real de productos** desde Productos →
   Importación. Cierra el pendiente del fix de precios truncados/notación
   científica (commits del 08-10). No se revisó desde aquí si de los 6
   códigos duplicados esperados quedó algo pendiente para el usuario — a
   confirmar si hace falta en una próxima sesión.
3. **Los 3 productos `RESTAURAR-1/2/3`** ya están corregidos con su código,
   precio y costo reales — cierra el pendiente abierto desde el incidente
   del 08-10.

### 🔴 Pendientes para retomar mañana desde la oficina

1. **Emitir la factura real de $41.20** a Diana Gabriela Sucunuta Albán en
   el tenant "sys" — saldrá como secuencial 003, con el fix de fecha ya
   desplegado y el stock de los 31 productos ya restaurado. Confirmar que
   sale bien (AUTORIZADO).
2. Backlog general sin tocar hoy: gating móvil sin verificar en emulador,
   Buzón SRI/Puppeteer en Railway (timeout+reorden sin confirmar), 16
   registros de Puchaicela esperando a la contadora, auditar si el patrón
   `rgba()` sin capa sólida en modo oscuro se repite en otros componentes
   (pendiente desde 08-07), backlog "más PRO" (Anexo RDEP, F101 completo,
   Anticipo IR).
3. **Patrón nuevo a vigilar**: cualquier factura RECHAZADO/no autorizada que
   quede sin anular deja inventario descontado de forma fantasma — si un
   cliente reporta stock bajo o en 0 "sin razón aparente", revisar primero
   si hay facturas rechazadas sin anular para ese producto antes de asumir
   error de captura o de importación.
