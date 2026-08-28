# AELA ERP — Sesión 2026-08-28 — Caja Chica nivel "PRO" (Fase 1 + Fase 2)

## Pedido del usuario

Compartió capturas de un sistema de referencia con un módulo de Caja
Chica más elaborado (Vales de caja separados de Facturas de caja chica
con clasificación tributaria SRI, comprobantes de reposición/
incremento/disminución como pagos reales). Pidió replicarlo para
llevar AELA a un nivel más "PRO", con un plan primero (se usó Plan Mode
— ver `C:\Users\USUARIO\.claude\plans\replicated-cuddling-petal.md`).

## Investigación (resumen — detalle completo en el plan)

AELA ya tenía un módulo de Caja Chica funcional (`cajas_chicas`/
`movimientos_caja_chica`, `backend/routes/cajaChica.js`,
`CajaChicaHub.jsx`) con apertura/gasto/reposición/incremento/
disminución/cierre y asientos automáticos. El hueco real: un gasto de
caja chica era un registro puramente interno, **nunca se convertía en
un documento fiscal real, así que nunca contaba en el ATS/F104**.

**Decisión de arquitectura**: en vez de construir un "Facturas de caja
chica" paralelo (duplicando proveedor/SRI/inventario que Compras ya
tiene resuelto), se agregó `caja_chica` como un 5to método de pago en
Cuentas por Pagar (`backend/routes/cxp.js`, antes limitado a
`efectivo/transferencia/cheque/tarjeta`). Una compra de caja chica es
ahora: 1) se registra normal en Compras (sin ningún cambio a
`FormCompra.jsx`), 2) se paga desde Cuentas por Pagar eligiendo "Caja
Chica" como método — igual que se paga con cualquier banco.

## Fase 1 — Compras pagadas con Caja Chica

- Schema: `pagos_proveedor.cajaChicaId` (FK nueva); `movimientos_caja_
  chica` gana el tipo `'COMPRA'` + `facturaCompraId`/`pagoProveedorId`
  (FKs, `pagoProveedorId` único).
- `backend/utils/cajaChicaSaldo.js` (nuevo): `calcularSaldoCajaChica`/
  `gastosPendientesReponerCajaChica` extraídas de `cajaChica.js` para
  compartirlas con `cxp.js` (pagar con caja chica también respeta el
  saldo del fondo) — evita que la lógica de saldo diverja entre las dos
  rutas. 5 tests nuevos (`test/cajaChicaSaldo.test.js`).
- `cxp.js` `POST /pagos`: con `metodoPago='caja_chica'`, exige
  `cajaChicaId`, valida fondo ACTIVO + saldo suficiente, y crea el
  `movimientos_caja_chica` tipo COMPRA en la misma transacción
  (enlazado a la compra y al pago).
- `cxp.js` `PATCH /pagos/:id/anular`: si el pago era de caja chica,
  anula también el movimiento del fondo (revierte el saldo).
- `utils/contabilidad.js` `crearAsientoPagoProveedor`: nueva rama para
  `metodoPago==='caja_chica'` — acredita la cuenta contable DEL FONDO
  específico (`cajaChica.cuentaFondoId`, fallback `1.1.01.002`), no un
  banco genérico. `crearAsientoReversoPagoProveedor` no necesitó
  cambios (revierte debe/haber del asiento original tal cual, sin
  importar qué cuenta fue).
- Frontend: `CuentasPorPagarHub.jsx` — "Caja Chica" en el selector de
  método de pago, con select de fondo (muestra saldo disponible) en vez
  de banco. `CajaChicaHub.jsx` — tipo `COMPRA` en la tabla de
  movimientos con link a la compra real; botón "+ Registrar compra"
  (atajo a Compras → Nueva).

## Fase 2 — Vales de caja mejorados

- Nuevo catálogo `tipo_gasto_caja_chica` (mismo shape que
  `centros_costo`: codigo/nombre/activo), CRUD completo en
  `cajaChica.js` (`/tipos-gasto`). Se auto-siembran 6 categorías
  comunes (Alimentación/Transporte/Limpieza/Papelería/Mantenimiento/
  Otros) la primera vez que una empresa consulta el catálogo — editable
  después.
- `movimientos_caja_chica` gana `tipoGastoCajaChicaId` y
  `numeroPreimpreso` (ambos opcionales).
- `ModalGasto` (registrar vale): nuevos campos de tipo de gasto y
  número preimpreso; el select de cuenta contable se pre-selecciona a
  una cuenta "No Deducibles" si existe en el plan de cuentas (sugerido,
  no bloqueado — el usuario puede cambiarlo).

## Verificación

- `node --test`: 73/73 (68 previos + 5 nuevos de `cajaChicaSaldo`).
- `npx vitest run` / `npx eslint` / `npx vite build`: sin errores
  nuevos (1 warning preexistente sin relación, `empresaId` sin usar en
  `FondoDetalle`, ya estaba antes de esta sesión).
- **Verificado end-to-end contra la BD local** (no solo lectura de
  código): fondo QATEST con $100 → compra QATEST de $23 → pago con
  caja chica → confirmado (a) saldo del fondo bajó a $77, (b)
  `movimientos_caja_chica` con `facturaCompraId`/`pagoProveedorId`
  correctos, (c) el asiento acredita `1.1.01.002 Caja Chica` (no un
  banco genérico) — `{CxP: debe 23} / {Caja Chica: haber 23}`. Anulado
  el pago → saldo del fondo volvió a $100, asiento reverso correcto
  (`{CxP: haber 23} / {Caja Chica: debe 23}`). Fase 2: fondo QATEST →
  vale de $8 con tipo de gasto "Alimentación" y número preimpreso →
  confirmado que persiste y que `GET /caja-chica/:id` devuelve la
  relación `tipoGasto` con el nombre correcto. Todos los datos QATEST
  limpiados al terminar (los 6 tipos de gasto sembrados SÍ se
  conservaron — son catálogo real, no datos de prueba).

## No incluido (documentado en el plan como fuera de alcance)

- La clasificación SRI explícita (13 tipos de sustento, ~15 tipos de
  compra ATS 500-540) sigue siendo auto-inferida en TODO el módulo de
  Compras (no solo caja chica) — hallazgo preexistente, no tocado para
  no dejar el sistema inconsistente entre compras normales y de caja
  chica.
- Fase 3 (apertura/reposición como pago real con cheque/banco
  específico + selección manual con checkboxes para reposición) y Fase
  4 (Comprobante de Contabilización) del plan — quedaron aprobadas pero
  no implementadas hoy, son pulido, no bloquean el resultado fiscal
  real que pedía el usuario.
- "Comprobante de Liquidación", pantalla de Reportes dedicada, selector
  de Bodega — explícitamente fuera de alcance en el plan (AELA no tiene
  bodegas múltiples; liquidación parcial y reportes no se vieron en las
  capturas).

## Pendiente para retomar

- Decidir si vale la pena Fase 3/4, o si Fase 1+2 ya cubren la
  necesidad real.
- Agregar una UI para gestionar el catálogo "Tipo de gasto de caja
  chica" (hoy el CRUD backend existe completo, pero el frontend solo
  lee la lista — no hay botón "+" para agregar/editar categorías desde
  la pantalla, a diferencia del "..." de la referencia).
- Confirmar que las columnas/tabla nuevas se crearon bien en producción
  tras el próximo despliegue (mismo mecanismo automático de
  `applySchemaFixes.js` de siempre).
