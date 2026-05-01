const PLAN_CUENTAS_BASE = [
  { codigo: '1', nombre: 'ACTIVO', nivel: 1, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '1.1', nombre: 'ACTIVO CORRIENTE', nivel: 2, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1', aceptaMovimiento: false },
  { codigo: '1.1.01', nombre: 'EFECTIVO Y EQUIVALENTES', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.01.001', nombre: 'Caja', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.01', aceptaMovimiento: true },
  { codigo: '1.1.01.002', nombre: 'Caja Chica', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.01', aceptaMovimiento: true },
  { codigo: '1.1.02', nombre: 'BANCOS', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.02.001', nombre: 'Bancos', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.02', aceptaMovimiento: true },
  { codigo: '1.1.03', nombre: 'CUENTAS POR COBRAR', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.03.001', nombre: 'Cuentas por Cobrar Clientes', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.03', aceptaMovimiento: true },
  { codigo: '1.1.03.002', nombre: 'Anticipos y Cuentas por Cobrar Diversas', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.03', aceptaMovimiento: true },
  { codigo: '1.1.04', nombre: 'INVENTARIOS', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.04.001', nombre: 'Inventario de Mercaderias', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.04', aceptaMovimiento: true },
  { codigo: '1.1.04.002', nombre: 'Inventario Farmacia', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.04', aceptaMovimiento: true },
  { codigo: '1.1.05', nombre: 'IMPUESTOS A FAVOR', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.05.001', nombre: 'IVA Credito Tributario Compras', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.05', aceptaMovimiento: true },
  { codigo: '1.1.06', nombre: 'OTROS ACTIVOS CORRIENTES', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1', aceptaMovimiento: false },
  { codigo: '1.1.06.001', nombre: 'Anticipos a Proveedores', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.1.06', aceptaMovimiento: true },
  { codigo: '1.2', nombre: 'ACTIVO NO CORRIENTE', nivel: 2, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1', aceptaMovimiento: false },
  { codigo: '1.2.01', nombre: 'PROPIEDAD PLANTA Y EQUIPO', nivel: 3, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.2', aceptaMovimiento: false },
  { codigo: '1.2.01.001', nombre: 'Equipos de Computo', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.2.01', aceptaMovimiento: true },
  { codigo: '1.2.01.002', nombre: 'Muebles y Enseres', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.2.01', aceptaMovimiento: true },
  { codigo: '1.2.01.003', nombre: 'Vehiculos', nivel: 4, tipo: 'ACTIVO', naturaleza: 'DEBITO', codigoPadre: '1.2.01', aceptaMovimiento: true },
  { codigo: '1.2.02', nombre: 'DEPRECIACION ACUMULADA', nivel: 3, tipo: 'ACTIVO', naturaleza: 'CREDITO', codigoPadre: '1.2', aceptaMovimiento: false },
  { codigo: '1.2.02.001', nombre: 'Depreciacion Acumulada Equipos de Computo', nivel: 4, tipo: 'ACTIVO', naturaleza: 'CREDITO', codigoPadre: '1.2.02', aceptaMovimiento: true },
  { codigo: '1.2.02.002', nombre: 'Depreciacion Acumulada Muebles y Enseres', nivel: 4, tipo: 'ACTIVO', naturaleza: 'CREDITO', codigoPadre: '1.2.02', aceptaMovimiento: true },
  { codigo: '2', nombre: 'PASIVO', nivel: 1, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '2.1', nombre: 'PASIVO CORRIENTE', nivel: 2, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2', aceptaMovimiento: false },
  { codigo: '2.1.01', nombre: 'IMPUESTOS POR PAGAR', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.01.001', nombre: 'IVA Ventas por Pagar', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.01', aceptaMovimiento: true },
  { codigo: '2.1.01.002', nombre: 'Retenciones en la Fuente por Pagar', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.01', aceptaMovimiento: true },
  { codigo: '2.1.02', nombre: 'OBLIGACIONES LABORALES', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.02.001', nombre: 'Nomina por Pagar', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.02', aceptaMovimiento: true },
  { codigo: '2.1.03', nombre: 'OBLIGACIONES SOCIALES', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.03.001', nombre: 'IESS por Pagar', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.03', aceptaMovimiento: true },
  { codigo: '2.1.04', nombre: 'CUENTAS POR PAGAR', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.04.001', nombre: 'Cuentas por Pagar Proveedores', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.04', aceptaMovimiento: true },
  { codigo: '2.1.05', nombre: 'RETENCIONES POR PAGAR', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.05.001', nombre: 'Retenciones por Pagar', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.05', aceptaMovimiento: true },
  { codigo: '2.1.06', nombre: 'ANTICIPOS DE CLIENTES', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1', aceptaMovimiento: false },
  { codigo: '2.1.06.001', nombre: 'Anticipos de Clientes', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.1.06', aceptaMovimiento: true },
  { codigo: '2.2', nombre: 'PASIVO NO CORRIENTE', nivel: 2, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2', aceptaMovimiento: false },
  { codigo: '2.2.01', nombre: 'OBLIGACIONES FINANCIERAS LP', nivel: 3, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.2', aceptaMovimiento: false },
  { codigo: '2.2.01.001', nombre: 'Prestamos Bancarios Largo Plazo', nivel: 4, tipo: 'PASIVO', naturaleza: 'CREDITO', codigoPadre: '2.2.01', aceptaMovimiento: true },
  { codigo: '3', nombre: 'PATRIMONIO', nivel: 1, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '3.1', nombre: 'PATRIMONIO', nivel: 2, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3', aceptaMovimiento: false },
  { codigo: '3.1.01', nombre: 'CAPITAL', nivel: 3, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1', aceptaMovimiento: false },
  { codigo: '3.1.01.001', nombre: 'Capital Social', nivel: 4, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1.01', aceptaMovimiento: true },
  { codigo: '3.1.02', nombre: 'RESERVAS', nivel: 3, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1', aceptaMovimiento: false },
  { codigo: '3.1.02.001', nombre: 'Reserva Legal', nivel: 4, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1.02', aceptaMovimiento: true },
  { codigo: '3.1.03', nombre: 'RESULTADOS', nivel: 3, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1', aceptaMovimiento: false },
  { codigo: '3.1.03.001', nombre: 'Utilidad del Ejercicio', nivel: 4, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1.03', aceptaMovimiento: true },
  { codigo: '3.1.03.002', nombre: 'Resultados Acumulados', nivel: 4, tipo: 'PATRIMONIO', naturaleza: 'CREDITO', codigoPadre: '3.1.03', aceptaMovimiento: true },
  { codigo: '4', nombre: 'INGRESOS', nivel: 1, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '4.1', nombre: 'INGRESOS OPERACIONALES', nivel: 2, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4', aceptaMovimiento: false },
  { codigo: '4.1.01', nombre: 'VENTAS', nivel: 3, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4.1', aceptaMovimiento: false },
  { codigo: '4.1.01.001', nombre: 'Ventas Servicios', nivel: 4, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4.1.01', aceptaMovimiento: true },
  { codigo: '4.1.01.002', nombre: 'Ventas Bienes', nivel: 4, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4.1.01', aceptaMovimiento: true },
  { codigo: '4.1.02', nombre: 'OTROS INGRESOS', nivel: 3, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4.1', aceptaMovimiento: false },
  { codigo: '4.1.02.001', nombre: 'Otros Ingresos Operacionales', nivel: 4, tipo: 'INGRESO', naturaleza: 'CREDITO', codigoPadre: '4.1.02', aceptaMovimiento: true },
  { codigo: '5', nombre: 'GASTOS', nivel: 1, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '5.1', nombre: 'GASTOS ADMINISTRATIVOS', nivel: 2, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5', aceptaMovimiento: false },
  { codigo: '5.1.01', nombre: 'GASTOS DE PERSONAL', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1', aceptaMovimiento: false },
  { codigo: '5.1.01.001', nombre: 'Gastos Sueldos', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.01', aceptaMovimiento: true },
  { codigo: '5.1.01.002', nombre: 'Gastos Aportes Patronales', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.01', aceptaMovimiento: true },
  { codigo: '5.1.02', nombre: 'SERVICIOS Y ADMINISTRACION', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1', aceptaMovimiento: false },
  { codigo: '5.1.02.001', nombre: 'Arriendo', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.02', aceptaMovimiento: true },
  { codigo: '5.1.02.002', nombre: 'Servicios Basicos', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.02', aceptaMovimiento: true },
  { codigo: '5.1.02.003', nombre: 'Internet y Telefonia', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.02', aceptaMovimiento: true },
  { codigo: '5.1.03', nombre: 'DEPRECIACIONES Y AMORTIZACIONES', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1', aceptaMovimiento: false },
  { codigo: '5.1.03.001', nombre: 'Depreciacion', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.03', aceptaMovimiento: true },
  { codigo: '5.1.04', nombre: 'GASTOS FINANCIEROS', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1', aceptaMovimiento: false },
  { codigo: '5.1.04.001', nombre: 'Gastos Bancarios', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.04', aceptaMovimiento: true },
  { codigo: '5.1.05', nombre: 'MANTENIMIENTO', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1', aceptaMovimiento: false },
  { codigo: '5.1.05.001', nombre: 'Mantenimiento y Reparaciones', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.1.05', aceptaMovimiento: true },
  { codigo: '5.2', nombre: 'COMPRAS Y GASTOS DE VENTA', nivel: 2, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5', aceptaMovimiento: false },
  { codigo: '5.2.01', nombre: 'COMPRAS', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2', aceptaMovimiento: false },
  { codigo: '5.2.01.001', nombre: 'Compras Locales', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2.01', aceptaMovimiento: true },
  { codigo: '5.2.02', nombre: 'PUBLICIDAD Y PROMOCION', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2', aceptaMovimiento: false },
  { codigo: '5.2.02.001', nombre: 'Publicidad y Marketing', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2.02', aceptaMovimiento: true },
  { codigo: '5.2.03', nombre: 'TRANSPORTE Y FLETES', nivel: 3, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2', aceptaMovimiento: false },
  { codigo: '5.2.03.001', nombre: 'Transporte y Fletes', nivel: 4, tipo: 'GASTO', naturaleza: 'DEBITO', codigoPadre: '5.2.03', aceptaMovimiento: true },
  { codigo: '6', nombre: 'COSTOS', nivel: 1, tipo: 'COSTO', naturaleza: 'DEBITO', codigoPadre: null, aceptaMovimiento: false },
  { codigo: '6.1', nombre: 'COSTO DE VENTAS', nivel: 2, tipo: 'COSTO', naturaleza: 'DEBITO', codigoPadre: '6', aceptaMovimiento: false },
  { codigo: '6.1.01', nombre: 'COSTOS DIRECTOS', nivel: 3, tipo: 'COSTO', naturaleza: 'DEBITO', codigoPadre: '6.1', aceptaMovimiento: false },
  { codigo: '6.1.01.001', nombre: 'Costo de Ventas Mercaderias', nivel: 4, tipo: 'COSTO', naturaleza: 'DEBITO', codigoPadre: '6.1.01', aceptaMovimiento: true },
  { codigo: '6.1.01.002', nombre: 'Costo de Prestacion de Servicios', nivel: 4, tipo: 'COSTO', naturaleza: 'DEBITO', codigoPadre: '6.1.01', aceptaMovimiento: true },
];

async function sembrarPlanCuentasBase(tx, empresaId, options = {}) {
  const overwriteExisting = Boolean(options.overwriteExisting);
  const empresaIdNum = Number.parseInt(empresaId, 10);
  if (!empresaIdNum) {
    throw new Error('empresaId es requerido para instalar el plan de cuentas base');
  }

  let creadas = 0;
  let actualizadas = 0;
  let omitidas = 0;

  for (const cuenta of PLAN_CUENTAS_BASE) {
    const existente = await tx.plan_cuentas.findFirst({
      where: { empresaId: empresaIdNum, codigo: cuenta.codigo },
    });

    if (existente) {
      if (overwriteExisting) {
        await tx.plan_cuentas.update({
          where: { id: existente.id },
          data: {
            nombre: cuenta.nombre,
            nivel: cuenta.nivel,
            tipo: cuenta.tipo,
            naturaleza: cuenta.naturaleza,
            codigoPadre: cuenta.codigoPadre,
            aceptaMovimiento: cuenta.aceptaMovimiento,
            activo: true,
          },
        });
        actualizadas += 1;
      } else {
        omitidas += 1;
      }
      continue;
    }

    await tx.plan_cuentas.create({
      data: {
        empresaId: empresaIdNum,
        codigo: cuenta.codigo,
        nombre: cuenta.nombre,
        nivel: cuenta.nivel,
        tipo: cuenta.tipo,
        naturaleza: cuenta.naturaleza,
        codigoPadre: cuenta.codigoPadre,
        aceptaMovimiento: cuenta.aceptaMovimiento,
        activo: true,
      },
    });
    creadas += 1;
  }

  return {
    creadas,
    actualizadas,
    omitidas,
    totalBase: PLAN_CUENTAS_BASE.length,
  };
}

module.exports = {
  PLAN_CUENTAS_BASE,
  sembrarPlanCuentasBase,
};
