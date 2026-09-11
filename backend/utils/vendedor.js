// Helpers del módulo Agente Vendedor. Ver docs/roadmap-agente-vendedor.md.
const { round2 } = require('./contabilidad');
const { normalizarRol } = require('./roles');

// Solo facturas que representan una venta real (mismo criterio que
// empresas.js/estadisticas.js).
const ESTADOS_FACTURA_VALIDOS = ['AUTORIZADO', 'HISTORICO'];

// Filtro de scoping: un usuario con rol EXACTAMENTE 'vendedor' solo ve los
// clientes asignados a él (clientes.vendedorId). admin/supervisor (que
// también tienen los permisos vendedor.*) ven todo → filtro vacío.
function scopeVendedor(usuario) {
  return normalizarRol(usuario?.rol) === 'vendedor' && usuario?.id
    ? { vendedorId: usuario.id }
    : {};
}

// groupBy(sum) genérico → Map(claveDelBy → suma redondeada). Devuelve Map
// vacío si no hay ids que consultar (evita un query innecesario).
async function agruparSuma(model, where, byField, sumField) {
  const ids = where[byField]?.in;
  if (!Array.isArray(ids) || ids.length === 0) return new Map();
  const filas = await model.groupBy({ by: [byField], where, _sum: { [sumField]: true } });
  return new Map(
    filas
      .filter((f) => f[byField] != null)
      .map((f) => [f[byField], round2(f._sum[sumField] || 0)]),
  );
}

// Saldo pendiente por cliente (Map clienteId → saldo) a partir de sus
// facturas autorizadas: importeTotal − cobros no anulados − NC autorizadas.
// Mismo cálculo que backend/routes/cxc.js (calcularSaldoConNC).
async function saldoPendientePorCliente(db, empresaId, clienteIds) {
  if (!Array.isArray(clienteIds) || clienteIds.length === 0) return new Map();

  const facturas = await db.facturas.findMany({
    where: {
      empresaId,
      clienteId: { in: clienteIds },
      anulada: false,
      estadoSri: { in: ESTADOS_FACTURA_VALIDOS },
    },
    select: { id: true, clienteId: true, importeTotal: true },
  });
  const fIds = facturas.map((f) => f.id);
  const [cobrados, notasCredito] = await Promise.all([
    agruparSuma(db.cobros_cliente, { empresaId, facturaId: { in: fIds }, anulado: false }, 'facturaId', 'monto'),
    agruparSuma(db.notas_credito, { empresaId, facturaId: { in: fIds }, estadoSri: 'AUTORIZADO', anulada: false }, 'facturaId', 'importeTotal'),
  ]);

  const porCliente = new Map();
  for (const f of facturas) {
    const saldo = Number(f.importeTotal) - (cobrados.get(f.id) || 0) - (notasCredito.get(f.id) || 0);
    if (saldo > 0.005) {
      porCliente.set(f.clienteId, round2((porCliente.get(f.clienteId) || 0) + saldo));
    }
  }
  return porCliente;
}

// Estado de cuenta de UN cliente: lista de facturas con saldo > 0 y el total.
async function estadoCuentaCliente(db, empresaId, clienteId) {
  const facturas = await db.facturas.findMany({
    where: {
      empresaId,
      clienteId,
      anulada: false,
      estadoSri: { in: ESTADOS_FACTURA_VALIDOS },
    },
    select: { id: true, numeroFactura: true, fechaEmision: true, importeTotal: true },
    orderBy: { fechaEmision: 'desc' },
  });
  const fIds = facturas.map((f) => f.id);
  const [cobrados, notasCredito] = await Promise.all([
    agruparSuma(db.cobros_cliente, { empresaId, facturaId: { in: fIds }, anulado: false }, 'facturaId', 'monto'),
    agruparSuma(db.notas_credito, { empresaId, facturaId: { in: fIds }, estadoSri: 'AUTORIZADO', anulada: false }, 'facturaId', 'importeTotal'),
  ]);

  const facturasPendientes = facturas
    .map((f) => ({
      id: f.id,
      numeroFactura: f.numeroFactura,
      fechaEmision: f.fechaEmision,
      importeTotal: Number(f.importeTotal),
      cobrado: cobrados.get(f.id) || 0,
      notaCredito: notasCredito.get(f.id) || 0,
      saldo: round2(Number(f.importeTotal) - (cobrados.get(f.id) || 0) - (notasCredito.get(f.id) || 0)),
    }))
    .filter((f) => f.saldo > 0.005);

  const saldoTotal = round2(facturasPendientes.reduce((a, f) => a + f.saldo, 0));
  return { saldoTotal, facturasPendientes };
}

module.exports = { scopeVendedor, saldoPendientePorCliente, estadoCuentaCliente, agruparSuma, ESTADOS_FACTURA_VALIDOS };
