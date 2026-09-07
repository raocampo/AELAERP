const { round2 } = require('./contabilidad');
const { desglosarEfectivoBanco } = require('./pagosVenta');

const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

// Agrupa facturas + notas de venta de un año por mes calendario, con
// desglose efectivo/bancos (desglosarEfectivoBanco, ya usado en el
// Dashboard). `facturas`/`notas` son filas de Prisma tal cual —
// fechaEmision es un campo "solo-fecha" (medianoche UTC exacta), por eso
// getUTCMonth() y no getMonth() (ver comentario en estadisticas.js).
function calcularTotalesMensuales(facturas = [], notas = []) {
  const meses = Array.from({ length: 12 }, (_, i) => ({
    mes: i + 1,
    nombre: NOMBRES_MES[i],
    ventasFacturas: 0,
    ventasNotas: 0,
    ventasTotal: 0,
    efectivo: 0,
    banco: 0,
    comprobantes: 0,
    ticketPromedio: 0,
  }));

  facturas.forEach((f) => {
    const m = meses[f.fechaEmision.getUTCMonth()];
    m.ventasFacturas += Number(f.importeTotal || 0);
    m.comprobantes += 1;
    const d = desglosarEfectivoBanco({ pagos: f.pagos, importeTotal: f.importeTotal });
    m.efectivo += d.efectivo;
    m.banco += d.banco;
  });
  notas.forEach((n) => {
    const m = meses[n.fechaEmision.getUTCMonth()];
    m.ventasNotas += Number(n.total || 0);
    m.comprobantes += 1;
    const d = desglosarEfectivoBanco({ pagos: n.pagos, total: n.total, formaPago: n.formaPago });
    m.efectivo += d.efectivo;
    m.banco += d.banco;
  });

  meses.forEach((m) => {
    m.ventasFacturas = round2(m.ventasFacturas);
    m.ventasNotas = round2(m.ventasNotas);
    m.ventasTotal = round2(m.ventasFacturas + m.ventasNotas);
    m.efectivo = round2(m.efectivo);
    m.banco = round2(m.banco);
    m.ticketPromedio = m.comprobantes > 0 ? round2(m.ventasTotal / m.comprobantes) : 0;
  });

  const totalAnio = round2(meses.reduce((a, m) => a + m.ventasTotal, 0));
  const totalEfectivo = round2(meses.reduce((a, m) => a + m.efectivo, 0));
  const totalBanco = round2(meses.reduce((a, m) => a + m.banco, 0));
  const comprobantesAnio = meses.reduce((a, m) => a + m.comprobantes, 0);
  const ticketPromedioAnio = comprobantesAnio > 0 ? round2(totalAnio / comprobantesAnio) : 0;

  return { meses, totalAnio, totalEfectivo, totalBanco, comprobantesAnio, ticketPromedioAnio };
}

// null cuando el año anterior no tuvo ventas — evita dividir por cero y le
// da al frontend una señal explícita de "sin dato" en vez de mostrar 0%.
function calcularVariacionPct(actual, anterior) {
  if (!anterior || anterior <= 0) return null;
  return round2(((actual - anterior) / anterior) * 100);
}

// Acumula cantidad/monto por producto a partir de los JSON `detalles` de
// facturas/notas de venta (no existe tabla relacional de líneas de venta).
// `monto` es base sin IVA (cantidad*precioUnitario - descuento) — sirve
// para "qué se vendió más", no es un reporte tributario.
function acumularTopProductos(listasDeDetalles = [], limit = 10) {
  const acumulado = new Map();
  for (const detalles of listasDeDetalles) {
    for (const d of (detalles || [])) {
      const key = d.codigoPrincipal || d.descripcion || 'SIN_CODIGO';
      const cantidad = Number(d.cantidad || 0);
      const monto = cantidad * Number(d.precioUnitario || 0) - Number(d.descuento || 0);
      if (!acumulado.has(key)) {
        acumulado.set(key, { codigo: d.codigoPrincipal || '', descripcion: d.descripcion || key, cantidad: 0, monto: 0 });
      }
      const item = acumulado.get(key);
      item.cantidad += cantidad;
      item.monto += monto;
    }
  }
  return [...acumulado.values()]
    .map((i) => ({ ...i, cantidad: round2(i.cantidad), monto: round2(i.monto) }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, limit);
}

module.exports = { NOMBRES_MES, calcularTotalesMensuales, calcularVariacionPct, acumularTopProductos };
