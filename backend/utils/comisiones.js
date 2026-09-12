// Comisiones del Agente Vendedor (Fase 4). Ver docs/roadmap-agente-vendedor.md.
// Comisión mixta sobre el subtotal SIN IVA: una parte se devenga al facturar
// el pedido, otra al cobrarlo. Porcentajes configurables por la empresa en
// configuracion_sistema (comisionVendedorFacturar/comisionVendedorCobrar) —
// política única por empresa, sin override por vendedor individual por ahora.
const { round2 } = require('./contabilidad');
const { asegurarConfiguracionSistemaEmpresa } = require('./configuracionSistema');

// Devenga la comisión "al facturar" cuando un pedido del vendedor se
// convierte en factura. Se llama desde proformas.js POST /:id/marcar-convertida
// solo si la proforma tiene vendedorId. `subtotalSinIva` = importeTotal de la
// factura menos su totalIva.
async function devengarComisionFacturacion({ db, empresaId, vendedorId, facturaId, subtotalSinIva, fecha = new Date() }) {
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, db);
  const pct = Number(config?.comisionVendedorFacturar || 0);
  const base = round2(subtotalSinIva);
  const monto = round2(base * pct / 100);
  if (!(pct > 0) || !(monto > 0.005)) return null;

  return db.comision_devengada.create({
    data: { empresaId, vendedorId, origen: 'FACTURACION', facturaId, base, porcentaje: pct, monto, fecha },
  });
}

// Devenga la comisión "al cobrar" cuando se registra un cobro contra una
// factura que tiene vendedorId. El cobro puede ser parcial: se calcula la
// porción neta (sin IVA) proporcional al monto cobrado, no el monto bruto.
async function devengarComisionCobro({
  db, empresaId, vendedorId, facturaId, cobroId, montoCobro, importeTotalFactura, totalIvaFactura, fecha = new Date(),
}) {
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, db);
  const pct = Number(config?.comisionVendedorCobrar || 0);
  if (!(pct > 0) || !(Number(montoCobro) > 0) || !(Number(importeTotalFactura) > 0)) return null;

  const proporcionNeta = 1 - (Number(totalIvaFactura) / Number(importeTotalFactura));
  const base = round2(Number(montoCobro) * Math.max(0, proporcionNeta));
  const monto = round2(base * pct / 100);
  if (!(monto > 0.005)) return null;

  return db.comision_devengada.create({
    data: { empresaId, vendedorId, origen: 'COBRO', facturaId, cobroId, base, porcentaje: pct, monto, fecha },
  });
}

module.exports = { devengarComisionFacturacion, devengarComisionCobro };
