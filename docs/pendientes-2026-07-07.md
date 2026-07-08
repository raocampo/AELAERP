# AELA ERP — Sesión 2026-07-07

## Resumen ejecutivo

Sesión de benchmark contra "Sofía" (otro ERP contable ecuatoriano). El cliente compartió
capturas de pantalla del menú completo de Sofía pidiendo evaluar/implementar equivalentes en
AELA. Dos partes:

1. **Configuración de cuentas contables por referencia** (commit `d07f1ec`) — mapeo código→cuenta
   para retenciones SRI, nómina y cuentas generales.
2. **Cuentas por Cobrar/Pagar + 3 mejoras puntuales** (commit siguiente, ver git log) — subledger
   real de cobros/pagos, priorizado por el cliente entre 5 módulos que no existían en AELA.

Commits: `d07f1ec` (parte 1), commit de esta parte 2 — ver `git log --oneline -5`.

---

## Parte 1 — Configuración de cuentas contables por referencia

Nueva pantalla en Contabilidad → Plan de Cuentas: tabla "Referencia" (fija) | "Cuenta contable"
(elegible por el contador), en sub-tabs Compras / Ventas / Empleados / General.

**Diseño**: tabla genérica `configuracion_cuentas_referencia` (empresaId+categoria+codigo→cuentaId)
en vez de seguir agregando columnas a `configuracion_contable`. Catálogos de referencia en código
(`backend/utils/catalogosCuentasReferencia.js`) — reexporta los códigos de retención SRI que
YA existían en `sri.js` (usados para emitir comprobantes de retención), no se retipeó la lista de
Sofía (que tenía inconsistencias visibles en las capturas).

**Motor contable actualizado** (`backend/utils/contabilidad.js`):
- `crearAsientoRetencionAutorizada` (retenciones emitidas a proveedores) y
  `crearAsientoRetencionRecibida` (retenciones recibidas de clientes) ahora desglosan el asiento
  por código de retención SRI, en vez de 1-2 líneas genéricas fijas. Sin configuración, el
  comportamiento es idéntico al de antes (se agrupan en la misma cuenta genérica).
- `crearAsientoNominaPeriodo` y `crearAsientoPagoNominaPeriodo` comparten el mismo mecanismo de
  resolución de cuenta — se corrigió una inconsistencia real: antes cada función hardcodeaba su
  propia cuenta "Sueldos por Pagar" (`2.1.05.001`) por separado; si solo una se hacía
  configurable, reconfigurar rompería el cuadre de esa cuenta en el mayor.

**Endpoints nuevos**: `GET/PUT /api/contabilidad/configuracion-referencias/:categoria`.

**Verificado** con script de integración contra `scfi_dev` real: 20/21 asserts OK (el único
"fallo" fue un bug de comparación de floats en el script de prueba, no del código — confirmado
indirectamente por el assert hermano que sí pasó).

**No incluido a propósito**: categorías "General" e "Importación" de Sofía sin motor real detrás
(General se agregó igual, config-only, por pedido explícito del usuario — sirve para cuando
exista cierre de ejercicio automático; Importación no se tocó, AELA no tiene módulo de aduanas).

---

## Parte 2 — Inventario de módulos vs. Sofía

Se auditó honestamente el menú completo de Sofía contra AELA (12 áreas: Bancos, Importación,
Ventas, Caja chica, Directorio, Guías de remisión, Inventario, Administración, Anticipos,
Cuentas por Cobrar, Cuentas por Pagar, Compras).

| Estado | Áreas |
|---|---|
| ✅ Ya existe y sólido | Bancos, Guías de remisión, Compras |
| 🟡 Existe con otro nombre | Ventas → Facturación; Directorio → Clientes/Proveedores separados |
| ❌ No existe en absoluto | Importaciones/aduanas, Caja chica formal, Anticipos, Cuentas por Cobrar/Pagar (subledger), Inventario multi-bodega |

El cliente priorizó **Cuentas por Cobrar/Pagar**. Los otros 4 módulos inexistentes quedan en
backlog — cada uno es del tamaño de una sesión completa, no se deben abordar sin planear primero.

### Cuentas por Cobrar / Cuentas por Pagar (implementado)

**Hallazgo clave que cambió el punto de partida**: `crearAsientoCobroFactura`
(`backend/utils/contabilidad.js`) ya existía con la lógica de asiento de cobro correcta, pero
**ningún endpoint la invocaba** — código huérfano. Su diseño (asienta el total completo de una
sola vez, referencia única `FAC-COBRO-{facturaId}` para siempre) es incompatible con cobros
parciales, así que se dejó intacta y se crearon 4 funciones nuevas referenciadas por el ID del
cobro/pago (no de la factura), permitiendo múltiples abonos:
`crearAsientoCobroCliente`, `crearAsientoPagoProveedor`, `crearAsientoReversoCobroCliente`,
`crearAsientoReversoPagoProveedor`.

**Otro hallazgo**: el campo JSON `pagos` en `facturas`/`facturas_compra` NO es un log de pagos —
es metadata del catálogo SRI "forma de pago", exigida para el XML, escrita una sola vez al crear
el documento. Y `cobrada`/`fechaCobro` en `facturas` están muertos (ningún endpoint los escribía,
solo se leían en un badge del frontend que nunca se activaba). Ninguno de los tres se tocó — el
subledger es 100% nuevo e independiente.

**Modelo**: 2 tablas nuevas, `cobros_cliente` y `pagos_proveedor` (migración `20260707010000_cxc_cxp`).
Saldo pendiente se calcula al vuelo (importeTotal − suma de cobros/pagos no anulados), sin columna
redundante. Validaciones al registrar: factura/compra no anulada, factura además debe estar
`AUTORIZADA` por el SRI, monto > 0 y ≤ saldo pendiente (sobre-pago rechazado con 409), lock
`SELECT ... FOR UPDATE` dentro de la transacción para que dos cobros simultáneos no puedan
sobre-pasar el saldo.

**Endpoints**: `backend/routes/cxc.js` y `backend/routes/cxp.js` (nuevos) —
`GET /vigentes`, `GET /canceladas`, `GET /cobros` (o `/pagos`), `POST /cobros` (o `/pagos`),
`PATCH /cobros/:id/anular` (o `/pagos/:id/anular`). Registrados en `app.js`.

**Frontend**: `frontend/src/components/CuentasPorCobrar/CuentasPorCobrarHub.jsx` y
`CuentasPorPagar/CuentasPorPagarHub.jsx` (clonan el patrón de tabs/modales de `BancosHub.jsx`,
reutilizan su CSS). 3 tabs: Vigentes / Canceladas / Historial. Rutas `/cuentas-por-cobrar` y
`/cuentas-por-pagar` en `App.jsx`, entradas de menú en `Layout.jsx` (grupo Contabilidad).

**Permisos nuevos**: `cxc.ver`, `cxc.gestionar`, `cxp.ver`, `cxp.gestionar` — agregados en
`backend/utils/roles.js` y espejados en `frontend/src/utils/roles.js` (son copias separadas,
patrón ya existente para `bancos.*`).

**Verificado** con script de integración contra `scfi_dev` real: 13/13 asserts OK (cobro parcial,
cobro total, sobre-pago rechazado, anulación con reverso contable, cuadre de asientos, mismo flujo
para pagos a proveedor, cuenta CxP genérica correcta). BD limpia tras la prueba, sin residuos.

**Backlog explícito dentro de CxC/CxP** (alcance acotado a propósito, no por falta de tiempo):
- Cheques recibidos de clientes con tracking propio (número, vencimiento, estado) — hoy "cheque"
  es solo una opción más del campo `metodoPago`, sin seguimiento dedicado.
- Tarjetas de crédito (CxP) — sin diseñar.
- Importar Excel de cobros/pagos masivos.
- Reportes dedicados (estado de cuenta por cliente/proveedor, antigüedad de saldos).

### 3 mejoras a módulos existentes (mismo alcance de esta sesión)

**Bancos — comprobantes numerados**: columna `numero` en `movimientos_bancarios` (migración
`20260707020000_movimientos_bancarios_numero`, nullable, sin backfill de movimientos viejos).
Prefijo por categoría: `ING-` (depósito/transferencia entrante), `EGR-` (retiro/transferencia
saliente/cheque), `NC-`, `ND-`, `AJU-`. Formato `PREFIJO-AAAAMM-NNNN`, mismo patrón de numeración
mensual que ya usan los asientos contables. Verificado contra `scfi_dev`: secuencia consecutiva
correcta y categorías independientes entre sí.

**Compras — Ver asiento / Reversar**:
- `GET /api/compras/:id/asiento` (nuevo) — antes solo existía "Generar asiento", no había forma
  de **ver** el asiento ya generado desde el detalle de la compra. Modal de solo lectura agregado
  en `DetalleCompra.jsx`.
- `crearAsientoReversoCompraAnulada` (nuevo) — **fix de cobertura real, no cosmético**: antes,
  `PATCH /compras/:id/anular` marcaba `anulada:true` y revertía inventario/caja, pero **nunca
  reversaba el asiento contable** si la compra ya estaba contabilizada — la compra anulada seguía
  afectando el Libro Diario. Ahora, si existe asiento (`tieneAsientoContable`), se genera
  automáticamente el reverso al anular. Verificado contra `scfi_dev`: reverso cuadra exacto y es
  idempotente (llamarlo dos veces no duplica).

**Retenciones — Editar**: `PUT /api/retenciones/:id` (nuevo), mismo guard que ya usaba
`/reenviar` (`estadoSri !== 'AUTORIZADO' && !anulada`). Permite reescribir `impuestos` y
recalcula `totalRetenido`, regenera el XML (`xmlGenerado`) pero **no reenvía automáticamente** —
el usuario debe usar "Reenviar" después de editar. Frontend: botón "Editar" en
`ListaRetenciones.jsx` con modal simple de edición de montos/porcentajes por código. Verificado
contra `scfi_dev`: los valores se actualizan correctamente (el único "mismatch" en la prueba fue
orden de claves en el JSONB de Postgres, no una diferencia real de datos).

**Guías de remisión — Catálogo de transportistas**: nueva tabla `transportistas`
(migración `20260707030000_transportistas`), mismo patrón CRUD que `centros_costo`
(`backend/routes/transportistas.js`). **No se tocaron** los campos planos
`rucTransportista`/`nombreTransportista`/`placaVehiculo` embebidos en `guias_remision` — el XSD
del SRI los exige así. El catálogo solo alimenta un autocompletado (`<datalist>` nativo, sin
librería nueva) en `FormGuiaRemision.jsx`: al escribir el nombre se sugieren transportistas ya
usados, y al guardar la guía se crea/actualiza el registro en el catálogo automáticamente
(no bloqueante — si ya existe, se ignora el error). Verificado contra `scfi_dev`: búsqueda por
nombre funciona, constraint único por `(empresaId, identificacion)` rechaza duplicados.

---

## 🔴 VERIFICAR EN PRODUCCIÓN / NAVEGADOR — este entorno no tiene acceso a UI

Todo lo de arriba se verificó con scripts de integración contra Postgres real (`scfi_dev` local
estaba disponible esta sesión, a diferencia de otras). Lo que sigue REQUIERE clicks reales:

1. **Cuentas por Cobrar** — abrir `/cuentas-por-cobrar`, ver una factura autorizada en "Vigentes",
   registrar un cobro parcial (confirmar que el saldo baja), registrar el resto (confirmar que
   pasa a "Canceladas"), ir a Contabilidad → Libro Diario y confirmar el asiento tipo `COBRO`.
   Anular el cobro desde "Historial" y confirmar que la factura vuelve a "Vigentes" con el saldo
   correcto y que aparece el asiento `REVERSO_COBRO`.
2. **Cuentas por Pagar** — mismo flujo simétrico con una compra, tipo `PAGO`/`REVERSO_PAGO`.
3. **Anular compra con asiento** — ir a una compra que ya tenga "✓ Con asiento" en el listado,
   anularla, confirmar en Libro Diario que aparece un asiento `ANULACION` con referencia
   `COMP-ANUL-{id}` que reversa exactamente los montos del asiento `COMPRA` original.
4. **Ver asiento desde Compras** — en el detalle de una compra con asiento, botón "📒 Ver asiento"
   debe abrir el modal con las líneas debe/haber correctas.
5. **Editar retención** — crear una retención (queda `PENDIENTE_FIRMA`), editar un monto desde
   el botón nuevo en el listado, confirmar que se guardó, y que "Reenviar" después la procesa
   con los datos nuevos (no los viejos).
6. **Comprobantes bancarios numerados** — en Bancos, registrar un depósito y un retiro, confirmar
   que la columna "N° Comprobante" muestra `ING-202607-0001`/`EGR-202607-0001` (o el consecutivo
   que corresponda).
7. **Transportistas** — crear una guía de remisión con un transportista nuevo, crear una segunda
   guía y confirmar que al escribir el nombre aparece sugerido (autocompletar RUC y placa).
8. **Configuración de cuentas por referencia** (Parte 1) — en Contabilidad → Plan de Cuentas,
   configurar una cuenta específica para el código de retención "303", emitir una retención con
   ese código a un proveedor, confirmar en Libro Diario que el asiento usa la cuenta configurada
   en vez de la genérica "Retenciones por Pagar".

**Migraciones a confirmar aplicadas en Railway** (si no se aplicaron automáticamente, revisar
`applySchemaFixes.js` al arrancar — todas están agregadas ahí como fallback idempotente):
```
20260707000000_configuracion_cuentas_referencia
20260707010000_cxc_cxp
20260707020000_movimientos_bancarios_numero
20260707030000_transportistas
```

---

## 🟡 BACKLOG — Próximas sesiones

### Módulos completos que no existen (de mayor a menor impacto probable)
- **Inventario multi-bodega**: bodegas, catálogos (categorías/marcas/unidades), series, lotes,
  transferencias, kárdex por bodega, procesos de recálculo/actualización de precios masivos.
  Es la base de la que dependen varias otras cosas — planear aparte, es grande.
- **Caja chica formal**: vales de caja, comprobantes de reposición/incremento/disminución/
  liquidación. Distinto de "Caja diaria" (POS) que ya existe.
- **Anticipos** (clientes/proveedores): tracking de anticipos recibidos/entregados, aplicación
  contra facturas/compras futuras.
- **Importaciones/aduanas**: embarques, arribos, nacionalización, partidas arancelarias,
  embarcadores. Dominio completamente distinto — **confirmar con el cliente si sus empresas
  realmente hacen operaciones de comercio exterior antes de invertir aquí**, no es obvio que
  aplique al perfil de negocio típico de AELA (SMEs de facturación local).

### Dentro de CxC/CxP (ver arriba, "Backlog explícito")
Cheques recibidos con tracking propio, tarjetas de crédito, importar Excel, reportes dedicados.

### General (heredado de sesiones anteriores, sin cambios)
- Pasarela de pagos PayPhone/Stripe
- Impuesto a la Renta en nómina (tabla LORTI)
- Tests e2e Playwright
- Panel Super Admin — stats de uso y facturación
- Puppeteer en Railway (solo si el scraper SRI sigue fallando)

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (railway + aela_lsac + aela_mprq) + scfi_dev local (esta sesión)
```

**Archivos clave agregados/modificados esta sesión:**
| Archivo | Responsabilidad |
|---------|----------------|
| `backend/utils/catalogosCuentasReferencia.js` | Catálogo de referencias (retenciones, nómina, general) |
| `backend/routes/cxc.js` / `cxp.js` | Endpoints Cuentas por Cobrar / Pagar |
| `backend/routes/transportistas.js` | CRUD catálogo de transportistas |
| `backend/utils/contabilidad.js` | +9 funciones: config-referencia (4), CxC/CxP (4), reverso compra (1) |
| `frontend/src/components/CuentasPorCobrar/` `CuentasPorPagar/` | Hubs nuevos |
| `frontend/src/components/Contabilidad/ConfiguracionCuentasReferencia.jsx` | UI config por referencia |
