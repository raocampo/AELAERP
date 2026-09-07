# Bancos como destino real de ventas no-efectivo — 2026-09-07

## Problema reportado

El usuario confirmó como resueltos varios pendientes de sesiones
anteriores (POS línea manual, editar NV, modal anulación, proforma,
descuento general, módulo Estadísticas — todos probados en producción
real) y reportó uno nuevo: **cuando se cobra con transferencia en el
POS, ese pago no se ve en ningún lado**.

## Diagnóstico

Una venta pagada con transferencia/tarjeta/app móvil nunca creaba
ningún registro en el módulo Bancos (`movimientos_bancarios`) — solo
caía en `caja_movimientos` (Caja Diaria) igual que el efectivo,
distinguida apenas por un texto libre. Efecto colateral encontrado de
paso: `calcularResumenDesdeMovimientos` sumaba TODAS las ventas al
"efectivo esperado" del cuadre de cierre, sin importar el método de
pago — una venta con transferencia inflaba el efectivo que "debería"
estar físicamente en la caja.

Ver el plan completo (con hallazgos file:line, diseño y verificación)
en la memoria de la sesión.

## Implementado (commit `c18caa2`)

1. **Vocabulario canónico** (`backend/utils/formasPago.js` +
   espejo frontend) — clasifica cualquier combinación `{uid, formaPago}`
   de los 3 formularios existentes (POS, FormFactura, FormNotaVenta) en
   EFECTIVO/TARJETA/TRANSFERENCIA/APP/CHEQUE, sin tocar los vocabularios
   originales (algunos van tal cual al XML del SRI). Resuelve la
   colisión real: Transferencia y Cheque comparten `sriCodigo` '20' en
   POS-factura y FormFactura — se distinguen agregando el `uid` original
   al payload.
2. **Backend — validación real** (`backend/utils/pagosVenta.js`,
   `validarPagosConBanco`): rechaza con 400 un pago con
   transferencia/tarjeta/app sin `bancoId`, antes de abrir la
   transacción. Se hace cumplir en los 6 call sites de
   `facturas.js`/`notasVenta.js` (creación, anulación, y
   revertir+reaplicar de la edición de nota de venta).
3. **Backend — movimiento bancario real**
   (`registrarMovimientosBancariosDeVenta`, reusa
   `registrarMovimientoBancarioLigado` de `contabilidad.js`, mismo
   patrón que ya usa Cuentas por Pagar): crea `TRANSFERENCIA_IN` al
   vender, `TRANSFERENCIA_OUT` al anular/revertir.
4. **Cuadre de Caja Diaria corregido**: nueva columna
   `caja_movimientos.esEfectivo` (schema.prisma +
   `applySchemaFixes.js`), una fila de caja POR LÍNEA de pago (antes
   era una fila agregada por venta). `calcularResumenDesdeMovimientos`
   sigue sumando TODO a "Ventas" (informativo), pero "Esperado" (el que
   se compara contra el conteo físico de cierre) ahora excluye
   transferencia/tarjeta/app.
5. **Frontend**: selector de cuenta bancaria (`bancoId`) obligatorio
   por línea de pago cuando la forma de pago lo requiere, en los 3
   formularios (`PuntoVenta.jsx`, `FormFactura.jsx`,
   `FormNotaVenta.jsx`). Hook `useBancos()` extraído a
   `frontend/src/hooks/useBancos.js` (antes duplicado localmente en
   `CuentasPorPagarHub.jsx`).

**Alcance de "requiere banco"**: Transferencia + Tarjeta + App Móvil
(decisión del usuario). Cheque queda sin cambios — sigue con su campo
libre "banco emisor" (el banco DEL CLIENTE que emitió el cheque, no una
cuenta propia) — un cheque no es dinero en el banco hasta que se
deposita, ciclo de vida distinto (tabla `cheques` ya existe pero no
está conectada a este flujo).

**Bug propio encontrado y corregido en el camino**: para un pago único
(no mixto) no-efectivo en Nota de Venta, `pagos` se guardaba `null` en
BD (comportamiento previo para el caso no-mixto) — eso habría perdido
el `bancoId` y roto la reversión al anular/editar esa nota más
adelante (`registrarMovimientoBancarioLigado` lanza si `bancoId` falta).
Corregido: se persiste `pagos` también cuando el pago único requiere
banco (sigue `null` para Efectivo/Cheque, sin cambios visuales en el
PDF/ticket para el caso común).

## Verificación

- 94/94 tests backend (`npm test`), 25/25 frontend (`vitest`), `vite
  build` y `eslint` limpios.
- **Verificación real contra Postgres local** (no solo mocks): empresa
  de prueba aislada (nunca tocó `empresaId` 1 o 2, que tienen datos
  reales), venta mixta efectivo+transferencia → confirma que Bancos
  recibe el movimiento correcto, Caja Diaria separa "Ventas" (100) de
  "Esperado" (30, solo el efectivo), y que anular reversa ambos lados
  simétricamente. Datos de prueba borrados al terminar.
- Columna `esEfectivo` ya aplicada a la BD local (`aela_db`) vía
  `applySchemaFixes.js`. En producción (Railway) se aplicará sola en el
  próximo despliegue (`applySchemaFixes.js` corre en cada arranque del
  backend).

## Pendiente — falta probar clic a clic en la app real

No se probó en el navegador (sin backend+frontend corriendo en esta
sesión más allá de scripts puntuales). Antes de dar por cerrado del
todo:
1. Cobrar en POS con transferencia (factura y nota de venta) → elegir
   banco → confirmar que aparece en Bancos y que Caja Diaria no infla
   "Esperado".
2. Repetir con un pago MIXTO (efectivo + transferencia) desde POS.
3. Repetir desde `FormFactura.jsx` y `FormNotaVenta.jsx` (fuera del
   POS) para confirmar que los 3 formularios piden banco de forma
   consistente.
4. Anular una de esas ventas y confirmar que el movimiento en Bancos se
   reversa (aparece un `TRANSFERENCIA_OUT`).
5. Editar una nota de venta con pago único por transferencia (no mixto)
   y confirmar que la reversión no explota (el bug propio corregido
   arriba era justo este caso).
