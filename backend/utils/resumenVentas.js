// ====================================
// Resumen de ventas (facturas) por forma de cobro — espejo del "Resumen por
// clasificación de gasto" de Compras. Lo usa GET /api/facturas.
//
// Solo cuentan las facturas vigentes: no anuladas ni rechazadas. Una factura
// con varias formas de pago se reparte proporcionalmente al valor de cada una,
// así la suma de los grupos coincide con el total general.
// ====================================

const { categoriaFormaPago } = require('./formasPago');

const ETIQUETAS = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  APP: 'App móvil',
  CHEQUE: 'Cheque',
  OTRO_FINANCIERO: 'Otros con sistema financiero',
  SIN_DETALLE: 'Sin forma de pago registrada',
};
const ORDEN = Object.keys(ETIQUETAS);

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;

const esVigente = (f) => !f.anulada && !['ANULADO', 'RECHAZADO'].includes(f.estadoSri);

function montosFactura(f) {
  return {
    base0: n(f.subtotal0) + n(f.subtotalNoObjetoIva),
    baseIva: n(f.subtotal5) + n(f.subtotal12) + n(f.subtotal15),
    iva: n(f.totalIva),
    total: n(f.importeTotal),
  };
}

// [{ categoria, peso }] con pesos que suman 1
function repartoPorForma(pagos) {
  const lista = (Array.isArray(pagos) ? pagos : []).filter((p) => n(p.total) > 0);
  const suma = lista.reduce((s, p) => s + n(p.total), 0);
  if (!lista.length || suma <= 0) return [{ categoria: 'SIN_DETALLE', peso: 1 }];
  const pesos = new Map();
  for (const p of lista) {
    const c = categoriaFormaPago(p);
    pesos.set(c, (pesos.get(c) || 0) + n(p.total) / suma);
  }
  return [...pesos].map(([categoria, peso]) => ({ categoria, peso }));
}

function resumenVentas(facturas) {
  const totales = { facturas: 0, base0: 0, baseIva: 0, iva: 0, total: 0, anuladas: 0, rechazadas: 0 };
  const grupos = new Map();
  for (const f of facturas) {
    if (!esVigente(f)) {
      if (f.estadoSri === 'RECHAZADO' && !f.anulada) totales.rechazadas++;
      else totales.anuladas++;
      continue;
    }
    const m = montosFactura(f);
    totales.facturas++;
    totales.base0 += m.base0; totales.baseIva += m.baseIva; totales.iva += m.iva; totales.total += m.total;
    for (const { categoria, peso } of repartoPorForma(f.pagos)) {
      const g = grupos.get(categoria) || { categoria, etiqueta: ETIQUETAS[categoria] || categoria, facturas: 0, base0: 0, baseIva: 0, iva: 0, total: 0 };
      g.facturas++;
      g.base0 += m.base0 * peso; g.baseIva += m.baseIva * peso; g.iva += m.iva * peso; g.total += m.total * peso;
      grupos.set(categoria, g);
    }
  }
  for (const k of ['base0', 'baseIva', 'iva', 'total']) totales[k] = r2(totales[k]);
  const lista = [...grupos.values()]
    .map((g) => ({ ...g, base0: r2(g.base0), baseIva: r2(g.baseIva), iva: r2(g.iva), total: r2(g.total) }))
    .sort((a, b) => ORDEN.indexOf(a.categoria) - ORDEN.indexOf(b.categoria));
  return { totales, grupos: lista };
}

module.exports = { resumenVentas, repartoPorForma };
