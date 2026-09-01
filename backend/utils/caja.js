const prisma = require('../config/prisma');
const { asegurarConfiguracionSistemaEmpresa } = require('./configuracionSistema');
const { diaCalendarioEC } = require('./fechas');

const TIPOS_INGRESO = new Set(['APERTURA', 'INGRESO', 'VENTA_FACTURA', 'VENTA_NOTA']);
const TIPOS_EGRESO = new Set(['EGRESO', 'ANULACION_FACTURA', 'ANULACION_NOTA']);

// Antes usaba fecha.setHours(0,0,0,0), que redondea a medianoche en la zona
// horaria del PROCESO (Railway corre en UTC) — cuando el llamador no pasa
// una fecha explícita (el caso normal: "la caja de ahora mismo"), después de
// ~19:00 hora Ecuador el servidor ya está en el día siguiente en UTC, y se
// abría/buscaba la caja de mañana en vez de la de hoy.
//
// fechaOperacion es un campo "solo-fecha" (igual que fechaEmision en otras
// tablas): se guarda como medianoche UTC EXACTA representando el día
// calendario, sin componente de hora real — así están todas las filas ya
// existentes. Por eso acá se corrige SOLO a qué día calendario corresponde
// (con diaCalendarioEC, que sí resuelve bien la hora Ecuador), pero se sigue
// guardando en el mismo formato medianoche-UTC de siempre — usar
// inicioDiaEC() en vez de esto rompería la comparación con filas viejas
// (quedarían 5 horas desalineadas).
//
// Idempotente a propósito: si `valor` ya es una medianoche UTC exacta (ya
// pasó por esta misma función antes), se devuelve tal cual en vez de
// reinterpretarla en hora Ecuador — aplicar diaCalendarioEC() dos veces
// sobre el mismo Date movería el día uno hacia atrás.
function normalizarFechaOperacion(valor = new Date()) {
  if (valor instanceof Date && valor.getTime() === new Date(valor).setUTCHours(0, 0, 0, 0)) {
    return valor;
  }
  return new Date(`${diaCalendarioEC(valor)}T00:00:00.000Z`);
}

async function obtenerOCrearCajaDelDia({ tx = prisma, empresaId, fecha = new Date(), nombreCaja = null }) {
  const fechaOperacion = normalizarFechaOperacion(fecha);
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, tx);
  if (!config?.cajaDiariaHabilitada) return null;

  const existente = await tx.cajas_diarias.findUnique({
    where: {
      empresaId_fechaOperacion: {
        empresaId,
        fechaOperacion,
      },
    },
  });

  if (existente) return existente;

  return tx.cajas_diarias.create({
    data: {
      empresaId,
      fechaOperacion,
      nombreCaja: nombreCaja || config.cajaNombre || 'Caja General',
      aperturaRegistrada: false,
      montoApertura: 0,
    },
  });
}

async function registrarMovimientoCaja({
  tx = prisma,
  empresaId,
  usuarioId = null,
  fecha = new Date(),
  tipo,
  monto,
  descripcion = null,
  referencia = null,
  categoria = null,
  origenId = null,
  metadata = null,
}) {
  const config = await asegurarConfiguracionSistemaEmpresa(empresaId, tx);
  if (!config?.cajaDiariaHabilitada) return null;

  const montoNum = Number(monto || 0);
  if (!tipo || montoNum <= 0) return null;

  const caja = await obtenerOCrearCajaDelDia({ tx, empresaId, fecha, nombreCaja: config.cajaNombre });
  if (!caja) return null;

  return tx.caja_movimientos.create({
    data: {
      cajaId: caja.id,
      empresaId,
      usuarioId: usuarioId ? parseInt(usuarioId, 10) : null,
      tipo,
      categoria,
      monto: montoNum,
      descripcion,
      referencia,
      origenId: origenId ? parseInt(origenId, 10) : null,
      metadata,
    },
  });
}

function calcularResumenDesdeMovimientos(caja, movimientos = []) {
  const montoApertura = Number(caja?.montoApertura || 0);
  let ingresosManuales = 0;
  let egresosManuales = 0;
  let ventasFacturas = 0;
  let ventasNotas = 0;

  movimientos.forEach((mov) => {
    const monto = Number(mov.monto || 0);
    if (mov.tipo === 'INGRESO') ingresosManuales += monto;
    if (mov.tipo === 'EGRESO') egresosManuales += monto;
    if (mov.tipo === 'VENTA_FACTURA') ventasFacturas += monto;
    if (mov.tipo === 'VENTA_NOTA') ventasNotas += monto;
    if (mov.tipo === 'ANULACION_FACTURA') ventasFacturas -= monto;
    if (mov.tipo === 'ANULACION_NOTA') ventasNotas -= monto;
  });

  const totalVentas = ventasFacturas + ventasNotas;
  const totalEsperado = montoApertura + ingresosManuales + totalVentas - egresosManuales;
  const montoCierreReal = caja?.montoCierreReal === null || caja?.montoCierreReal === undefined
    ? null
    : Number(caja.montoCierreReal);

  return {
    montoApertura,
    ingresosManuales: Number(ingresosManuales.toFixed(2)),
    egresosManuales: Number(egresosManuales.toFixed(2)),
    ventasFacturas: Number(ventasFacturas.toFixed(2)),
    ventasNotas: Number(ventasNotas.toFixed(2)),
    totalVentas: Number(totalVentas.toFixed(2)),
    totalEsperado: Number(totalEsperado.toFixed(2)),
    montoCierreReal,
    diferenciaCierre: montoCierreReal === null ? null : Number((montoCierreReal - totalEsperado).toFixed(2)),
    cantidadMovimientos: movimientos.length,
  };
}

async function obtenerCajaConResumen({ tx = prisma, empresaId, fecha = new Date() }) {
  const caja = await obtenerOCrearCajaDelDia({ tx, empresaId, fecha });
  if (!caja) return null;

  const movimientos = await tx.caja_movimientos.findMany({
    where: { cajaId: caja.id },
    include: {
      usuario: {
        select: { id: true, nombre: true, username: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const resumen = calcularResumenDesdeMovimientos(caja, movimientos);
  return { caja, movimientos, resumen };
}

module.exports = {
  TIPOS_INGRESO,
  TIPOS_EGRESO,
  normalizarFechaOperacion,
  obtenerOCrearCajaDelDia,
  registrarMovimientoCaja,
  calcularResumenDesdeMovimientos,
  obtenerCajaConResumen,
};
