# Cierre de sesión 2026-09-11/12 — Agente Vendedor Fases 2, 3, 4 + fixes web/móvil

Continuación de `pendientes-2026-09-10-vendedor-fase0-1-sri.md` (Fases 0
y 1 del módulo Agente Vendedor). Esta sesión arrancó resolviendo el
bloqueo de Expo Go y terminó completando las Fases 2, 3 y 4 del roadmap,
más dos correcciones encontradas al probar con un usuario real.

## Commits de esta sesión

| Commit | Qué |
|---|---|
| `fb6c910` | feat(mobile): menú de cuenta en header (cambiar empresa + cerrar sesión) |
| `b773d13` | feat(vendedor): Fase 2 — Pedidos del vendedor |
| `71a1c96` | docs: roadmap Fase 2 |
| `47bdc0a` | feat(vendedor): gatear el módulo a plan Medium/Pro (o combo) |
| `26e747f` | feat(vendedor): Fase 3 — Cobros en ruta |
| `6baae7f` | docs: roadmap Fase 3 |
| `d5a1ed1` | feat(vendedor): Fase 4 — Comisiones y metas |
| `27c071c` | docs: roadmap Fase 4 |
| `17a7d00` | fix(vendedor): panel web propio + backfill del gate de plan |

## 1. Expo Go SDK 54 — bloqueo resuelto

El teléfono del usuario tenía Expo Go SDK 57 (auto-actualizado por la
Play Store), incompatible con el proyecto (SDK 54). Se ubicó el link
oficial de Expo para instalar la versión correcta:
`https://expo.dev/go?sdkVersion=54&platform=android&device=true`. El
usuario lo instaló y desde entonces prueba la app en su celular real —
confirmó POS/Facturación/Inventario funcionando.

**Hallazgo de paso**: no había forma visible de cerrar sesión (existía,
pero al fondo de Configuración tras hacer scroll por toda la sección de
impresora) ni de cambiar de empresa tras el login. Se agregó un menú
(⋮) en el header de todos los tabs con "Cambiar de empresa" (pantalla
nueva `mobile/app/cambiar-empresa.tsx`) y "Cerrar sesión".

**Técnica reutilizable**: en este entorno, `expo start` en background sí
regenera `router.d.ts` (tipos de rutas) con el file-watcher, sin
necesitar que un dispositivo pida el bundle. Comando exacto:
`CI=1 npx expo start --lan --port 8082` (el flag `--non-interactive` no
existe; usar `--port` explícito porque 8081/8082 suelen quedar
"ocupados" por intentos previos). El proceso se cae solo cada cierto
tiempo en este entorno (exit 1 sin mensaje, incluso sirviendo bundles
con éxito) — hay que reiniciarlo con el mismo comando cuando pase, y si
el puerto sigue marcado como ocupado, matar el proceso zombie por PID
(`Get-NetTCPConnection -LocalPort 8082 | Stop-Process`) antes de
reintentar.

## 2. Fase 2 — Pedidos del vendedor

Un "pedido" es una proforma con `vendedorId` seteado — no afecta
inventario, la oficina la convierte a factura con el flujo existente.

- Backend: `proformas.vendedorId`, `POST/GET /api/vendedor/pedidos`
  (wrapper sin walk-in: el cliente debe estar en la cartera). Los
  helpers `calcularTotales`/`siguienteSecuencial`/`formatNumero` de
  `routes/proformas.js` se extrajeron a `utils/proformas.js` para
  reusarlos sin duplicar.
- Web: filtro y columna "Vendedor" en Lista de Proformas.
- Móvil: pantallas "Nuevo Pedido" (carrito sin forma de pago) y "Mis
  Pedidos", enlazadas desde Mis Clientes/detalle del cliente.

## 3. Módulo gateado por plan Medium/Pro (o combo)

Decisión de negocio del usuario: el módulo completo (Fases 0-4) solo
debe estar activo desde plan Medium en adelante, disponible en Lite
únicamente si se asigna como combo. Se agregó `vendedorHabilitado` en
`configuracion_sistema` (mismo mecanismo que `bancosHabilitado`/
`talentoHumanoHabilitado`: `capacidadesPlan()` + techo explícito por
tenant vía `modulosContratados`), y `requiereModulo('vendedorHabilitado')`
en TODA la ruta `/api/vendedor` — afecta tanto la app móvil como los
usos embebidos en Clientes/Proformas (web).

## 4. Fase 3 — Cobros en ruta

Diseño acordado con el usuario: el cobro que el vendedor registra en la
calle genera de inmediato un movimiento real de caja/banco (mismo
mecanismo que el POS — el cajero ya lo ve en el arqueo del día), pero el
**asiento contable se genera después**, cuando alguien con acceso a
Contabilidad lo revisa y confirma. Motivo: `vendedorHabilitado` no
implica `contabilidadHabilitada` (un tenant Medium puede tener Vendedor
sin Contabilidad) — generar el asiento sin revisión dejaría asientos
huérfanos en un plan de cuentas nunca configurado.

**Hallazgo clave**: `cobros_cliente.asientoId` ya existía en el schema y
`crearAsientoCobroCliente()` ya lo setea al final. Bajo el flujo normal
de CxC nunca queda un cobro con `asientoId = null` (cobro y asiento se
crean juntos, en una sola transacción). Eso significa que **no hizo
falta ninguna columna nueva**: `asientoId IS NULL` identifica sin
ambigüedad los cobros del vendedor pendientes de verificar.

- Backend: `POST/GET /api/vendedor/cobros` (efectivo → caja del día;
  transferencia → movimiento bancario, requiere `bancoId`). `GET/POST
  /api/cxc/cobros/pendientes-verificar` y `/verificar` (mismo gate que
  el resto de `cxc.js`; "verificar" llama al mismo `crearAsientoCobroCliente`
  que ya usa el flujo normal). Permiso `bancos.consultar` extendido al
  rol vendedor.
- Web: tab "Cobros de vendedores" en Cuentas por Cobrar.
- Móvil: "Cobros pendientes" (lista plana de toda la cartera) y
  "Registrar Cobro" (efectivo/transferencia), enlazadas desde Mis
  Clientes y desde cada factura en el detalle del cliente.

## 5. Fase 4 — Comisiones y metas

Pregunta de negocio resuelta con el usuario: ¿comisión plana o por
producto? Respuesta: **"esta área debe ser configurable por la empresa
según sus políticas"**. Se implementó plana (no por producto) pero con
los 2 % (al facturar / al cobrar) editables en Configuración del
Sistema — default 2%/1%, base de cálculo subtotal SIN IVA (confirmado
explícitamente).

Devengo enganchado a código ya existente, sin flujo paralelo:
- `proformas.js POST /:id/marcar-convertida`: si el pedido tenía
  vendedor, la factura resultante lo hereda (`facturas.vendedorId`,
  columna nueva — **no confundir con `facturas.vendedor`**, un campo de
  texto libre preexistente sin relación) y se devenga `comisionVendedorFacturar`
  % sobre `importeTotal - totalIva`.
- Los 2 `POST /cobros` (cxc.js y vendedor.js): si `factura.vendedorId`
  existe, devengan `comisionVendedorCobrar` % sobre la **porción neta
  proporcional** del cobro (importa en cobros parciales).

- Backend: `GET /vendedor/comisiones` (mi acumulado del mes + meta;
  admin/supervisor ven a todos), `POST /vendedor/metas` (fija la meta
  mensual de un vendedor).
- Web: los 2 % en Configuración del Sistema; panel colapsable
  "Comisiones y metas" en Gestión de Clientes.
- Móvil: pantalla "Mis Comisiones" con barra de progreso vs meta.

## 6. Dos bugs reales encontrados probando con un usuario real

El usuario probó con una vendedora real (Liliana Herrera, tenant Corp
Simtelec) y mandó capturas de dos problemas:

**a) Checkbox "Habilitar Agente Vendedor" deshabilitado pese a plan
Pro.** Causa: ese tenant ya tenía `empresas.modulosContratados`
explícito (combo manual) desde ANTES de que existiera
`vendedorHabilitado` — `capacidadesModulos()` usa ese array como techo
EXACTO, ignorando el plan por completo cuando está seteado. Fix: UPDATE
idempotente en `applySchemaFixes.js` que agrega `vendedorHabilitado` a
los `modulosContratados` de tenants Medium/Pro que aún no lo tengan —
se autoaplica en el próximo deploy, sin necesitar acceso directo a la
BD de producción (no había `.env.local` disponible en esta sesión).
**Lección para el futuro**: cualquier flag nuevo en `MODULOS_TODOS`
necesita este mismo backfill, o queda bloqueado en tenants con combo
preexistente sin importar su plan — ver memoria
`feedback_nuevo_flag_modulo_backfill_combos`.

**b) La vendedora entraba por el navegador y no veía nada útil** — caía
en el Dashboard genérico de administrador con un sidebar casi vacío
(Dashboard + Ayuda + "Inventario", este último solo porque
`productos.ver` incluye a vendedor por motivos de API/móvil). Las 4
fases del módulo asumieron uso exclusivo desde mobile; nunca se
construyó nada equivalente en la web. Fix:
- `frontend/src/components/Vendedor/PanelVendedor.jsx` (ruta
  `/panel-vendedor`): vista de SOLO CONSULTA que reusa los mismos
  endpoints que ya consume la app móvil — cartera con saldo, comisión
  del mes vs meta. Tomar pedidos/cobrar sigue siendo exclusivo de la
  app móvil (no se replicó el carrito de productos en web).
- `Login.jsx` redirige ahí tras login; `Dashboard.jsx` hace lo mismo si
  alguien llega a `/dashboard` por URL directa; `Layout.jsx` oculta
  Dashboard/Productos/Inventario y agrega "Mi Panel" solo para este rol
  (filtro por `normalizarRol` exacto, no por permiso — para no tocar
  `productos.ver`, que el móvil sí necesita).

## Verificación

- Backend: 126/126 tests (`npm test`), incluye 3 scripts de integración
  real contra Postgres local (Fase 2, Fase 3, Fase 4 y el backfill de
  combos) — datos de prueba borrados al terminar cada uno.
- Frontend web: `vite build` + `eslint` limpios, 25/25 vitest.
- Móvil: `tsc --noEmit` limpio en cada fase.
- **El panel web para vendedor (`PanelVendedor.jsx`) NO se verificó
  visualmente en navegador** — no había herramienta de browser
  disponible en esta sesión. Pendiente que el usuario lo confirme
  cuando Railway termine de desplegar.
- Fases 1-4 probadas en dispositivo real por el usuario con una
  vendedora de prueba (Liliana Herrera) — encontró los 2 bugs de arriba,
  ambos corregidos y pusheados.

## 🔴 Pendientes para retomar

1. **Confirmar en el navegador** que el checkbox de Agente Vendedor ya
   aparece habilitado en Corp Simtelec (requiere que Railway haya
   desplegado `17a7d00`) y que "Mi Panel" se ve bien para el rol
   vendedor (cartera + comisiones).
2. **Fase 5 del roadmap — Offline para el vendedor**: capa genérica
   diferida desde Fase 0 (`expo-sqlite` + `@react-native-community/netinfo`,
   cache de clientes/productos/facturas pendientes, cola de pedidos y
   cobros sincronizados vía nuevos handlers en `backend/routes/sync.js`).
   Decisión abierta antes de empezar: ¿el vendedor puede tomar pedido de
   un cliente NUEVO (no en su cartera) estando offline, o solo de
   clientes ya asignados y cacheados? — preguntar al usuario antes de
   construir.
3. **Fase 6 del roadmap — Impresión portátil Bluetooth** (opcional,
   requiere dev build de EAS, no Expo Go).
4. **Seguir probando Fases 1-4 clic a clic** con más vendedores/datos
   reales del negocio — el usuario sigue en pruebas.
5. **Deuda ya conocida, sin resolver** (heredada de sesiones previas):
   `FormNotaVenta.jsx` con la misma limitación de pagos mixtos que se
   arregló en el POS; CxC (`cobros_cliente`) normal (no en ruta) sigue
   sin liberar el mismo gap que tenía el POS antes de Bancos —
   verificar si aún aplica; Estadísticas v3 si se pide (top clientes,
   rango personalizado, exportar).

## Al retomar

`git pull` (o `git fetch` + verificar `origin/main` si el checkout
local muestra muchos archivos "modificados" sin diff real — ruido
CRLF/LF de la carpeta MEGA). Revisar este documento +
`docs/roadmap-agente-vendedor.md` (estado de fases, ya al día). No hay
plan pendiente en `C:\Users\USUARIO\.claude\plans\` — si se retoma Fase
5, preguntar primero la decisión abierta del punto 2 antes de
planificar/construir.
