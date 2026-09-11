# Cierre de sesión 2026-09-10 — Agente Vendedor (Fase 0+1) + 2 hotfix SRI

Continuación de la sesión que empezó el 2026-09-07 (ver los 3 docs
anteriores: `pendientes-2026-09-07-bancos-pos.md`,
`pendientes-2026-09-07-sri-redirect-producto.md`,
`pendientes-2026-09-09-cierre-sesion.md`). Este documento cubre lo de
hoy: dos incidentes más del SRI y el arranque del módulo Agente
Vendedor (Fase 0 y Fase 1 completas).

## Commits de hoy

| Commit | Qué |
|---|---|
| `7d7e3e5` | fix: HTTP 500/5xx del SRI ya no marca ERROR + botón Reenviar en ERROR |
| `26be142` | feat(vendedor): rol "Agente Vendedor" + permisos (Fase 0 backend) |
| `e36b098` | feat(vendedor): app móvil sensible al rol (Fase 0 móvil) |
| `21ebe87` | feat(vendedor): Fase 1 backend — cartera de clientes + scoping |
| `babab0c` | feat(vendedor): Fase 1 web — asignar clientes a un vendedor |
| `9394a52` | feat(vendedor): Fase 1 móvil — pantalla "Mis Clientes" |
| `88eaf67` | docs: roadmap actualizado |

(El commit `c5cc5a9`/`352ebde` del redirect SRI ya venía del día
anterior — ver el doc de esa fecha).

## 1. SRI — segundo y tercer round de hotfixes

**Contexto**: el mismo incidente de infraestructura del SRI (redirect a
`181.113.227.222`) del día anterior siguió dando síntomas nuevos según
la fase del incidente:

1. Primero un 302 con HTML → resuelto el día anterior.
2. Después un 302 con **TLS inválido** al seguir la redirección →
   resuelto el día anterior (dejó de seguir el redirect).
3. Hoy: un **HTTP 500** directo del SRI → `enviarPeticionSoap` lo
   lanzaba sin `err.code`, `esErrorConectividad` no lo reconocía →
   factura a `ERROR`.

**Fix** (`7d7e3e5`): la regla se generalizó — **cualquier** HTTP que no
sea 2xx desde el WS del SRI (`SRI_HTTP_NO_OK`) se trata como
transitorio. Solo un HTTP 200 + SOAP con `<estado>DEVUELTA</estado>` y
mensajes reales es un rechazo definitivo. Además, el botón "🔄 Reenviar
SRI" ahora aparece también para facturas en `ERROR` (antes solo
PENDIENTE_FIRMA/RECHAZADO/ENVIADO) — tanto en el detalle como en el
listado de facturas.

**Resultado**: las 4 facturas del incidente completo (dos días)
quedaron las 4 `AUTORIZADO`. El SRI se recuperó ese mismo día
(confirmado con un GET directo al endpoint → 405, comportamiento
normal, sin redirect).

Ver memoria `bug_sri_redirect_2026_09_07.md` para el detalle técnico
completo de los 3 rounds.

## 2. Módulo Agente Vendedor — Fase 0 y Fase 1 completas

Ver `docs/roadmap-agente-vendedor.md` para el roadmap completo (7
fases) y las decisiones de producto ya tomadas con el usuario
(comisión mixta al facturar+cobrar, pedido no afecta stock, cobro
contra facturas pendientes vía CxC, todo en la misma app móvil con rol
`vendedor`).

**Fase 0 — Fundación**:
- Nuevo rol `vendedor` ("Agente Vendedor") + permisos
  `vendedor.ver`/`vendedor.pedidos`/`vendedor.cobros`/`vendedor.asignar`
  en backend, frontend web, y ahora también móvil
  (`mobile/utils/roles.ts`, nuevo — mantener las 3 copias en sync).
- La app móvil ya distingue el rol: `AuthContext.puede(permiso)`, tabs
  recortados (`hidePOS/Mesas/Inventario/Facturas` para vendedor).
- **Diferido a antes de la Fase 5**: la capa offline genérica
  (`expo-sqlite` + cola de sync, portada de `frontend/src/utils/
  {syncQueue,offlineDB}.js`) — las Fases 1-4 son online, no hace falta
  todavía, y no se puede probar sin una app corriendo.

**Fase 1 — Cartera de clientes asignada**:
- `clientes.vendedorId` (FK a `usuarios`, nullable) en schema +
  `applySchemaFixes.js`.
- `backend/utils/vendedor.js`: `scopeVendedor()`,
  `saldoPendientePorCliente()`, `estadoCuentaCliente()` — mismo cálculo
  de saldo que Cuentas por Cobrar (`importeTotal - cobros - NC`).
- `backend/routes/vendedor.js` (`/api/vendedor`): `GET /clientes`,
  `GET /clientes/:id`, `GET /agentes`, `POST /asignar`.
- Web: columna "Vendedor" + checkboxes + asignación masiva en Gestión
  de Clientes (solo visible con permiso `vendedor.asignar`).
- Móvil: tab "Vendedor" → "Mis Clientes" (lista con saldo) → detalle
  con estado de cuenta (facturas pendientes).

## Verificación

- Backend: 117/117 tests (`npm test`), incluye un script de
  integración real contra Postgres local (empresa de prueba aislada)
  que confirma el scoping: el vendedor ve solo sus 2 clientes
  asignados, 404 al pedir un cliente ajeno, 403 en `/agentes`, saldo
  pendiente calculado correctamente. Datos de prueba borrados al
  terminar.
- Frontend web: `vite build` + `eslint` limpios, 25/25 vitest.
- Móvil: `tsc --noEmit` limpio. **No se probó en dispositivo/emulador**
  — sigue pendiente el tema de Expo Go (ver abajo).

## 🔴 Pendientes para retomar mañana

1. **Expo Go SDK 54 en el teléfono** — sigue sin instalarse (el
   parche rápido elegido el 2026-09-09). Sin esto, ninguna pantalla
   móvil nueva (tabs por rol, "Mis Clientes", detalle) se probó de
   verdad, solo se verificó que compile (`tsc`). Es el bloqueo #1 para
   seguir con confianza en móvil.
2. **Fase 2 del roadmap — Pedidos**: siguiente paso natural. Requiere
   decidir el detalle de implementación (`proformas.vendedorId`, wrapper
   `POST /vendedor/pedidos`, pantalla móvil de nuevo pedido reusando el
   patrón de `pos/index.tsx`). Ver `docs/roadmap-agente-vendedor.md`.
3. **2 casts `as any`/`as Href` en móvil** (`app/(tabs)/vendedor/
   index.tsx`, `context/AuthContext.tsx`) — temporales, porque
   `router.d.ts` (rutas tipadas de expo-router) no conoce todavía la
   carpeta `vendedor/` nueva. Se resuelven solos la primera vez que se
   corra `expo start`/`expo prebuild` en una máquina de desarrollo real
   — no hace falta tocarlos a mano, pero si se quiere limpiar el tipo
   exacto sin el cast, correr `expo start` una vez y volver a
   typecheckear.
4. **Nada de la Fase 1 se probó clic a clic** en navegador ni en
   dispositivo — solo scripts/tsc. Falta: entrar como admin y asignar
   clientes a un vendedor de prueba desde Gestión de Clientes; loguear
   como ese vendedor (web no tiene pantallas de vendedor todavía, solo
   móvil) y ver "Mis Clientes" en el teléfono una vez resuelto el punto
   1.
5. **Deuda ya conocida, sin resolver** (heredada de sesiones previas,
   ver `pendientes-2026-09-09-cierre-sesion.md`): `FormNotaVenta.jsx`
   con la misma limitación de pagos mixtos que se arregló en el POS
   (backend no lee `formaPagoDetalles`); CxC (`cobros_cliente`) con el
   mismo gap que tenía el POS antes de Bancos (no liga movimiento
   bancario); Estadísticas v3 si se pide (top clientes, rango
   personalizado, exportar); módulo móvil de Restaurante/POS/etc.
   siguen sin verificarse en dispositivo real (mismo bloqueo #1).

## Al retomar

`git pull` (o `git fetch` + verificar `origin/main` si el checkout
local muestra muchos archivos "modificados" sin diff real — es ruido
CRLF/LF de la carpeta MEGA, no hay nada que commitear en ese caso).
Revisar este documento + `docs/roadmap-agente-vendedor.md` (estado de
fases). No hay plan pendiente en `C:\Users\USUARIO\.claude\plans\` — el
plan activo cubre el roadmap completo del vendedor y ya está aprobado,
se puede seguir ejecutando fase por fase sin replanificar desde cero.
