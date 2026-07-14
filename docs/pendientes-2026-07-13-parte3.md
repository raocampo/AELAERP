# AELA ERP — Sesión 2026-07-13 (parte 3)

## Resumen ejecutivo

Documentación retroactiva de 4 commits de otra sesión (`98bdc5c`, `704efc0`, `780782b`,
`1dc8ca6`) que nunca quedaron documentados, más una auditoría de código de todo lo
pendiente de verificar de las partes 1 y 2 del mismo día. La auditoría encontró y corrigió
**dos bugs críticos** que habrían bloqueado dos módulos completos en producción — ninguno
reportado aún por el usuario, detectados leyendo el código antes de que llegara a probarlos.

---

## 🔴 Bugs críticos encontrados y corregidos en esta sesión

### A — Cuentas por Cobrar nunca funcionó (`021a759`)

Las 7 consultas de `backend/routes/cxc.js` (vigentes, canceladas, registrar cobro, reporte
de antigüedad, estado de cuenta, e importar cobros desde Excel) filtraban
`estadoSri: 'AUTORIZADA'` (femenino). En **todo** el resto del backend el valor real que se
guarda es `'AUTORIZADO'` (masculino) — nunca escrito como `'AUTORIZADA'` en ningún punto de
`facturas.js`, `colaSRI.js`, `retenciones.js`, `notasDebito.js` ni `liquidacionesCompra.js`.

Consecuencia: "Vigentes" y "Canceladas" en CxC siempre mostraban vacío, registrar un cobro
individual siempre fallaba con "factura no autorizada", y el importador de cobros por Excel
(recién agregado, parte 1 de esta sesión) rechazaba el 100% de las filas — para cualquier
factura real sin importar que sí estuviera autorizada por el SRI.

**Fix**: `'AUTORIZADA'` → `'AUTORIZADO'` en las 7 ocurrencias. `cxp.js` no tiene este bug
(`facturas_compra` no usa `estadoSri`).

### B — WebServices API (`/api/ext/v1`) no funcionaba en absoluto (`9480db6`)

El módulo completo (`backend/routes/external.js`, del commit `1dc8ca6`) se escribió contra
un schema imaginado, no el real:

- `POST /clientes` usaba la clave compuesta al revés (`identificacion_empresaId` en vez de
  `empresaId_identificacion`, que es como Prisma la genera según el orden declarado en
  `@@unique([empresaId, identificacion])`).
- `POST /facturas` usaba campos que no existen (`numero`, `fecha`, `totalGeneral`, `estado`,
  `fuente`) en vez de los reales (`numeroFactura`, `fechaEmision`, `importeTotal`,
  `estadoSri`, `origenRegistro`), nunca proveía campos obligatorios del modelo
  (`claveAcceso`, `rucEmisor`, `razonSocialEmisor`, `razonSocialComprador`,
  `identificacionComprador`, `tipoIdentificacionComprador`, `pagos`), y trataba `detalles`
  (columna `Json`) como si fuera una relación Prisma con `create: [...]`.
- `GET /facturas/:id` tenía el mismo problema de nombres en el `select`.
- `POST /pagos` escribía en `req.prisma.pagos_factura`, un modelo que **no existe** —
  crasheaba con un `TypeError` de JavaScript antes de llegar siquiera a Prisma.

Es decir: cada endpoint de escritura fallaba en el 100% de los casos.

**Contexto real aclarado con el usuario**: AVALAB (sistema de laboratorio clínico) ya emite
sus propias facturas electrónicas autorizadas por el SRI — este endpoint no debe autorizar
nada, solo **recibir y registrar** esos comprobantes (y sus cobros) para que AELA lleve la
contabilidad. Esto cambia el diseño correcto: no es "crear una factura nueva" (que exigiría
generar clave de acceso, firmar XML y pasar por la cola SRI), es "importar un documento ya
autorizado en otro sistema" — el mismo patrón que ya existe en
`utils/importarFacturasHistoricas.js`.

**Fix**: reescrito completo de `external.js`:
- `claveAcceso` (la del SRI, de AVALAB) pasa a ser **requerida** y sirve como llave de
  idempotencia — si AVALAB reintenta el mismo POST, no duplica, devuelve la factura ya
  registrada.
- `tipoIdentificacion` usa códigos SRI (`04` RUC / `05` Cédula / `06` Pasaporte) en vez de
  strings inventados (`'RUC'`/`'CEDULA'`).
- La factura se inserta con `estadoSri: 'AUTORIZADO'` y `origenRegistro: 'WEBSERVICE'`
  directamente (sin cola SRI), y genera su asiento contable con la función real
  `crearAsientoFacturaAutorizada` (no bloquea la respuesta si el asiento falla, igual que el
  importador de históricas).
- `POST /pagos` ahora escribe en `cobros_cliente` (el subledger real que usa CxC, con lock
  `FOR UPDATE` y validación de saldo pendiente) y genera su asiento vía
  `crearAsientoCobroCliente` — exactamente el mismo patrón que el importador de cobros de
  CxC.
- `parsearNumeroFactura` se exportó desde `importarFacturasHistoricas.js` para reutilizar el
  parseo de `"001-001-000012345"` en vez de reescribirlo por tercera vez.

**Verificado con un script de integración ad-hoc contra `scfi_dev` real** (no solo lectura
del schema): creó cliente, factura, asiento contable, cobro y asiento de cobro, y los
revirtió — los 5 pasos funcionaron sin errores.

---

## Auditoría del resto del checklist de la parte 1/2 (sin bugs encontrados)

Revisados por código (sin necesitar navegador) y confirmados correctos:

- **F104 con compra manual** — el filtro `OR: [{receptorEsRuc: null}, {receptorEsRuc: true}]`
  está bien aplicado en `declaraciones.js`.
- **Desglose de liquidaciones 0%** — `Declaraciones.jsx` consume correctamente
  `meta.desglose` y `meta.gastosPersonalesExcluidos` del backend.
- **Exclusión de gasto personal** — filtro `esGastoPersonal: { not: true }` presente en F104.
- **Rol contador → facturación** — permiso `facturacion.emitir` agregado en backend y
  frontend (`utils/roles.js` espejados) y usado consistentemente en la ruta protegida
  (`/facturas/nueva`) y en el endpoint `POST /api/facturas`.

---

## Features documentados retroactivamente (commits ya en `main`)

### 1 — Permisos de Configuración para contador/financiero (`98bdc5c`)

`sri.configurar` y `sistema.configurar` ahora incluyen el rol
`contador` — el grupo Configuración (Config SRI, Config Sistema, Utilidades) queda accesible
para contador/financiero. Administración (Usuarios) sigue exclusivo de admin.

### 2 — Módulo de Anticipos de clientes y proveedores (`704efc0`)

- Tablas nuevas: `anticipos_cliente`, `anticipos_proveedor`.
- Asientos automáticos:
  - Cliente: Debe Caja/Bancos, Haber Anticipos de Clientes (`2.1.05.001`).
  - Proveedor: Debe Anticipos a Proveedores (`1.1.04.002`), Haber Caja/Bancos.
  - Reverso automático al anular (motivo obligatorio).
- Backend: `GET/POST /api/anticipos/clientes` y `/api/anticipos/proveedores` (pendientes,
  historial, registrar, anular). Permisos: reutiliza `cxc.ver`/`cxc.gestionar` y
  `cxp.ver`/`cxp.gestionar` (no son permisos nuevos).
- Frontend: tab "Anticipos" dentro de `CuentasPorCobrarHub.jsx` y `CuentasPorPagarHub.jsx`
  (no es un módulo aparte en el sidebar).
- Numeración: `ANT-CLI-AAAAMM-NNNN` / `ANT-PRV-AAAAMM-NNNN`.
- **Auditado en esta sesión** — nombres de campo correctos contra el schema, sin bugs
  encontrados (a diferencia de CxC y WebServices API).

### 3 — Fix de aislamiento de tenant en Plan de Cuentas + restaurar plan AELA (`780782b`)

**Causa raíz real**: `frontend/src/services/api.js` enviaba el header `X-Tenant-Slug` desde
`localStorage`, que puede quedar residual del último tenant visitado en el navegador. Si un
usuario cambiaba de tenant sin pasar por la URL `/:slug`, las requests seguían apuntando a
la BD del tenant anterior.

**Fix**: cuando hay un JWT activo, `api.js` extrae el `tenantSlug` directamente del payload
del token (sin verificar firma — el backend ya la verifica en cada request) en vez de leer
`localStorage`. El `localStorage` queda como fallback solo para requests sin token
(login/registro, donde todavía no hay JWT).

**Feature relacionada**: `POST /api/contabilidad/plan-cuentas/restaurar-base` — restaura el
plan de cuentas base de AELA con `upsert` (elimina cuentas sin movimientos que no son del
plan base, actualiza las que sí lo son, nunca toca cuentas con movimientos). Botón
"↩ Restaurar plan AELA" en ContabilidadHub → Plan de Cuentas.

### 4 — Vencimientos automáticos, PRO mono/multiempresa, pagos de suscripción (`1dc8ca6`)

**Vencimientos automáticos de plan**:
- `middleware/tenant.js` detecta trial expirado o plan pagado vencido automáticamente,
  actualiza el estado en la BD master (fire-and-forget, no bloquea la request) e invalida el
  caché de tenant.
- Frontend maneja el estado `PLAN_VENCIDO` con el mismo modal que ya existía para trial
  expirado.

**SuperAdmin — tipo de instancia PRO**:
- Campo nuevo `tipoInstancia` (`monoempresa` | `multiempresa`) en `schema-master.prisma`,
  solo aplica cuando `plan = 'pro'`.
- `PanelSuperAdmin.jsx` muestra el selector mono/multi solo para tenants en plan PRO.
- `empresas.js` bloquea la creación de una 2ª empresa si `tipoInstancia = 'monoempresa'`.

**Pagos de suscripción** (`backend/routes/suscripcionPago.js`, `frontend/.../PagarSuscripcion.jsx`):
- 3 formas de pago: transferencia bancaria manual, checkout PayPhone, y placeholder Stripe
  (requiere `STRIPE_SECRET_KEY`, no implementado el flujo completo aún).
- `GET /api/suscripcion-pago/info` — plan actual + precios de referencia (Lite $0, Medium
  $29/mes ó $290/año, Pro $59/mes ó $590/año — hardcodeados en el archivo, ajustables).
- `POST /transferencia` — registra una `solicitud_pago` en estado `pendiente` con
  referencia/comprobante, notifica a soporte por email.
- `POST /payphone` — genera checkout URL; `POST /payphone-callback` — webhook público (sin
  `proteger`, validar más adelante si PayPhone firma sus webhooks).
- `POST /admin/aprobar/:id` — aprobación manual de transferencias, protegido por
  `SUPER_ADMIN_KEY` (header `Authorization: Bearer <key>`) en vez de JWT normal — **requiere
  que `SUPER_ADMIN_KEY` esté configurada en Railway**, si no la variable existe el endpoint
  devuelve 503 (falla cerrado, no abierto).
- Al aprobar: crea `suscripciones` (venciendo la anterior), actualiza `tenants.plan/estado/
  fechaVencimiento`, invalida caché.
- Ruta `/suscripcion` en el sidebar → Configuración → "Mi Suscripción".
- **Auditado en esta sesión** — todos los nombres de campo contra `schema-master.prisma`
  correctos, sin bugs encontrados.

**WebServices API — AVALAB**: ver sección de bugs críticos arriba (B). Diseño correcto:
sistema externo con su propia facturación electrónica SRI, AELA solo registra para
contabilidad.

---

## 🔴 VERIFICAR EN PRODUCCIÓN

1. **Cuentas por Cobrar → Vigentes** — debe mostrar ahora las facturas autorizadas
   pendientes de cobro (antes del fix A, siempre aparecía vacío). Registrar un cobro parcial
   y uno total, confirmar que pasa a "Canceladas" cuando el saldo llega a $0.
2. **Importar cobros CxC (Excel)** — repetir la prueba: ahora con el fix debería aceptar
   filas de facturas realmente autorizadas (antes de esta sesión, el 100% caía en errores).
3. **Variables de entorno en Railway** — confirmar que existen (o decidir si hace falta
   agregarlas): `SUPER_ADMIN_KEY` (aprobar pagos de suscripción manualmente),
   `PAYPHONE_API_TOKEN`/`PAYPHONE_STORE_ID` (checkout PayPhone), `BANCO_*` (datos de cuenta
   para transferencias), `STRIPE_SECRET_KEY` (si se va a habilitar Stripe).
4. **WebServices API con AVALAB** — antes de conectar AVALAB de verdad, generar una API key
   de prueba desde SuperAdmin y hacer un POST real a `/api/ext/v1/facturas` con datos de
   prueba (clave de acceso real de un comprobante ya autorizado) para confirmar en un
   entorno real que la factura y su asiento contable aparecen correctamente en el Libro
   Diario del tenant correcto.
5. **Anticipos** — registrar un anticipo de cliente y uno de proveedor desde CxC/CxP, anular
   uno con motivo, y confirmar los asientos `2.1.05.001`/`1.1.04.002` en el Libro Diario.
6. **Restaurar plan AELA** — Contabilidad → Plan de Cuentas → botón ámbar "↩ Restaurar plan
   AELA" — confirmar que no borra cuentas con movimientos y sí actualiza las del plan base.
7. **Vencimiento de plan** — difícil de probar sin esperar a que un tenant real venza; al
   menos confirmar que el modal de `PLAN_VENCIDO` se ve bien comparándolo con el de trial
   expirado.

---

## Contexto técnico

```
Repo:     github.com/raocampo/AELAERP  rama: main
Commits de esta sesión: 021a759 (fix CxC), 9480db6 (fix WebServices API)
Commits documentados retroactivamente: 98bdc5c, 704efc0, 780782b, 1dc8ca6
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
```

**Archivos modificados en esta sesión (fixes):**

| Archivo | Cambio |
|---------|--------|
| `backend/routes/cxc.js` | `'AUTORIZADA'` → `'AUTORIZADO'` (7 ocurrencias) |
| `backend/routes/external.js` | Reescrito completo — nombres de campo reales, idempotencia por claveAcceso, cobros vía `cobros_cliente` |
| `backend/utils/importarFacturasHistoricas.js` | Exporta `parsearNumeroFactura` para reutilizar |
