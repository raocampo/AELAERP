# AVALAB vs AELA y cobros CxC en Bancos — 2026-11-10

## 1. Conciliación AVALAB → AELA (Laboratorio San José)

Fuentes: exportes de AVALAB `octubre2026.xls` y `NOV 2026.xls` (este último
dañado; se abrió convirtiéndolo con Excel) y exporte de AELA
`ventas-2026-11-06.xlsx` (solo trae 20–31 de octubre). No se consultó la BD
de producción. Resultado detallado por comprobante:
`UtilitariosSCFI/AVALAB/conciliacion-avalab-aela-2026-11-10.xlsx`.

| Categoría | Comprob. | Total |
| --- | ---: | ---: |
| En AELA, total y fecha idénticos | 82 | 5,978.97 |
| Antes del arranque del web service (1–19 oct) | 234 | 22,223.21 |
| **Faltan: emitidas desde el 20 oct y no llegaron** | **54** | **4,981.76** |
| Noviembre (el exporte de AELA no incluye noviembre) | 53 | 4,164.23 |
| Notas de crédito de AVALAB (la API no las recibe) | 4 | 498.45 |
| Anuladas en AVALAB / total 0 | 7 | 0.00 |

- Ninguna factura de AELA está ausente en AVALAB ni difiere en total o fecha.
- De las 54 faltantes, 32 son del 20–21 oct (arranque) y 22 del 22–31 oct
  intercaladas con otras que sí llegaron. 44 están "Pagado" y 10 "Hábil" en
  AVALAB: el estado no explica la omisión. Sin logs de producción o del lado
  de AVALAB no se puede saber si AELA las rechazó o AVALAB no las envió.
- Las notas de crédito de AVALAB anulan facturas que luego se reemiten
  (094 ↔ 11223/11224 por $124; 095 ↔ 11312 por $26.45; 096 ↔ 11349/11350
  por $230). Si llegan ambas facturas y no la NC, AELA sobrestima ventas.

Pendiente de decisión: cargar las faltantes (reenvío desde AVALAB, que es
idempotente por `claveAcceso`, o importación desde los XML autorizados),
agregar endpoints de nota de crédito y anulación a la API, y revisar si
AVALAB envía los cobros (`POST /pagos`).

## 2. Cobros CxC por transferencia sin movimiento en Bancos (resuelto)

Causa: `crearAsientoCobroCliente` debitaba la cuenta genérica `1.1.02.001
Bancos` y nunca creaba la fila en Libro de Bancos, aunque el cobro guardara
`bancoId`.

Corrección (commit `d9bea4c`):

- El asiento usa la cuenta contable del banco elegido.
- Transferencia/tarjeta (`TRANSFERENCIA_IN`) y cheque con banco (`DEPOSITO`)
  crean el ingreso en Libro de Bancos, enlazado por
  `cobros_cliente.movimientoBancarioId` (columna nueva, migración +
  `applySchemaFixes.js`). Anular el cobro crea un `RETIRO` de reverso.
- Cobro en ruta del vendedor: su movimiento ya existía; ahora se enlaza al
  crearlo y al verificarlo no se duplica. Su tipo pasó de `INGRESO` (no
  válido en Bancos) a `TRANSFERENCIA_IN`.
- CxC exige banco para transferencia/tarjeta (backend y formulario).
- `scripts/backfillMovimientosCobros.js`: lista los cobros ya registrados
  sin movimiento; con `--apply` los crea. No cambia asientos antiguos.

Sigue sin banco: `POST /api/ext/v1/pagos` (AVALAB no conoce los IDs de banco
de AELA) y la importación de cobros por Excel. Sus transferencias quedan en
la cuenta genérica hasta definir un banco por defecto.

Validación: 208/208 pruebas backend (4 nuevas con BD simulada), `prisma
validate` y ESLint del formulario.

## 3. Verificación contra producción (solo lectura, autorizada)

Consulta al tenant `labsanjose` vía `railway ssh` al contenedor AELAERP,
dentro de una transacción `READ ONLY` (solo `findMany`/`count`). Al abrir la
conexión, `getTenantPrisma` ejecutó su verificación habitual de esquema
(idempotente, igual que cualquier request). Resultado:
`UtilitariosSCFI/AVALAB/conciliacion-avalab-aela-produccion-2026-11-10.xlsx`.

- AELA: 168 facturas (11199–11438, hasta el 10/11 12:20), todas
  AUTORIZADO, origen WEBSERVICE, sin duplicados, todas con asiento.
- Las 129 que también están en los exportes de AVALAB coinciden en total y
  fecha; las 39 restantes son posteriores al exporte del 06/11.
- **Faltan 60 facturas por $5,477.22** (20/10–06/11; las anuladas y las de
  total 0 de convenio no cuentan). Siguen faltando las del 20–21/10 y
  aparecen también en noviembre.
- **Patrón**: de las facturas cuya fecha de "Actualización" en AVALAB es
  posterior a la emisión, llegaron 124 de 127; de las que no tienen
  actualización posterior, faltan 28 de 30. Apunta a la selección del envío
  en AVALAB (marca de agua por fecha de actualización), no a un rechazo de
  AELA: AELA no tiene registro parcial ni duplicado de ninguna.
  Los reemplazos tras NC (11312, 11350) están entre las faltantes.
- **Cobros: 0** en AELA. AVALAB no llama `POST /pagos`; las 168 facturas
  figuran como saldo por cobrar ($13,587.12) aunque en AVALAB casi todas
  están "Pagado". Los exportes no traen fecha ni forma de pago.
- Notas de crédito: 0 (no hay endpoint).

Acciones sugeridas: que AVALAB corrija la selección y reenvíe las 60
(idempotente por `claveAcceso`; el Excel no trae clave ni ítems, por lo que
AELA no puede crearlas con fidelidad), que implemente `POST /pagos`, y
agregar a la API endpoints de nota de crédito y anulación.
