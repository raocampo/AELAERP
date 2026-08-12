# AELA ERP — Sesión 2026-08-12 — Bug arquitectónico: el worker de reintentos SRI nunca veía las BD de tenants SaaS

## Contexto

Continuación directa de `docs/pendientes-2026-08-11-parte2.md` (punto 7): la
factura 001-001-000000003 (id=4, tenant "sys") quedó en `FIRMADO_PENDIENTE_ENVIO`
por un `ECONNRESET` transitorio al transmitirla al SRI. Se resolvió al momento
con un reintento manual vía `POST /facturas/4/reenviar`, y en ese momento se
documentó como "comportamiento esperado, hay un worker que reintenta cada 2
minutos". El usuario hizo notar que pasaron más de 2 minutos sin que el
worker la resolviera solo — esa observación llevó a encontrar el bug real.

## Bug real encontrado: el worker `colaSRI.js` solo veía la BD por defecto de cada instancia de Railway

`backend/utils/colaSRI.js` corre con `setInterval` cada 2 minutos, **fuera de
cualquier request HTTP**. Usaba el `prisma` de `config/prisma.js` — un Proxy
"context-aware" que delega al cliente Prisma del tenant activo en
`AsyncLocalStorage`, pero esa variable de contexto solo se llena dentro del
middleware `resolverTenant` de un request real. Como el worker nunca corre
dentro de un request, `_storage.getStore()` siempre era `undefined` y el
Proxy caía siempre al cliente **global** — la BD configurada en el
`DATABASE_URL` de esa instancia de Railway específica (para el backend SaaS
compartido, la BD "default"; nunca `aela_sys` ni la de ningún otro tenant
resuelto por `x-tenant-slug`).

**Consecuencia real**: cualquier tenant SaaS resuelto por slug (como "sys")
nunca recibía reintentos automáticos de comprobantes en
`FIRMADO_PENDIENTE_ENVIO` — sin importar cuánto tiempo pasara. Un error de
red transitorio hacia el SRI (frecuente, el SRI es notoriamente inestable)
dejaba el comprobante colgado indefinidamente hasta que alguien lo
reenviara a mano desde la UI o por API. El texto del badge del sidebar
("Se enviarán cuando vuelva el internet") además es engañoso en este caso:
no es la conexión del negocio, es Railway→SRI, y "esperar a que vuelva el
internet" nunca iba a resolver nada porque el worker ni siquiera estaba
mirando esa factura.

## Fix

**`backend/config/prisma.js`**:
- `runWithClient(client, fn)` ahora hace `return _storage.run(client, fn)`
  (antes no retornaba nada) — necesario para poder `await`arlo desde el
  worker y procesar los tenants secuencialmente.
- Nuevo `getActiveClient()` — devuelve el cliente Prisma activo en el
  contexto actual (el del tenant, o el global). Necesario para que
  `colaSRI.js` pueda cachear datos por-base-de-datos correctamente (ver
  bug secundario abajo).
- **Bug encontrado y corregido en el propio fix, antes de llegar a
  producción**: `runWithClient`/`getActiveClient`/`_globalClient` se habían
  agregado como propiedades normales del Proxy, así que quedaban sujetos al
  mismo `get` trap que delega al cliente activo — lo cual significa que
  **llamarlas desde DENTRO de un contexto ya activo** (exactamente lo que
  necesita hacer `colaSRI.js` al procesar un tenant) fallaba con "no es una
  función", porque el trap buscaba esas propiedades en el PrismaClient real
  del tenant en vez de en el wrapper. Se corrigió agregando un caso especial
  en el `get` del Proxy para esas 3 propiedades, para que resuelvan siempre
  al wrapper sin importar el contexto activo. Verificado con un script que
  prueba anidamiento real (contexto A → dentro, contexto B anidado → sale,
  vuelve a A → sale, vuelve a global).

**`backend/utils/colaSRI.js`**:
- El cuerpo de `ejecutarCiclo()` se movió a una función nueva
  `procesarPendientesEnDB()` que opera sobre lo que sea que el proxy
  `prisma` tenga activo en ese momento.
- `ejecutarCiclo()` ahora: 1) corre `procesarPendientesEnDB()` sobre la BD
  global/default (compatibilidad total con monoinstancia — sin cambios de
  comportamiento ahí), y 2) si el backend tiene modo SaaS activo
  (`getPrismaMaster()` no es null, i.e. `DATABASE_MASTER_URL` configurada),
  recorre `master.tenants.findMany({ where: { estado: 'activo' } })` y para
  cada uno llama `getTenantPrisma(tenant)` + `prisma.runWithClient(cliente,
  procesarPendientesEnDB)`. Los despliegues monoinstancia puros (sin
  `DATABASE_MASTER_URL`, ej. Puchaicela, Comercial S&S si están en su propio
  Railway) no ven ningún cambio de comportamiento — `getPrismaMaster()`
  devuelve `null` ahí y el loop de tenants simplemente no se ejecuta.

**Bug secundario encontrado y corregido de paso** (el propio recorrido por
tenants lo iba a exponer): `getConfigSRI(empresaId)` cacheaba la
configuración SRI (certificado, RUC, ambiente) en un `Map` indexado
**solo por `empresaId`** — pero `empresaId` NO es único entre tenants, cada
BD de tenant numera sus empresas desde 1. Con el worker recorriendo varias
BDs en el mismo proceso, el caché iba a mezclar el certificado de un tenant
con el de otro tenant que casualmente tuviera el mismo `empresaId` (muy
probable, casi todos los tenants monoempresa tienen `empresaId=1`) —
firmando/transmitiendo con el certificado equivocado. Se corrigió anidando
el caché por identidad del cliente Prisma activo
(`Map<cliente, Map<empresaId, config>>`), usando el nuevo `getActiveClient()`.

## Verificado

- `node --test`: 38/38.
- Prueba real de anidamiento de contexto en `config/prisma.js` (contexto
  dentro de contexto, con awaits reales entre medio) — pasó.
- Prueba end-to-end real: se creó un tenant temporal en `scfi_master.tenants`
  apuntando a la misma BD local (`scfi_dev`), se corrió `ejecutarCiclo()`
  completo manualmente — procesó la BD global y luego la del tenant de
  prueba sin lanzar ninguna excepción (incluyendo `getTenantPrisma()`
  conectando de verdad y corriendo `applySchemaFixes` contra esa BD).
  Tenant de prueba eliminado al terminar.
- Reinicio real del backend local (`node server.js`): arrancó limpio,
  `[ColaSRI] Worker iniciado`, y su primer ciclo automático (a los 30s)
  corrió sin errores contra la BD global (0 tenants activos en local en ese
  momento, ya se había limpiado el de prueba).

## Para el usuario

Con este fix desplegado, cualquier factura/retención/liquidación/nota de
crédito/nota de débito de **cualquier tenant SaaS** (no solo "sys") que
quede `FIRMADO_PENDIENTE_ENVIO` por un corte de red transitorio hacia el SRI
ahora sí se va a reintentar sola cada 2 minutos, sin necesitar intervención
manual. Si vuelve a pasar que un comprobante queda pendiente más de unos
minutos después de este fix, ya no es "hay que esperar" — vale la pena
avisar, porque significaría que hay algo distinto pasando (el SRI caído por
más tiempo del normal, un problema con el certificado de ese tenant, etc.).

**Calibración honesta sobre qué tan probado quedó esto**: lo que se verificó
fue el mecanismo (el worker recorre las BDs correctamente, sin choques entre
tenants, sin errores al arrancar). Lo que **no** se pudo observar en vivo es
el caso real completo — una factura de un tenant SaaS quedando pendiente en
producción y el worker resolviéndola solo a los 2 minutos — porque en el
momento de probar no había ninguna factura realmente pendiente (ya se había
resuelto la única que existía, la de "sys", a mano). La prueba de fuego real
va a ser la próxima vez que le pase un corte transitorio hacia el SRI a
cualquier tenant.

## Cierre de sesión 2026-08-12 — pendientes para retomar mañana desde la oficina

### Resumen del día
Un solo hilo, arrancado por una observación del usuario ("pasaron más de 2
minutos y no se autorizaba sola") sobre el cierre del día anterior — llevó a
encontrar y corregir un bug arquitectónico real que afectaba a **todos los
tenants SaaS**, no solo al que lo disparó. Commit `904de64`. `node --test`:
38/38 en todas las verificaciones del día.

### 🔴 Pendientes para mañana

1. **Validación de campo pendiente** (ver calibración arriba): la próxima
   vez que a cualquier tenant SaaS le pase un corte transitorio hacia el
   SRI, confirmar que el comprobante se autoriza solo en ~2 minutos sin
   intervención manual. Si no pasa, es prioritario — el bug de fondo sería
   distinto al que se corrigió hoy.
2. Nada más generado hoy. El backlog general de sesiones previas sigue
   abierto sin tocar: gating móvil sin verificar en emulador, Buzón SRI/
   Puppeteer en Railway (timeout+reorden sin confirmar), 16 registros de
   Puchaicela esperando a la contadora, auditar si el patrón `rgba()` sin
   capa sólida en modo oscuro se repite en otros componentes (desde 08-07),
   backlog "más PRO" (Anexo RDEP, F101 completo, Anticipo IR).
3. **Patrón a vigilar** (heredado de ayer, sigue vigente): cualquier factura
   RECHAZADO/no autorizada que quede sin anular deja inventario descontado
   de forma fantasma — revisar antes de asumir error de captura si un
   cliente reporta stock bajo o en 0 "sin razón aparente".
