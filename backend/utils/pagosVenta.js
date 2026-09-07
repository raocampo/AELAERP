const { requiereBanco, esEfectivo } = require('./formasPago');
const { registrarMovimientoBancarioLigado } = require('./contabilidad');

// Validación real (no solo de UI): rechaza pagos con transferencia/tarjeta/
// app móvil que no traigan bancoId. Se llama antes de abrir la transacción
// de la venta (fail-fast).
function validarPagosConBanco(pagos = []) {
  const faltante = pagos.find((p) => requiereBanco(p) && !p.bancoId);
  if (faltante) {
    const err = new Error('Debe seleccionar una cuenta bancaria para pagos con transferencia, tarjeta o app móvil');
    err.status = 400;
    throw err;
  }
}

// Crea (o reversa) el movimiento real en el módulo Bancos por cada línea de
// pago no-efectivo de una venta. Reusa el mismo helper que ya usa Cuentas
// por Pagar (backend/utils/contabilidad.js) para no reimplementar
// numeración/saldoParcial.
async function registrarMovimientosBancariosDeVenta({
  pagos = [],
  empresaId,
  fecha,
  numero,
  tipoDocumento,
  esReverso = false,
  db,
}) {
  const resultados = [];
  for (const p of pagos) {
    if (!requiereBanco(p)) continue;
    resultados.push(await registrarMovimientoBancarioLigado({
      bancoId: p.bancoId,
      empresaId,
      fecha,
      tipo: esReverso ? 'TRANSFERENCIA_OUT' : 'TRANSFERENCIA_IN',
      concepto: `${esReverso ? 'Reverso venta' : 'Venta'} ${tipoDocumento} ${numero}`,
      referencia: p.referencia || null,
      monto: p.total,
      esIngreso: !esReverso,
      asientoId: null,
      chequeId: null,
      db,
    }));
  }
  return resultados;
}

// Reparte el total de una factura/nota de venta entre efectivo y banco, para
// KPIs (Dashboard) que necesitan el desglose sin depender de Caja Diaria
// (que puede estar deshabilitada por empresa). `fila` es la factura/nota tal
// cual viene de Prisma: usa `fila.pagos` (array) si existe, si no cae al
// pago único (`fila.formaPago` + `fila.total`/`fila.importeTotal`).
function desglosarEfectivoBanco(fila) {
  const lineas = Array.isArray(fila.pagos) && fila.pagos.length
    ? fila.pagos
    : [{ formaPago: fila.formaPago || 'Efectivo', total: fila.total ?? fila.importeTotal ?? 0 }];

  let efectivo = 0;
  let banco = 0;
  for (const p of lineas) {
    const monto = Number(p.total || 0);
    if (esEfectivo(p)) efectivo += monto; else banco += monto;
  }
  return { efectivo, banco };
}

module.exports = { validarPagosConBanco, registrarMovimientosBancariosDeVenta, desglosarEfectivoBanco };
