# AELA ERP — Sesión 2026-07-08

## Resumen ejecutivo

Sesión de retomada: git pull del trabajo hecho desde casa (2026-07-07, 2 commits, HEAD `5b27fa5`).
Pull exitoso con stash `local-antes-pull-2026-07-08`.

**Lo que llegó del 07-07:**
- `d07f1ec` — Configuración de cuentas contables por referencia (catálogo retenciones SRI, nómina, general)
- `5b27fa5` — Cuentas por Cobrar/Pagar + mejoras Bancos/Compras/Retenciones/Guías (benchmark vs. Sofía)

---

## ✅ Completado al inicio de sesión

- `git pull` exitoso (fast-forward desde `4941b67` a `5b27fa5`)
- Documentación actualizada:
  - `docs/estado-proyecto.md`: fecha de referencia → 2026-07-08
  - `docs/pendientes-2026-07-08.md`: este archivo

---

## ✅ Implementado en sesión 2026-07-08

### Caja Chica — `d0ab17d`
- Nuevo módulo: `cajas_chicas` + `movimientos_caja_chica` (tabla, schema, migración, applySchemaFixes)
- Endpoints completos: CRUD cajas, vales de gasto, reposición, cierre
- Asientos automáticos: APERTURA_CAJA_CHICA, GASTO_CAJA_CHICA, REPOSICION_CAJA_CHICA
- Frontend: CajaChica.jsx con list/form/detalle + hooks de contabilidad
- Menú en sidebar: Caja Chica bajo Contabilidad

### Fix contabilidad 500 errors — `fa9ddd3`
- `prismaTenant.js`: lazy `applySchemaFixes` al crear cliente tenant (cubre tenants que el startup no alcanzó)
- `contabilidad.js` (routes): 3 endpoints manejan Prisma P2021 (tabla no existe) con defaults graceful:
  - `plan-cuentas/estado` → planVacio:true
  - `configuracion-asientos` → {}
  - `configuracion-referencias/:categoria` → catálogo sin cuentas asignadas

### Facturas de compra: eliminar y cuenta contable — `d20091c`
- `DELETE /api/compras/:id`: eliminación física con guards (bloquea si CxP activos o inventario sin revertir)
- `PUT /api/compras/:id`: acepta `cuentaGastoId` (cuenta contable que anula el default global)
- `GET /api/compras/:id`: enriquece respuesta con datos de `cuentaGasto` (código + nombre)
- `contabilidad.js` (utils): `crearAsientoFacturaCompraRegistrada` usa `cuentaGastoId` si está configurado
- Schema/migración/applySchemaFixes: columna `cuentaGastoId INTEGER` en `facturas_compra`
- `DetalleCompra.jsx`:
  - Botón "Eliminar" + modal confirmación (con advertencias si tiene inventario no revertido)
  - Botón "Cuenta contable" + selector buscable del plan de cuentas
  - Display de cuenta configurada en tarjeta "Operacion"

### Módulos por empresa — confirmado funcional
- `Layout.jsx` ya usa `modulo` key en cada ítem del menú + `moduloDeshabilitadoPorConfiguracion()`
- `configuracion_sistema` por empresa controla qué módulos se muestran — funciona correctamente en multi-empresa

---

## 🔴 VERIFICAR EN PRODUCCIÓN — PRIORIDAD ABSOLUTA

Todo el código fue verificado con scripts de integración contra Postgres real (`scfi_dev`).
Lo que sigue REQUIERE prueba manual en el navegador:

### SESIÓN 2026-07-07 — 7 puntos pendientes en UI

#### 1. Cuentas por Cobrar (`/cuentas-por-cobrar`)
- Abrir → tab "Vigentes" → debe listar facturas autorizadas con saldo pendiente
- Seleccionar una factura → "Registrar cobro" → ingresar monto **parcial** → guardar
- Confirmar que el saldo baja (pero la factura sigue en Vigentes)
- Registrar el cobro del saldo restante → confirmar que la factura pasa a "Canceladas"
- Ir a Contabilidad → Libro Diario → confirmar asiento tipo `COBRO` con los montos correctos
- Ir a "Historial" → anular el último cobro → confirmar que la factura vuelve a "Vigentes" con saldo y que aparece asiento `REVERSO_COBRO`

#### 2. Cuentas por Pagar (`/cuentas-por-pagar`)
- Mismo flujo simétrico: compra registrada → cobro parcial → total → "Canceladas"
- Asientos `PAGO`/`REVERSO_PAGO` en Libro Diario

#### 3. Anular compra que ya tiene asiento
- Ir a Compras → buscar una compra que muestre "✓ Con asiento" en el listado
- Anularla
- Ir a Libro Diario → confirmar que aparece asiento tipo `ANULACION` con referencia `COMP-ANUL-{id}`
  que reversa EXACTAMENTE los montos del asiento `COMPRA` original
- **Antes del fix `5b27fa5`**: la compra anulada seguía afectando el Libro Diario

#### 4. Ver asiento desde detalle de compra
- Abrir una compra con asiento generado
- Confirmar que existe botón "📒 Ver asiento"
- Abrirlo → modal de solo lectura con líneas debe/haber correctas

#### 5. Editar retención no autorizada
- Ir a Facturación → Retenciones
- Crear una retención nueva (queda en `PENDIENTE_FIRMA`)
- En el listado, usar el botón nuevo "✏️ Editar" → cambiar un monto
- Confirmar que se guardó
- Usar "Reenviar" → confirmar que se procesa con los datos nuevos

#### 6. Comprobantes bancarios numerados
- Ir a Bancos → seleccionar una cuenta bancaria
- Registrar un depósito → confirmar columna "N° Comprobante" = `ING-202607-0001` (o el consecutivo siguiente)
- Registrar un retiro → confirmar `EGR-202607-0001`
- Movimientos viejos pueden no tener número (columna nullable, sin backfill — es correcto)

#### 7. Transportistas en Guías de Remisión
- Crear una guía de remisión con un transportista nuevo (RUC + nombre + placa)
- Guardar → el transportista debe quedar guardado en el catálogo automáticamente
- Crear una segunda guía → al escribir el nombre del mismo transportista, debe sugerirse (autocompletar)
- Confirmar que RUC y placa se autocompletan al seleccionar la sugerencia

#### 8. Configuración de cuentas por referencia
- Ir a Contabilidad → Plan de Cuentas → card "Configuración de asientos por referencia"
- Sub-tab "Compras" → buscar código de retención "303" (Honorarios en general)
- Asignar una cuenta específica de tu plan (ej. `2.1.03.002 Retenciones Renta por Pagar`)
- Guardar
- Ir a Facturación → Retenciones → emitir una retención con código 303
- Ir a Libro Diario → confirmar que el asiento de la retención USA la cuenta `2.1.03.002`
  (no la genérica "Retenciones por Pagar")

---

### SESIÓN 2026-07-04/05 — Puntos aún pendientes de verificación

Estos puntos se documentaron en `pendientes-2026-07-06.md` pero aún no se confirmaron
en producción:

| # | Punto | Qué verificar |
|---|-------|--------------|
| 0 | Asientos faltantes en facturas históricas | Ventas → Importar históricas → "Generar asientos faltantes" |
| 1 | Deploy Railway | Commit activo ≥ `5b27fa5` |
| 2 | Bancos Consorcio Vial | Modal sólido, selector cuentas funcional |
| 3 | Config contable compras | Cuenta de gasto propia → asiento usa esa cuenta |
| 4 | Costo de ventas facturas | Factura inventariable → asiento `COSTO_VENTA` |
| 5 | Notas de venta | Nota + anulación → `NOTA_VENTA`, `COSTO_VENTA`, `ANULACION_NOTA` |
| 10 | Centros de Costo | Crear uno, asignarlo a una línea de asiento manual |
| 11 | Provisiones nómina | BORRADOR→PROCESADA → asiento `NOMINA`; PAGADA → asiento pago |
| 12 | Compras históricas | Importar lote → asientos `COMPRA` con fecha histórica |

---

## 🟡 BACKLOG — Próximas sesiones

### Módulos completos que no existen (de mayor a menor impacto)

| Módulo | Alcance estimado | Prerequisito |
|--------|-----------------|-------------|
| **Inventario multi-bodega** | Grande — bodegas, series, lotes, transferencias, kárdex por bodega | Planear aparte |
| **Caja chica formal** | Mediano — vales, reposición, liquidación | Ninguno |
| **Anticipos** (cliente/proveedor) | Mediano — tracking, aplicación contra facturas | Ninguno |
| **Importaciones/aduanas** | Grande — solo si el cliente realmente lo necesita | Confirmar con cliente antes |

### Dentro de CxC/CxP (alcance acotado a propósito)
- Cheques recibidos con tracking propio (número, vencimiento, estado)
- Tarjetas de crédito en CxP
- Importar Excel de cobros/pagos masivos
- Reportes: estado de cuenta por cliente/proveedor, antigüedad de saldos

### General
- Impuesto a la Renta en nómina (tabla progresiva LORTI)
- Historial salarial por empleado (contratos)
- Pasarela de pagos PayPhone/Stripe
- Panel Super Admin SaaS (stats de uso, activar/suspender tenants)
- Tests e2e Playwright/Cypress
- Exportación PDF/Excel de nómina
- Puppeteer en Railway (solo si el scraper SRI sigue fallando)

---

## Contexto técnico rápido

```
Repo:     github.com/raocampo/AELAERP  rama: main  HEAD: 5b27fa5
Backend:  Railway → aelaerp-production.up.railway.app
Frontend: Vercel  → aela.corpsimtelec.com
DB:       PostgreSQL Railway (railway + aela_lsac + aela_mprq)
```

**Migraciones que deben estar aplicadas en Railway** (fallback en `applySchemaFixes.js`):
```
20260704000000_configuracion_contable
20260704120000_centros_costo
20260707000000_configuracion_cuentas_referencia
20260707010000_cxc_cxp              ← tablas cobros_cliente + pagos_proveedor
20260707020000_movimientos_bancarios_numero  ← columna numero en movimientos_bancarios
20260707030000_transportistas        ← tabla transportistas
```

**Archivos clave del trabajo 2026-07-07:**
| Archivo | Responsabilidad |
|---------|----------------|
| `backend/utils/catalogosCuentasReferencia.js` | Catálogo de referencias por categoría |
| `backend/routes/cxc.js` | Endpoints Cuentas por Cobrar |
| `backend/routes/cxp.js` | Endpoints Cuentas por Pagar |
| `backend/routes/transportistas.js` | CRUD catálogo de transportistas |
| `backend/utils/contabilidad.js` | +9 funciones asientos: config-ref (4), CxC/CxP (4), reverso compra (1) |
| `frontend/src/components/CuentasPorCobrar/CuentasPorCobrarHub.jsx` | Hub CxC |
| `frontend/src/components/CuentasPorPagar/CuentasPorPagarHub.jsx` | Hub CxP |
| `frontend/src/components/Contabilidad/ConfiguracionCuentasReferencia.jsx` | UI config por referencia |
