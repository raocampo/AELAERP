const prisma = require('../config/prisma');

const round2 = (n) => Number((Number(n || 0)).toFixed(2));

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function endOfMonth(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfMonth(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function extractSequence(numero) {
  const match = String(numero || '').match(/(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function siguienteNumeroAsiento({ empresaId, fecha = new Date(), tx = prisma }) {
  const empresaIdNum = toInt(empresaId);
  if (!empresaIdNum) throw new Error('empresaId es requerido para numerar el asiento');

  const inicio = startOfMonth(fecha);
  const fin = endOfMonth(fecha);
  const ultimo = await tx.asientos_contables.findFirst({
    where: {
      empresaId: empresaIdNum,
      fecha: { gte: inicio, lte: fin },
    },
    orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
    select: { numero: true },
  });

  const consecutivo = extractSequence(ultimo?.numero) + 1;
  const date = new Date(fecha);
  const periodo = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  return `${periodo}-${String(consecutivo).padStart(4, '0')}`;
}

async function ensureCuentaMovimiento({
  empresaId,
  codigo,
  nombre,
  tipo,
  naturaleza,
  nivel = 4,
  codigoPadre = null,
  tx = prisma,
}) {
  const empresaIdNum = toInt(empresaId);
  if (!empresaIdNum) throw new Error('empresaId es requerido para asegurar cuentas contables');
  if (!codigo || !nombre || !tipo || !naturaleza) {
    throw new Error('codigo, nombre, tipo y naturaleza son requeridos para la cuenta contable');
  }

  const existente = await tx.plan_cuentas.findFirst({
    where: { empresaId: empresaIdNum, codigo },
  });

  if (existente) {
    return tx.plan_cuentas.update({
      where: { id: existente.id },
      data: {
        nombre,
        tipo,
        naturaleza,
        nivel: Number.isFinite(Number(nivel)) ? Number(nivel) : existente.nivel,
        codigoPadre: codigoPadre || existente.codigoPadre || null,
        aceptaMovimiento: true,
        activo: true,
      },
    });
  }

  return tx.plan_cuentas.create({
    data: {
      empresaId: empresaIdNum,
      codigo,
      nombre,
      nivel: Number.isFinite(Number(nivel)) ? Number(nivel) : 4,
      tipo,
      naturaleza,
      codigoPadre: codigoPadre || null,
      aceptaMovimiento: true,
      activo: true,
    },
  });
}

function normalizarDetalles(detalles = []) {
  if (!Array.isArray(detalles) || detalles.length < 2) {
    throw new Error('descripcion y al menos 2 detalles son requeridos');
  }

  const normalizados = detalles.map((d) => ({
    cuentaId: toInt(d.cuentaId),
    descripcion: d.descripcion || null,
    debe: round2(d.debe || 0),
    haber: round2(d.haber || 0),
  }));

  if (normalizados.some((d) => !d.cuentaId || (d.debe <= 0 && d.haber <= 0) || (d.debe > 0 && d.haber > 0))) {
    throw new Error('Cada detalle debe tener cuentaId y solo un valor positivo (debe o haber)');
  }

  const totalDebe = round2(normalizados.reduce((acc, d) => acc + d.debe, 0));
  const totalHaber = round2(normalizados.reduce((acc, d) => acc + d.haber, 0));
  if (totalDebe !== totalHaber) {
    throw new Error(`Partida descuadrada: debe=${totalDebe} haber=${totalHaber}`);
  }

  return { normalizados, totalDebe, totalHaber };
}

async function validarCuentasMovimiento({ empresaId, detalles, tx = prisma }) {
  const empresaIdNum = toInt(empresaId);
  const cuentaIds = [...new Set(detalles.map((d) => d.cuentaId))];
  const cuentas = await tx.plan_cuentas.findMany({
    where: {
      empresaId: empresaIdNum,
      id: { in: cuentaIds },
    },
  });

  if (cuentas.length !== cuentaIds.length) {
    throw new Error('Una o más cuentas no existen para la empresa actual');
  }

  if (cuentas.some((c) => !c.aceptaMovimiento || !c.activo)) {
    throw new Error('Solo cuentas activas y de movimiento pueden usarse en asientos');
  }

  return cuentas;
}

async function crearAsientoContable({
  empresaId,
  fecha = new Date(),
  descripcion,
  tipo = 'MANUAL',
  referencia = null,
  facturaId = null,
  cajaId = null,
  usuarioId = null,
  detalles = [],
  cerrado = false,
  tx = prisma,
}) {
  const empresaIdNum = toInt(empresaId);
  if (!empresaIdNum) throw new Error('empresaId es requerido para crear el asiento');
  if (!descripcion) throw new Error('descripcion es requerida');

  const { normalizados, totalDebe, totalHaber } = normalizarDetalles(detalles);
  await validarCuentasMovimiento({ empresaId: empresaIdNum, detalles: normalizados, tx });

  const numero = await siguienteNumeroAsiento({ empresaId: empresaIdNum, fecha, tx });

  return tx.asientos_contables.create({
    data: {
      empresaId: empresaIdNum,
      numero,
      fecha: new Date(fecha),
      descripcion,
      tipo,
      referencia,
      facturaId: toInt(facturaId),
      cajaId: toInt(cajaId),
      totalDebe,
      totalHaber,
      cerrado: Boolean(cerrado),
      usuarioId: toInt(usuarioId),
      detalles: { create: normalizados },
    },
    include: {
      detalles: {
        include: { cuenta: true },
        orderBy: { id: 'asc' },
      },
    },
  });
}

async function crearAsientoNominaPeriodo() {
  throw new Error('El módulo de nómina no está implementado en esta versión de AELA');
}

async function crearAsientoPagoNominaPeriodo() {
  throw new Error('El módulo de nómina no está implementado en esta versión de AELA');
}

async function crearAsientoFacturaAutorizada({ facturaId, usuarioId, fecha = new Date() }) {
  const facturaIdNum = toInt(facturaId);
  const factura = await prisma.facturas.findUnique({ where: { id: facturaIdNum } });
  if (!factura) throw new Error('Factura no encontrada');

  const referencia = `FAC-${factura.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: factura.empresaId,
      tipo: 'FACTURA',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(factura.importeTotal);
  const iva = round2(factura.totalIva || 0);
  const ventas = round2(total - iva);

  const cuentaCxC = await ensureCuentaMovimiento({
    empresaId: factura.empresaId,
    codigo: '1.1.03.001',
    nombre: 'Cuentas por Cobrar',
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
  });

  const cuentaVentas = await ensureCuentaMovimiento({
    empresaId: factura.empresaId,
    codigo: '4.1.01.001',
    nombre: 'Ventas Servicios',
    tipo: 'INGRESO',
    naturaleza: 'CREDITO',
  });

  const cuentaIvaVentas = await ensureCuentaMovimiento({
    empresaId: factura.empresaId,
    codigo: '2.1.01.001',
    nombre: 'IVA Ventas por Pagar',
    tipo: 'PASIVO',
    naturaleza: 'CREDITO',
  });

  const detalles = [
    { cuentaId: cuentaCxC.id, descripcion: `Factura ${factura.numeroFactura}`, debe: total, haber: 0 },
    { cuentaId: cuentaVentas.id, descripcion: `Ventas factura ${factura.numeroFactura}`, debe: 0, haber: ventas },
  ];

  if (iva > 0) {
    detalles.push({ cuentaId: cuentaIvaVentas.id, descripcion: `IVA factura ${factura.numeroFactura}`, debe: 0, haber: iva });
  }

  const asiento = await crearAsientoContable({
    empresaId: factura.empresaId,
    fecha,
    descripcion: `Asiento automático factura ${factura.numeroFactura}`,
    tipo: 'FACTURA',
    referencia,
    facturaId: factura.id,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

// ─── Costo de ventas (inventario permanente) ─────────────────────────
// Segundo asiento de la venta: Costo de Ventas (gasto) vs Inventario (activo),
// por la mercadería inventariable efectivamente vendida. Usa el costoUnitario
// congelado en movimientos_inventario al momento de la venta (aplicarMovimientosVentaDesdeDetalles),
// no el costoUnitario actual del producto — así el asiento refleja el costo real
// de lo que salió de bodega en ese momento, aunque el costo del producto cambie después.
// Si la factura no tiene ítems inventariables (solo servicios) no genera nada.
async function crearAsientoCostoVentaFactura({ facturaId, usuarioId, fecha = new Date() }) {
  const facturaIdNum = toInt(facturaId);
  const factura = await prisma.facturas.findUnique({ where: { id: facturaIdNum } });
  if (!factura) throw new Error('Factura no encontrada');

  const referencia = `FAC-COSTO-${factura.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: { empresaId: factura.empresaId, tipo: 'COSTO_VENTA', referencia },
  });
  if (existente) return { asiento: existente, creado: false };

  const movimientos = await prisma.movimientos_inventario.findMany({
    where: { empresaId: factura.empresaId, referencia: factura.numeroFactura, tipo: 'VENTA_FACTURA' },
  });
  const costoTotal = round2(movimientos.reduce(
    (acc, m) => acc + (Number(m.cantidad) * Number(m.costoUnitario || 0)), 0,
  ));
  if (costoTotal <= 0) return { asiento: null, creado: false };

  const config = await obtenerConfiguracionContable(factura.empresaId);

  const cuentaCostoVentas = await _resolverCuenta({
    empresaId: factura.empresaId,
    codigoConfigurado: config?.codigoCuentaCostoVentas,
    codigoDefault: '5.1.01.001',
    nombreDefault: 'Costo de Ventas',
    tipoDefault: 'COSTO',
    naturalezaDefault: 'DEBITO',
  });

  const cuentaInventario = await _resolverCuenta({
    empresaId: factura.empresaId,
    codigoConfigurado: config?.codigoCuentaInventario,
    codigoDefault: '1.1.04.001',
    nombreDefault: 'Inventario Mercaderias',
    tipoDefault: 'ACTIVO',
    naturalezaDefault: 'DEBITO',
  });

  const asiento = await crearAsientoContable({
    empresaId: factura.empresaId,
    fecha,
    descripcion: `Costo de ventas factura ${factura.numeroFactura}`,
    tipo: 'COSTO_VENTA',
    referencia,
    facturaId: factura.id,
    usuarioId,
    detalles: [
      { cuentaId: cuentaCostoVentas.id, descripcion: `Costo de ventas factura ${factura.numeroFactura}`, debe: costoTotal, haber: 0 },
      { cuentaId: cuentaInventario.id, descripcion: `Salida de inventario por factura ${factura.numeroFactura}`, debe: 0, haber: costoTotal },
    ],
  });

  return { asiento, creado: true };
}

// ─── Notas de Venta (RIMPE Negocio Popular — no llevan IVA) ──────────
// A diferencia de facturas, no hay autorización SRI: el documento es válido
// desde su creación, así que el asiento se genera en el mismo momento del
// registro (no hay estado "borrador" que lo bloquee).
async function crearAsientoVentaNotaVenta({ notaVentaId, usuarioId, fecha = new Date(), db = prisma }) {
  const notaIdNum = toInt(notaVentaId);
  const nota = await db.notas_venta.findUnique({ where: { id: notaIdNum } });
  if (!nota) throw new Error('Nota de venta no encontrada');

  const referencia = `NV-${nota.id}`;
  const existente = await db.asientos_contables.findFirst({
    where: { empresaId: nota.empresaId, tipo: 'NOTA_VENTA', referencia },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(nota.total);
  if (total <= 0) return { asiento: null, creado: false };

  const cuentaCaja = await ensureCuentaMovimiento({
    empresaId: nota.empresaId, tx: db,
    codigo: '1.1.01.001', nombre: 'Caja', tipo: 'ACTIVO', naturaleza: 'DEBITO',
  });

  const cuentaVentas = await ensureCuentaMovimiento({
    empresaId: nota.empresaId, tx: db,
    codigo: '4.1.01.001', nombre: 'Ventas Servicios', tipo: 'INGRESO', naturaleza: 'CREDITO',
  });

  const asiento = await crearAsientoContable({
    empresaId: nota.empresaId,
    fecha,
    descripcion: `Asiento automático nota de venta ${nota.numeroNota}`,
    tipo: 'NOTA_VENTA',
    referencia,
    usuarioId,
    tx: db,
    detalles: [
      { cuentaId: cuentaCaja.id, descripcion: `Nota de venta ${nota.numeroNota}`, debe: total, haber: 0 },
      { cuentaId: cuentaVentas.id, descripcion: `Ventas nota ${nota.numeroNota}`, debe: 0, haber: total },
    ],
  });

  return { asiento, creado: true };
}

async function crearAsientoCostoVentaNotaVenta({ notaVentaId, usuarioId, fecha = new Date(), db = prisma }) {
  const notaIdNum = toInt(notaVentaId);
  const nota = await db.notas_venta.findUnique({ where: { id: notaIdNum } });
  if (!nota) throw new Error('Nota de venta no encontrada');

  const referencia = `NV-COSTO-${nota.id}`;
  const existente = await db.asientos_contables.findFirst({
    where: { empresaId: nota.empresaId, tipo: 'COSTO_VENTA', referencia },
  });
  if (existente) return { asiento: existente, creado: false };

  const movimientos = await db.movimientos_inventario.findMany({
    where: { empresaId: nota.empresaId, referencia: nota.numeroNota, tipo: 'VENTA_NOTA' },
  });
  const costoTotal = round2(movimientos.reduce(
    (acc, m) => acc + (Number(m.cantidad) * Number(m.costoUnitario || 0)), 0,
  ));
  if (costoTotal <= 0) return { asiento: null, creado: false };

  const config = await obtenerConfiguracionContable(nota.empresaId, db);

  const cuentaCostoVentas = await _resolverCuenta({
    empresaId: nota.empresaId,
    codigoConfigurado: config?.codigoCuentaCostoVentas,
    codigoDefault: '5.1.01.001',
    nombreDefault: 'Costo de Ventas',
    tipoDefault: 'COSTO',
    naturalezaDefault: 'DEBITO',
    tx: db,
  });

  const cuentaInventario = await _resolverCuenta({
    empresaId: nota.empresaId,
    codigoConfigurado: config?.codigoCuentaInventario,
    codigoDefault: '1.1.04.001',
    nombreDefault: 'Inventario Mercaderias',
    tipoDefault: 'ACTIVO',
    naturalezaDefault: 'DEBITO',
    tx: db,
  });

  const asiento = await crearAsientoContable({
    empresaId: nota.empresaId,
    fecha,
    descripcion: `Costo de ventas nota de venta ${nota.numeroNota}`,
    tipo: 'COSTO_VENTA',
    referencia,
    usuarioId,
    tx: db,
    detalles: [
      { cuentaId: cuentaCostoVentas.id, descripcion: `Costo de ventas nota ${nota.numeroNota}`, debe: costoTotal, haber: 0 },
      { cuentaId: cuentaInventario.id, descripcion: `Salida de inventario por nota ${nota.numeroNota}`, debe: 0, haber: costoTotal },
    ],
  });

  return { asiento, creado: true };
}

// Reversa (por anulación) los asientos de venta y costo de una nota de venta,
// invirtiendo débito/crédito de cada línea del asiento original — mismo patrón
// que crearAsientoReversoFacturaAnulada.
async function crearAsientoReversoNotaVentaAnulada({ notaVentaId, usuarioId, fecha = new Date(), db = prisma }) {
  const notaIdNum = toInt(notaVentaId);
  const nota = await db.notas_venta.findUnique({ where: { id: notaIdNum } });
  if (!nota) throw new Error('Nota de venta no encontrada');

  const asientosOriginales = await db.asientos_contables.findMany({
    where: {
      empresaId: nota.empresaId,
      tipo: { in: ['NOTA_VENTA', 'COSTO_VENTA'] },
      referencia: { in: [`NV-${nota.id}`, `NV-COSTO-${nota.id}`] },
    },
    include: { detalles: true },
  });

  const resultados = [];
  for (const original of asientosOriginales) {
    const referencia = `NV-ANUL-${original.tipo}-${nota.id}`;
    const existente = await db.asientos_contables.findFirst({
      where: { empresaId: nota.empresaId, tipo: 'ANULACION_NOTA', referencia },
    });
    if (existente) { resultados.push({ asiento: existente, creado: false }); continue; }

    const detalles = original.detalles.map((d) => ({
      cuentaId: d.cuentaId,
      descripcion: `Reverso anulación nota ${nota.numeroNota}`,
      debe: round2(d.haber),
      haber: round2(d.debe),
    }));

    const asiento = await crearAsientoContable({
      empresaId: nota.empresaId,
      fecha,
      descripcion: `Reverso por anulación — nota de venta ${nota.numeroNota}`,
      tipo: 'ANULACION_NOTA',
      referencia,
      usuarioId,
      tx: db,
      detalles,
    });
    resultados.push({ asiento, creado: true });
  }

  return resultados;
}

// ─── Movimientos bancarios manuales (depósitos, retiros, transferencias, etc.) ──
// A diferencia de compras/ventas, un movimiento bancario manual no tiene una
// contrapartida contable predecible (puede ser un aporte de capital, el pago de
// un gasto puntual, un cobro a un cliente, etc.) — por eso NO se adivina la
// cuenta: el usuario la elige al registrar el movimiento. Si no la elige, el
// movimiento se registra igual (como hasta ahora) pero sin asiento contable.
// Requiere que la cuenta bancaria ya esté vinculada a una cuenta del Plan de
// Cuentas (bancos.cuentaContableId).
async function crearAsientoMovimientoBancario({ movimientoId, cuentaContrapartidaId, usuarioId, fecha = new Date(), db = prisma }) {
  const movimientoIdNum = toInt(movimientoId);
  const movimiento = await db.movimientos_bancarios.findUnique({ where: { id: movimientoIdNum }, include: { banco: true } });
  if (!movimiento) throw new Error('Movimiento bancario no encontrado');
  if (movimiento.asientoId) return { asiento: null, creado: false };
  if (!movimiento.banco.cuentaContableId) {
    throw new Error('La cuenta bancaria no tiene una cuenta contable vinculada (Bancos → editar cuenta → Cuenta contable)');
  }

  const debe  = round2(movimiento.debe);
  const haber = round2(movimiento.haber);
  const monto = debe > 0 ? debe : haber;
  if (monto <= 0) return { asiento: null, creado: false };

  const detalles = debe > 0
    ? [
        { cuentaId: movimiento.banco.cuentaContableId, descripcion: movimiento.concepto, debe: monto, haber: 0 },
        { cuentaId: toInt(cuentaContrapartidaId), descripcion: movimiento.concepto, debe: 0, haber: monto },
      ]
    : [
        { cuentaId: toInt(cuentaContrapartidaId), descripcion: movimiento.concepto, debe: monto, haber: 0 },
        { cuentaId: movimiento.banco.cuentaContableId, descripcion: movimiento.concepto, debe: 0, haber: monto },
      ];

  const asiento = await crearAsientoContable({
    empresaId: movimiento.empresaId,
    fecha,
    descripcion: `Movimiento bancario (${movimiento.tipo}): ${movimiento.concepto}`,
    tipo: 'MOVIMIENTO_BANCO',
    referencia: `MOVBANCO-${movimiento.id}`,
    usuarioId,
    tx: db,
    detalles,
  });

  await db.movimientos_bancarios.update({ where: { id: movimiento.id }, data: { asientoId: asiento.id } });

  return { asiento, creado: true };
}

async function crearAsientoCobroFactura({ facturaId, metodoPago = 'efectivo', usuarioId, fecha = new Date(), cajaId = null }) {
  const facturaIdNum = toInt(facturaId);
  const factura = await prisma.facturas.findUnique({ where: { id: facturaIdNum } });
  if (!factura) throw new Error('Factura no encontrada');

  const referencia = `FAC-COBRO-${factura.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: factura.empresaId,
      tipo: 'CAJA',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(factura.importeTotal);
  const cuentaCxC = await ensureCuentaMovimiento({
    empresaId: factura.empresaId,
    codigo: '1.1.03.001',
    nombre: 'Cuentas por Cobrar',
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
  });

  const cuentaCobro = (metodoPago || '').toLowerCase() === 'efectivo'
    ? await ensureCuentaMovimiento({
        empresaId: factura.empresaId,
        codigo: '1.1.01.001',
        nombre: 'Caja',
        tipo: 'ACTIVO',
        naturaleza: 'DEBITO',
      })
    : await ensureCuentaMovimiento({
        empresaId: factura.empresaId,
        codigo: '1.1.02.001',
        nombre: 'Bancos',
        tipo: 'ACTIVO',
        naturaleza: 'DEBITO',
      });

  const asiento = await crearAsientoContable({
    empresaId: factura.empresaId,
    fecha,
    descripcion: `Cobro factura ${factura.numeroFactura} (${metodoPago})`,
    tipo: 'CAJA',
    referencia,
    facturaId: factura.id,
    cajaId,
    usuarioId,
    detalles: [
      { cuentaId: cuentaCobro.id, descripcion: 'Cobro recibido', debe: total, haber: 0 },
      { cuentaId: cuentaCxC.id, descripcion: 'Cancelación cuenta por cobrar', debe: 0, haber: total },
    ],
  });

  return { asiento, creado: true };
}

async function crearAsientoCompraFarmacia({ empresaId, medicamentoId, cantidad, precioUnit, usuarioId, fecha = new Date(), metodoPago = null, referencia = null }) {
  const empresaIdNum = toInt(empresaId);
  if (!empresaIdNum) throw new Error('empresaId es requerido para registrar compra de farmacia');

  const total = round2(Number(cantidad || 0) * Number(precioUnit || 0));
  if (total <= 0) throw new Error('Total de compra inválido');

  const ref = referencia || `FAR-COMPRA-${medicamentoId}-${Date.now()}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: empresaIdNum,
      tipo: 'COMPRA',
      referencia: ref,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const cuentaInventario = await ensureCuentaMovimiento({
    empresaId: empresaIdNum,
    codigo: '1.1.04.001',
    nombre: 'Inventario Farmacia',
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
  });

  const cuentaContrapartida = ((metodoPago || '').toLowerCase() === 'credito' || !metodoPago)
    ? await ensureCuentaMovimiento({
        empresaId: empresaIdNum,
        codigo: '2.1.04.001',
        nombre: 'Cuentas por Pagar Proveedores',
        tipo: 'PASIVO',
        naturaleza: 'CREDITO',
      })
    : await ensureCuentaMovimiento({
        empresaId: empresaIdNum,
        codigo: '1.1.02.001',
        nombre: 'Bancos',
        tipo: 'ACTIVO',
        naturaleza: 'DEBITO',
      });

  const asiento = await crearAsientoContable({
    empresaId: empresaIdNum,
    fecha,
    descripcion: `Compra farmacia medicamento ID ${medicamentoId}`,
    tipo: 'COMPRA',
    referencia: ref,
    usuarioId,
    detalles: [
      { cuentaId: cuentaInventario.id, descripcion: 'Ingreso inventario farmacia', debe: total, haber: 0 },
      { cuentaId: cuentaContrapartida.id, descripcion: 'Contrapartida compra farmacia', debe: 0, haber: total },
    ],
  });

  return { asiento, creado: true };
}

async function crearAsientoLiquidacionCompraAutorizada({ liquidacionId, usuarioId, fecha = new Date() }) {
  const liquidacionIdNum = toInt(liquidacionId);
  const liquidacion = await prisma.liquidaciones_compra.findUnique({ where: { id: liquidacionIdNum } });
  if (!liquidacion) throw new Error('Liquidación no encontrada');

  const referencia = `LIQ-${liquidacion.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: liquidacion.empresaId,
      tipo: 'COMPRA',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(liquidacion.importeTotal);
  const iva = round2(liquidacion.totalIva || 0);
  const subtotal = round2(total - iva);

  const cuentaCompras = await ensureCuentaMovimiento({
    empresaId: liquidacion.empresaId,
    codigo: '5.2.01.001',
    nombre: 'Compras Locales',
    tipo: 'GASTO',
    naturaleza: 'DEBITO',
  });

  const cuentaIvaCompras = await ensureCuentaMovimiento({
    empresaId: liquidacion.empresaId,
    codigo: '1.1.05.001',
    nombre: 'IVA Crédito Tributario Compras',
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
  });

  const cuentaCxP = await ensureCuentaMovimiento({
    empresaId: liquidacion.empresaId,
    codigo: '2.1.04.001',
    nombre: 'Cuentas por Pagar Proveedores',
    tipo: 'PASIVO',
    naturaleza: 'CREDITO',
  });

  const detalles = [
    { cuentaId: cuentaCompras.id, descripcion: `Compra liquidación ${liquidacion.numeroLiquidacion}`, debe: subtotal, haber: 0 },
    { cuentaId: cuentaCxP.id, descripcion: 'Cuenta por pagar proveedor', debe: 0, haber: total },
  ];

  if (iva > 0) {
    detalles.splice(1, 0, { cuentaId: cuentaIvaCompras.id, descripcion: 'IVA crédito tributario', debe: iva, haber: 0 });
  }

  const asiento = await crearAsientoContable({
    empresaId: liquidacion.empresaId,
    fecha,
    descripcion: `Asiento automático liquidación ${liquidacion.numeroLiquidacion}`,
    tipo: 'COMPRA',
    referencia,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

// ─── Configuración contable — cuentas enlazadas por el contador ──────
// Permite que el contador elija, desde su propio Plan de Cuentas, a qué cuenta
// se contabilizan los asientos automáticos (en vez de usar siempre las cuentas
// genéricas por defecto). Si no hay configuración o la cuenta configurada ya no
// existe/no acepta movimiento, cae al valor por defecto sin romper el asiento.
async function obtenerConfiguracionContable(empresaId, db = prisma) {
  return db.configuracion_contable.findUnique({ where: { empresaId: toInt(empresaId) } });
}

async function _resolverCuenta({ empresaId, codigoConfigurado, codigoDefault, nombreDefault, tipoDefault, naturalezaDefault, tx = prisma }) {
  if (codigoConfigurado) {
    const cuenta = await tx.plan_cuentas.findFirst({
      where: { empresaId, codigo: codigoConfigurado, activo: true, aceptaMovimiento: true },
    });
    if (cuenta) return cuenta;
    console.warn(`[Contabilidad] Cuenta configurada "${codigoConfigurado}" no existe o no acepta movimiento — usando cuenta por defecto ${codigoDefault}`);
  }
  return ensureCuentaMovimiento({
    empresaId, codigo: codigoDefault, nombre: nombreDefault, tipo: tipoDefault, naturaleza: naturalezaDefault, tx,
  });
}

async function crearAsientoFacturaCompraRegistrada({ compraId, usuarioId, fecha = new Date(), db = prisma }) {
  const compraIdNum = toInt(compraId);
  const compra = await db.facturas_compra.findUnique({ where: { id: compraIdNum } });
  if (!compra) throw new Error('Factura de compra no encontrada');

  const referencia = `COMP-${compra.id}`;
  const existente = await db.asientos_contables.findFirst({
    where: {
      empresaId: compra.empresaId,
      tipo: 'COMPRA',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const detallesCompra = Array.isArray(compra.detalles) ? compra.detalles : [];
  const subtotalInventario = round2(detallesCompra
    .filter((detalle) => Boolean(detalle?.inventariable))
    .reduce((acc, detalle) => acc + Number(detalle.subtotal || ((Number(detalle.cantidad || 0) * Number(detalle.precioUnitario || 0)) - Number(detalle.descuento || 0)) || 0), 0));
  const iva = round2(compra.totalIva || 0);
  const total = round2(compra.importeTotal || 0);
  const subtotalGasto = round2(Math.max(total - iva - subtotalInventario, 0));

  const config = await obtenerConfiguracionContable(compra.empresaId, db);

  const cuentaInventario = await _resolverCuenta({
    empresaId: compra.empresaId,
    codigoConfigurado: config?.codigoCuentaInventario,
    codigoDefault: '1.1.04.001',
    nombreDefault: 'Inventario Mercaderias',
    tipoDefault: 'ACTIVO',
    naturalezaDefault: 'DEBITO',
    tx: db,
  });

  const cuentaCompras = await _resolverCuenta({
    empresaId: compra.empresaId,
    codigoConfigurado: config?.codigoCuentaComprasGasto,
    codigoDefault: '5.2.01.001',
    nombreDefault: 'Compras Locales',
    tipoDefault: 'GASTO',
    naturalezaDefault: 'DEBITO',
    tx: db,
  });

  const cuentaIvaCompras = await _resolverCuenta({
    empresaId: compra.empresaId,
    codigoConfigurado: config?.codigoCuentaIvaCompras,
    codigoDefault: '1.1.05.001',
    nombreDefault: 'IVA Credito Tributario Compras',
    tipoDefault: 'ACTIVO',
    naturalezaDefault: 'DEBITO',
    tx: db,
  });

  const cuentaContrapartida = compra.egresoCajaRegistrado
    ? await _resolverCuenta({
        empresaId: compra.empresaId,
        codigoConfigurado: config?.codigoCuentaCajaCompras,
        codigoDefault: '1.1.01.001',
        nombreDefault: 'Caja',
        tipoDefault: 'ACTIVO',
        naturalezaDefault: 'DEBITO',
        tx: db,
      })
    : await _resolverCuenta({
        empresaId: compra.empresaId,
        codigoConfigurado: config?.codigoCuentaCxP,
        codigoDefault: '2.1.04.001',
        nombreDefault: 'Cuentas por Pagar Proveedores',
        tipoDefault: 'PASIVO',
        naturalezaDefault: 'CREDITO',
        tx: db,
      });

  const movimientos = [];
  if (subtotalInventario > 0) {
    movimientos.push({
      cuentaId: cuentaInventario.id,
      descripcion: `Ingreso de inventario por compra ${compra.numeroFactura}`,
      debe: subtotalInventario,
      haber: 0,
    });
  }
  if (subtotalGasto > 0) {
    movimientos.push({
      cuentaId: cuentaCompras.id,
      descripcion: `Compra / gasto por factura ${compra.numeroFactura}`,
      debe: subtotalGasto,
      haber: 0,
    });
  }
  if (iva > 0) {
    movimientos.push({
      cuentaId: cuentaIvaCompras.id,
      descripcion: `IVA credito tributario compra ${compra.numeroFactura}`,
      debe: iva,
      haber: 0,
    });
  }
  movimientos.push({
    cuentaId: cuentaContrapartida.id,
    descripcion: compra.egresoCajaRegistrado ? 'Pago registrado desde caja' : 'Cuenta por pagar proveedor',
    debe: 0,
    haber: total,
  });

  const asiento = await crearAsientoContable({
    empresaId: compra.empresaId,
    fecha,
    descripcion: `Asiento automatico compra ${compra.numeroFactura}`,
    tipo: 'COMPRA',
    referencia,
    usuarioId,
    detalles: movimientos,
    tx: db,
  });

  return { asiento, creado: true };
}

async function crearAsientoRetencionAutorizada({ retencionId, usuarioId, fecha = new Date() }) {
  const retencionIdNum = toInt(retencionId);
  const retencion = await prisma.retenciones.findUnique({ where: { id: retencionIdNum } });
  if (!retencion) throw new Error('Retención no encontrada');

  const referencia = `RET-${retencion.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: retencion.empresaId,
      tipo: 'RETENCION',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(retencion.totalRetenido || 0);
  if (total <= 0) throw new Error('Total retenido inválido');

  const cuentaCxP = await ensureCuentaMovimiento({
    empresaId: retencion.empresaId,
    codigo: '2.1.04.001',
    nombre: 'Cuentas por Pagar Proveedores',
    tipo: 'PASIVO',
    naturaleza: 'CREDITO',
  });

  const cuentaRetPagar = await ensureCuentaMovimiento({
    empresaId: retencion.empresaId,
    codigo: '2.1.05.001',
    nombre: 'Retenciones por Pagar',
    tipo: 'PASIVO',
    naturaleza: 'CREDITO',
  });

  const asiento = await crearAsientoContable({
    empresaId: retencion.empresaId,
    fecha,
    descripcion: `Asiento automático retención ${retencion.numeroRetencion}`,
    tipo: 'RETENCION',
    referencia,
    usuarioId,
    detalles: [
      { cuentaId: cuentaCxP.id, descripcion: 'Disminución cuenta por pagar por retención', debe: total, haber: 0 },
      { cuentaId: cuentaRetPagar.id, descripcion: 'Obligación por retenciones emitidas', debe: 0, haber: total },
    ],
  });

  return { asiento, creado: true };
}

async function crearAsientoNotaCreditoEmitida({ notaCreditoId, usuarioId, fecha = new Date() }) {
  const notaCreditoIdNum = toInt(notaCreditoId);
  const notaCredito = await prisma.notas_credito.findUnique({ where: { id: notaCreditoIdNum } });
  if (!notaCredito) throw new Error('Nota de crédito no encontrada');

  const referencia = `NC-${notaCredito.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: notaCredito.empresaId,
      tipo: 'NC',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const total = round2(notaCredito.importeTotal);
  const iva = round2(notaCredito.totalIva || 0);
  const subtotal = round2(notaCredito.totalSinImpuestos || (total - iva));

  const cuentaCxC = await ensureCuentaMovimiento({
    empresaId: notaCredito.empresaId,
    codigo: '1.1.03.001',
    nombre: 'Cuentas por Cobrar',
    tipo: 'ACTIVO',
    naturaleza: 'DEBITO',
  });

  const cuentaVentas = await ensureCuentaMovimiento({
    empresaId: notaCredito.empresaId,
    codigo: '4.1.01.001',
    nombre: 'Ventas Servicios',
    tipo: 'INGRESO',
    naturaleza: 'CREDITO',
  });

  const cuentaIvaVentas = await ensureCuentaMovimiento({
    empresaId: notaCredito.empresaId,
    codigo: '2.1.01.001',
    nombre: 'IVA Ventas por Pagar',
    tipo: 'PASIVO',
    naturaleza: 'CREDITO',
  });

  const detalles = [
    { cuentaId: cuentaVentas.id, descripcion: `Reverso ventas nota de crédito ${notaCredito.numeroNC}`, debe: subtotal, haber: 0 },
    { cuentaId: cuentaCxC.id, descripcion: `Disminución CxC por nota de crédito ${notaCredito.numeroNC}`, debe: 0, haber: total },
  ];

  if (iva > 0) {
    detalles.splice(1, 0, { cuentaId: cuentaIvaVentas.id, descripcion: `Reverso IVA nota de crédito ${notaCredito.numeroNC}`, debe: iva, haber: 0 });
  }

  const asiento = await crearAsientoContable({
    empresaId: notaCredito.empresaId,
    fecha,
    descripcion: `Asiento automático nota de crédito ${notaCredito.numeroNC}`,
    tipo: 'NC',
    referencia,
    facturaId: notaCredito.facturaId,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

async function crearAsientoReversoFacturaAnulada({ facturaId, usuarioId, fecha = new Date() }) {
  const facturaIdNum = toInt(facturaId);
  const factura = await prisma.facturas.findUnique({ where: { id: facturaIdNum } });
  if (!factura) throw new Error('Factura no encontrada');

  const referencia = `FAC-ANUL-${factura.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: factura.empresaId,
      tipo: 'ANULACION',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const asientoOriginal = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: factura.empresaId,
      OR: [
        { tipo: 'FACTURA', referencia: `FAC-${factura.id}` },
        { tipo: 'FACTURA', facturaId: factura.id },
      ],
    },
    include: { detalles: true },
    orderBy: { id: 'desc' },
  });

  let detalles;
  if (asientoOriginal?.detalles?.length >= 2) {
    detalles = asientoOriginal.detalles.map((detalle) => ({
      cuentaId: detalle.cuentaId,
      descripcion: `Reverso anulación factura ${factura.numeroFactura}`,
      debe: round2(detalle.haber),
      haber: round2(detalle.debe),
    }));
  } else {
    const total = round2(factura.importeTotal);
    const iva = round2(factura.totalIva || 0);
    const subtotal = round2(total - iva);

    const cuentaCxC = await ensureCuentaMovimiento({
      empresaId: factura.empresaId,
      codigo: '1.1.03.001',
      nombre: 'Cuentas por Cobrar',
      tipo: 'ACTIVO',
      naturaleza: 'DEBITO',
    });

    const cuentaVentas = await ensureCuentaMovimiento({
      empresaId: factura.empresaId,
      codigo: '4.1.01.001',
      nombre: 'Ventas Servicios',
      tipo: 'INGRESO',
      naturaleza: 'CREDITO',
    });

    const cuentaIvaVentas = await ensureCuentaMovimiento({
      empresaId: factura.empresaId,
      codigo: '2.1.01.001',
      nombre: 'IVA Ventas por Pagar',
      tipo: 'PASIVO',
      naturaleza: 'CREDITO',
    });

    detalles = [
      { cuentaId: cuentaVentas.id, descripcion: `Reverso ventas factura ${factura.numeroFactura}`, debe: subtotal, haber: 0 },
      { cuentaId: cuentaCxC.id, descripcion: `Reverso CxC factura ${factura.numeroFactura}`, debe: 0, haber: total },
    ];

    if (iva > 0) {
      detalles.splice(1, 0, { cuentaId: cuentaIvaVentas.id, descripcion: `Reverso IVA factura ${factura.numeroFactura}`, debe: iva, haber: 0 });
    }
  }

  const asiento = await crearAsientoContable({
    empresaId: factura.empresaId,
    fecha,
    descripcion: `Asiento reverso anulación factura ${factura.numeroFactura}`,
    tipo: 'ANULACION',
    referencia,
    facturaId: factura.id,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

async function crearAsientoReversoLiquidacionAnulada({ liquidacionId, usuarioId, fecha = new Date() }) {
  const liquidacionIdNum = toInt(liquidacionId);
  const liquidacion = await prisma.liquidaciones_compra.findUnique({ where: { id: liquidacionIdNum } });
  if (!liquidacion) throw new Error('Liquidación no encontrada');

  const referencia = `LIQ-ANUL-${liquidacion.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: liquidacion.empresaId,
      tipo: 'ANULACION',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const asientoOriginal = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: liquidacion.empresaId,
      tipo: 'COMPRA',
      referencia: `LIQ-${liquidacion.id}`,
    },
    include: { detalles: true },
    orderBy: { id: 'desc' },
  });

  if (!asientoOriginal?.detalles?.length) {
    return { asiento: null, creado: false, motivo: 'SIN_ASIENTO_ORIGINAL' };
  }

  const detalles = asientoOriginal.detalles.map((detalle) => ({
    cuentaId: detalle.cuentaId,
    descripcion: `Reverso anulación liquidación ${liquidacion.numeroLiquidacion}`,
    debe: round2(detalle.haber),
    haber: round2(detalle.debe),
  }));

  const asiento = await crearAsientoContable({
    empresaId: liquidacion.empresaId,
    fecha,
    descripcion: `Asiento reverso anulación liquidación ${liquidacion.numeroLiquidacion}`,
    tipo: 'ANULACION',
    referencia,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

async function crearAsientoReversoRetencionAnulada({ retencionId, usuarioId, fecha = new Date() }) {
  const retencionIdNum = toInt(retencionId);
  const retencion = await prisma.retenciones.findUnique({ where: { id: retencionIdNum } });
  if (!retencion) throw new Error('Retención no encontrada');

  const referencia = `RET-ANUL-${retencion.id}`;
  const existente = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: retencion.empresaId,
      tipo: 'ANULACION',
      referencia,
    },
  });
  if (existente) return { asiento: existente, creado: false };

  const asientoOriginal = await prisma.asientos_contables.findFirst({
    where: {
      empresaId: retencion.empresaId,
      tipo: 'RETENCION',
      referencia: `RET-${retencion.id}`,
    },
    include: { detalles: true },
    orderBy: { id: 'desc' },
  });

  if (!asientoOriginal?.detalles?.length) {
    return { asiento: null, creado: false, motivo: 'SIN_ASIENTO_ORIGINAL' };
  }

  const detalles = asientoOriginal.detalles.map((detalle) => ({
    cuentaId: detalle.cuentaId,
    descripcion: `Reverso anulación retención ${retencion.numeroRetencion}`,
    debe: round2(detalle.haber),
    haber: round2(detalle.debe),
  }));

  const asiento = await crearAsientoContable({
    empresaId: retencion.empresaId,
    fecha,
    descripcion: `Asiento reverso anulación retención ${retencion.numeroRetencion}`,
    tipo: 'ANULACION',
    referencia,
    usuarioId,
    detalles,
  });

  return { asiento, creado: true };
}

module.exports = {
  round2,
  obtenerConfiguracionContable,
  crearAsientoContable,
  crearAsientoNominaPeriodo,
  crearAsientoPagoNominaPeriodo,
  crearAsientoFacturaAutorizada,
  crearAsientoCostoVentaFactura,
  crearAsientoVentaNotaVenta,
  crearAsientoCostoVentaNotaVenta,
  crearAsientoReversoNotaVentaAnulada,
  crearAsientoMovimientoBancario,
  crearAsientoCobroFactura,
  crearAsientoCompraFarmacia,
  crearAsientoFacturaCompraRegistrada,
  crearAsientoLiquidacionCompraAutorizada,
  crearAsientoRetencionAutorizada,
  crearAsientoNotaCreditoEmitida,
  crearAsientoReversoFacturaAnulada,
  crearAsientoReversoLiquidacionAnulada,
  crearAsientoReversoRetencionAnulada,
};
