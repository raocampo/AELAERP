# Roadmap — Módulo Agente Vendedor (web + móvil)

Planeado el 2026-09-10. Épico de varias sesiones. Cada fase es
independientemente desplegable; se hace una por sesión.

## Estado

- ✅ **Fase 0 — Fundación** (commits `26be142`, `e36b098`): rol
  `vendedor` + permisos (backend/frontend), y la app móvil ya distingue
  el rol (tabs recortados, `puede()` en `AuthContext`). La capa offline
  genérica se difirió a antes de la Fase 5 (ver nota más abajo).
- ✅ **Fase 1 — Cartera de clientes asignada** (commits `21ebe87`,
  `babab0c`, `9394a52`): `clientes.vendedorId`, scoping por usuario,
  `GET/POST /api/vendedor/*`, asignación masiva desde Gestión de
  Clientes (web), y el tab "Mis Clientes" + detalle/estado de cuenta en
  la app móvil. Verificado con tests + script e2e contra Postgres local
  — el resto (mobile) solo con `tsc --noEmit` (sin dispositivo a mano).
- ⏭️ **Fase 2 — Pedidos**: siguiente.

## Decisiones tomadas con el usuario

- **Qué hace el vendedor**: toma **pedidos** (proformas, no factura),
  maneja una **cartera de clientes asignada** (ve solo lo suyo),
  registra **cobros en ruta** contra **facturas pendientes** del cliente
  (reusa Cuentas por Cobrar), y tiene **comisiones + metas mensuales**.
- **Comisión**: mixta — parte se devenga al facturar el pedido, parte al
  cobrar.
- **El pedido NO afecta inventario** (solo informativo hasta que la
  oficina lo factura). = comportamiento actual de una proforma.
- Va en la **misma app móvil**, con un rol `vendedor` que ve solo lo
  suyo (tabs recortados).
- **Offline es clave** (zonas sin señal).
- **Expo**: parche rápido (Expo Go SDK 54 en el teléfono) para arrancar.
  El dev build de EAS se hace cuando se necesite impresión Bluetooth
  (Fase 6).

## Estado del código relevante (de la exploración 2026-09-10)

- **No existe rol `vendedor`** ni permisos de vendedor
  (`backend/utils/roles.js` + espejo `frontend/src/utils/roles.js`).
- **No hay scoping por usuario** en ninguna ruta — todo filtra por
  `empresaId`. El "solo veo mis clientes" se construye.
- `clientes` (`schema.prisma:187-212`) **no tiene `vendedorId`** ni
  relación con `usuarios`.
- **Proformas** = tabla SQL cruda (`applySchemaFixes.js:45-80`), rutas
  `backend/routes/proformas.js` (`/api/proformas`): crear (guarda
  `creadoPor = req.usuario.id`), listar, transiciones de estado,
  `marcar-convertida`. Filtra solo por empresa. → base del "pedido".
- **Cobros** = `cobros_cliente` (`schema.prisma:867-903`) +
  `backend/routes/cxc.js` `POST /api/cxc/cobros`. Exige `facturaId`
  (cobro contra factura autorizada). Ya vincula
  `bancoId`/`metodoPago`/`usuarioId`. Gate: `contabilidadHabilitada` +
  plan Medium/Pro. Helpers de saldo: `cxc.js:161-188`.
- **Comisiones/metas: no existe nada.** Se construye desde cero.
- **Sync offline backend** (`backend/routes/sync.js` `POST /sync/flush`):
  solo maneja `factura`/`nota_venta`/`compra`/`caja_movimiento`. No
  proformas ni cobros. Idempotencia real vía `idempotencyKey @unique` +
  `sincronizadoOffline` en las rutas normales (patrón
  `notasVenta.js:874-887`).
- **Móvil** (`mobile/`): expo-router file-based; los tabs varían **solo
  por módulo del tenant**, nunca por rol
  (`mobile/app/(tabs)/_layout.tsx`); **cero capacidad offline** hoy
  (solo SecureStore para el token); estado = `useState` + `AuthContext`;
  sin `tienePermiso`. Blueprint web de offline a portar:
  `frontend/src/utils/{syncQueue,offlineDB}.js` (IndexedDB + `apiOffline()`
  + `idempotencyKey` + retry en `window 'online'`). El equivalente RN
  necesita `expo-sqlite` + `@react-native-community/netinfo` +
  `expo-background-fetch` — ninguno instalado.
- Impresión móvil hoy (`mobile/hooks/usePrint.ts`): TCP por red (el
  backend abre socket a la impresora:9100) + fallback PDF/Share.
  **Bluetooth portátil NO soportado** — requiere módulo nativo → dev
  build EAS (no Expo Go).

## Fases

### Fase 0 — Fundación (infra móvil + rol, sin features de negocio)
- Móvil: `npx expo install --fix` (alinear a SDK 54.0.37). Agregar
  `expo-sqlite` + `@react-native-community/netinfo`. Portar `syncQueue`/
  `offlineDB` a RN (SQLite para `pending_ops`+`cache_data`, NetInfo para
  conectividad, `apiOffline()` con `idempotencyKey`). Capa **genérica**
  reusable — backbone de todo lo offline.
- Móvil: portar `tienePermiso` de `frontend/src/utils/roles.js`; tabs
  sensibles al rol en `mobile/app/(tabs)/_layout.tsx`.
- Backend: rol `vendedor` en `roles.js` + espejo frontend; permisos
  `vendedor.*` (`vendedor.pedidos`, `vendedor.cobros`, `vendedor.ver`).

### Fase 1 — Cartera de clientes asignada (backend + web + móvil, ONLINE)
- Schema: `clientes.vendedorId Int?` FK → `usuarios` (`schema.prisma` +
  `applySchemaFixes.js` `ADD COLUMN IF NOT EXISTS`).
- Backend: helper `scopeVendedor(req)` → si `req.usuario.rol ===
  'vendedor'` devuelve `{ vendedorId: req.usuario.id }` para el `where`.
  `backend/routes/vendedor.js` (nuevo): `GET /vendedor/clientes` (mis
  clientes + saldo por cobrar, reusa `cxc.js:161-188`),
  `GET /vendedor/clientes/:id` (detalle + estado de cuenta).
- Web: en `GestionClientes.jsx`, columna + selector "Vendedor asignado" +
  asignación masiva de clientes sin vendedor.
- Móvil: tab "Mis Clientes" (FlatList reusando
  `mobile/app/(tabs)/inventario/index.tsx`) + detalle.

### Fase 2 — Pedidos del vendedor (ONLINE)
- Backend: `proformas.vendedorId` (ALTER). `POST /vendedor/pedidos`
  (wrapper sobre creación de proforma: fuerza `creadoPor`, `vendedorId`,
  `estado='ENVIADA'`, `clienteId` de la cartera; sin walk-in).
  `GET /vendedor/pedidos` (los míos).
- Web: los pedidos entrantes se ven en el módulo Proformas existente; el
  supervisor convierte a factura con el flujo actual
  (`marcar-convertida`). Filtro por vendedor en esa lista.
- Móvil: pantalla "Nuevo Pedido" reusando buscador de productos + carrito
  de `mobile/app/(tabs)/pos/index.tsx`, apuntando al endpoint de pedido.
  Sin formas de pago.

### Fase 3 — Cobros en ruta (ONLINE)
- Backend: `GET /vendedor/cobros/pendientes` (facturas con saldo > 0 de
  mis clientes). `POST /vendedor/cobros` (wrapper sobre `POST /api/cxc/
  cobros`, scoped, fuerza `usuarioId`). Revisar el gate de CxC
  (`contabilidadHabilitada` + Medium/Pro) — relajar para este camino o
  exigir el módulo.
- Móvil: tab "Mi Cartera" — mis clientes con saldo → factura(s)
  pendiente(s) → registrar cobro (reusa línea de pago de
  `mobile/app/(tabs)/pos/checkout.tsx`, pago único).

### Fase 4 — Comisiones y metas
- Schema (tablas nuevas): `comision_config` (vendedorId, %AlFacturar,
  %AlCobrar, vigencia), `meta_vendedor` (vendedorId, anio, mes,
  montoMeta), `comision_devengada` (vendedorId, origen [pedido→factura |
  cobro], referenciaId, base, porcentaje, monto, fecha, estado
  [devengada | liquidada]).
- Backend: devengo en 2 momentos — (a) al `marcar-convertida` el pedido
  devenga "%AlFacturar"; (b) al registrarse un cobro devenga "%AlCobrar"
  proporcional. `GET /vendedor/comisiones` (acumulado del mes + vs meta).
  Web: config del supervisor + reporte de liquidación.

### Fase 5 — Offline para el vendedor
- Sobre la capa genérica de Fase 0. Cache (TTL): mis clientes, mis
  productos, mis facturas pendientes. Cola: creación de pedido + registro
  de cobro → `pending_ops`, sincronizados vía nuevos `entidad` handlers
  en `backend/routes/sync.js` (`'pedido'`, `'cobro_vendedor'`) con
  columnas `idempotencyKey` + `sincronizadoOffline` en las tablas
  destino. UI optimista ("pendiente de sincronizar").

### Fase 6 — Impresión portátil Bluetooth (opcional)
- Requiere el **dev build de EAS** + módulo ESC/POS BT
  (ej. `react-native-bluetooth-escpos-printer`, no compatible con Expo
  Go). Imprimir el pedido/recibo en térmica portátil.

## Decisiones abiertas (resolver al empezar cada fase)

- Fase 3: ¿el gate de CxC se relaja para el vendedor, o se exige que el
  tenant tenga contabilidad + Medium/Pro?
- Fase 4: ¿comisión % plano por vendedor, o varía por
  producto/categoría/línea? (arrancar plano). ¿Qué % exacto al facturar
  vs al cobrar? ¿Sobre subtotal sin IVA o total?
- Fase 5: ¿el vendedor puede tomar pedido de un cliente NUEVO offline, o
  solo de clientes ya asignados y cacheados?

## Expo — el mismatch de SDK (2026-09-10)

El teléfono tiene Expo Go SDK 57, el proyecto SDK 54 → "Project is
incompatible". Caminos: (A) instalar Expo Go para SDK 54 en el teléfono
[elegido para arrancar]; (B) dev build EAS `eas build --profile
development` — la solución de fondo, necesaria para BT printing;
(C) actualizar el proyecto a SDK 57 (riesgo de romper la app actual).
`mobile/.env` (gitignored) creado con
`EXPO_PUBLIC_API_URL=https://aelaerp-production.up.railway.app/api`.
Arranque del dev server: `cd mobile && npx expo start --lan`.
