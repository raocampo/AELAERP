// ====================================
// utils/cajaChicaSaldo.js — Cálculo de saldo de un fondo de caja chica
// Extraído de routes/cajaChica.js para reutilizar la MISMA lógica desde
// routes/cxp.js (pago de una compra con caja chica también debe respetar
// el saldo disponible del fondo) — evita que las dos rutas diverjan.
// ====================================
const { round2 } = require('./contabilidad');

// APERTURA + REPOSICION + INCREMENTO → positivos
// GASTO + DISMINUCION + COMPRA → negativos (COMPRA = facturas_compra real
// pagada con el fondo, ver movimientos_caja_chica.facturaCompraId)
// CIERRE no se descuenta (ya cierra el fondo)
function calcularSaldoCajaChica(movimientos) {
  return round2(
    movimientos.reduce((acc, m) => {
      if (m.anulado) return acc;
      if (['APERTURA', 'REPOSICION', 'INCREMENTO'].includes(m.tipo)) return acc + Number(m.monto);
      if (['GASTO', 'DISMINUCION', 'COMPRA'].includes(m.tipo)) return acc - Number(m.monto);
      return acc;
    }, 0),
  );
}

// Gastos/compras pendientes de reponer (desde la última REPOSICION o desde APERTURA)
function gastosPendientesReponerCajaChica(movimientos) {
  const movOrdenados = [...movimientos].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  const ultimaRepo = movOrdenados.filter((m) => !m.anulado && m.tipo === 'REPOSICION').at(-1);
  const desde = ultimaRepo ? new Date(ultimaRepo.fecha) : null;
  return movOrdenados.filter(
    (m) => !m.anulado && ['GASTO', 'COMPRA'].includes(m.tipo) && (!desde || new Date(m.fecha) > desde),
  );
}

module.exports = { calcularSaldoCajaChica, gastosPendientesReponerCajaChica };
