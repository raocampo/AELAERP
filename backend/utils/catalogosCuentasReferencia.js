const { CODIGOS_RETENCION_RENTA, CODIGOS_RETENCION_IVA } = require('./sri');

// Conceptos de nómina — hoy hardcodeados dentro de crearAsientoNominaPeriodo /
// crearAsientoPagoNominaPeriodo. codigoDefault/nombreDefault/tipoDefault/
// naturalezaDefault = comportamiento actual si el contador no configura nada.
const CONCEPTOS_NOMINA = [
  { codigoReferencia: 'GASTO_SUELDOS',             etiqueta: 'Gasto Sueldos y Salarios',                        codigoDefault: '5.1.02.001', nombreDefault: 'Gasto Sueldos y Salarios',                        tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'GASTO_APORTE_PATRONAL',     etiqueta: 'Gasto Aporte Patronal IESS',                      codigoDefault: '5.1.02.002', nombreDefault: 'Gasto Aporte Patronal IESS',                      tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'GASTO_PROV_DECIMO_TERCERO', etiqueta: 'Gasto Provisión Décimo Tercer Sueldo',            codigoDefault: '5.1.02.003', nombreDefault: 'Gasto Provisión Décimo Tercer Sueldo',            tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'GASTO_PROV_DECIMO_CUARTO',  etiqueta: 'Gasto Provisión Décimo Cuarto Sueldo',            codigoDefault: '5.1.02.004', nombreDefault: 'Gasto Provisión Décimo Cuarto Sueldo',            tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'GASTO_PROV_FONDOS_RESERVA', etiqueta: 'Gasto Provisión Fondos de Reserva',               codigoDefault: '5.1.02.005', nombreDefault: 'Gasto Provisión Fondos de Reserva',               tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'SUELDOS_POR_PAGAR',         etiqueta: 'Sueldos por Pagar',                               codigoDefault: '2.1.05.001', nombreDefault: 'Sueldos por Pagar',                               tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'IESS_POR_PAGAR',            etiqueta: 'IESS por Pagar',                                  codigoDefault: '2.1.05.002', nombreDefault: 'IESS por Pagar',                                  tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'RETENCION_IR_POR_PAGAR',    etiqueta: 'Retención IR Relación de Dependencia por Pagar',  codigoDefault: '2.1.05.003', nombreDefault: 'Retención IR Relación de Dependencia por Pagar',  tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'PROV_DECIMO_TERCERO_PAGAR', etiqueta: 'Provisión Décimo Tercero por Pagar',              codigoDefault: '2.1.05.004', nombreDefault: 'Provisión Décimo Tercero por Pagar',              tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'PROV_DECIMO_CUARTO_PAGAR',  etiqueta: 'Provisión Décimo Cuarto por Pagar',               codigoDefault: '2.1.05.005', nombreDefault: 'Provisión Décimo Cuarto por Pagar',               tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'PROV_FONDOS_RESERVA_PAGAR', etiqueta: 'Provisión Fondos de Reserva por Pagar',           codigoDefault: '2.1.05.006', nombreDefault: 'Provisión Fondos de Reserva por Pagar',           tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'ANTICIPOS_EMPLEADOS',       etiqueta: 'Anticipos a Empleados',                           codigoDefault: '1.1.08.001', nombreDefault: 'Anticipos a Empleados',                           tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO' },
  { codigoReferencia: 'OTROS_DESCUENTOS_NOMINA',   etiqueta: 'Otros Descuentos de Nómina por Pagar',            codigoDefault: '2.1.05.007', nombreDefault: 'Otros Descuentos de Nómina por Pagar',            tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
];

// Categoría General — sin motor que las use todavía (AELA no tiene cierre de
// ejercicio automático). Solo catálogo + mapeo guardable para cuando exista.
const CONCEPTOS_GENERAL = [
  { codigoReferencia: 'CAJA_GENERAL',                      etiqueta: 'Caja General' },
  { codigoReferencia: 'GANANCIAS_ACUMULADAS',               etiqueta: 'Ganancias Acumuladas' },
  { codigoReferencia: 'GANANCIA_NETA_EJERCICIO',            etiqueta: 'Ganancia Neta del Ejercicio' },
  { codigoReferencia: 'GASTOS_NO_DEDUCIBLE',                etiqueta: 'Gastos No Deducibles' },
  { codigoReferencia: 'INVENTARIO_TRANSFERENCIAS_TRANSITO', etiqueta: 'Inventario de Transferencias en Tránsito' },
  { codigoReferencia: 'OTROS_PAGOS',                        etiqueta: 'Otros Pagos' },
  { codigoReferencia: 'PAGOS_CON_DEPOSITO',                 etiqueta: 'Pagos con Depósito' },
  { codigoReferencia: 'PERDIDAS_ACUMULADAS',                etiqueta: 'Pérdidas Acumuladas' },
  { codigoReferencia: 'PERDIDA_NETA_EJERCICIO',             etiqueta: 'Pérdida Neta del Ejercicio' },
];

function _catalogoRetencion(esVenta) {
  const rentaDefault = esVenta
    ? { codigoDefault: '1.1.07.002', nombreDefault: 'Retención Impuesto a la Renta (Anticipo)', tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO' }
    : { codigoDefault: '2.1.05.001', nombreDefault: 'Retenciones por Pagar', tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' };
  const ivaDefault = esVenta
    ? { codigoDefault: '1.1.07.001', nombreDefault: 'Retención IVA (Crédito Tributario)', tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO' }
    : { codigoDefault: '2.1.05.001', nombreDefault: 'Retenciones por Pagar', tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' };

  const renta = Object.entries(CODIGOS_RETENCION_RENTA).map(([cod, v]) => ({
    codigoReferencia: cod,
    etiqueta: `RET_FUENTE - ${cod} ${v.descripcion} (${v.porcentaje}%)`,
    ...rentaDefault,
  }));
  const iva = Object.entries(CODIGOS_RETENCION_IVA).map(([cod, v]) => ({
    codigoReferencia: cod,
    etiqueta: `RET_IVA - ${cod} ${v.descripcion} (${v.porcentaje}%)`,
    ...ivaDefault,
  }));
  return [...renta, ...iva];
}

// Conceptos de compras (facturas de compra) — usados en crearAsientoFacturaCompraRegistrada
// Los primeros 5 reemplazan los campos fijos de configuracion_contable con el sistema de referencias.
const CONCEPTOS_COMPRAS = [
  { codigoReferencia: 'CXP_PROVEEDORES',      etiqueta: 'Cuentas por Pagar Proveedores',         codigoDefault: '2.1.04.001', nombreDefault: 'Cuentas por Pagar Proveedores',   tipoDefault: 'PASIVO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'COMPRAS_GASTO',         etiqueta: 'Compras / Gastos Locales',              codigoDefault: '5.2.01.001', nombreDefault: 'Compras Locales',                tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'INVENTARIO_COMPRAS',    etiqueta: 'Inventario Mercaderías',                codigoDefault: '1.1.04.001', nombreDefault: 'Inventario Mercaderías',         tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'IVA_COMPRAS',           etiqueta: 'IVA Crédito Tributario en Compras',    codigoDefault: '1.1.05.001', nombreDefault: 'IVA Crédito Tributario Compras', tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'CAJA_PAGO_COMPRAS',     etiqueta: 'Caja (pago directo en compras)',       codigoDefault: '1.1.01.001', nombreDefault: 'Caja',                          tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO'  },
  // Adicionales (presentes en la referencia SISOFIA)
  { codigoReferencia: 'ANTICIPOS_PROVEEDORES', etiqueta: 'Anticipos a Proveedores',              codigoDefault: '1.1.08.002', nombreDefault: 'Anticipos a Proveedores',        tipoDefault: 'ACTIVO', naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'DESCUENTOS_COMPRAS',    etiqueta: 'Descuentos y Devoluciones en Compras', codigoDefault: '5.2.01.002', nombreDefault: 'Descuentos en Compras',          tipoDefault: 'GASTO',  naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'IVA_COSTO_COMPRAS',     etiqueta: 'IVA que se carga al Costo',           codigoDefault: '5.2.01.003', nombreDefault: 'IVA al Costo',                  tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'IVA_GASTO_COMPRAS',     etiqueta: 'IVA que se carga al Gasto',           codigoDefault: '5.2.01.004', nombreDefault: 'IVA al Gasto',                  tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'MONTO_ICE_COMPRAS',     etiqueta: 'Monto ICE Compras',                   codigoDefault: '5.2.01.005', nombreDefault: 'Impuesto Consumos Especiales',   tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'BASE_NO_OBJETO_IVA',    etiqueta: 'Base Imponible No Objeto de IVA',     codigoDefault: '5.2.01.006', nombreDefault: 'Compras No Objeto de IVA',       tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'AJUSTE_CENTAVOS',       etiqueta: 'Ajuste de Centavos',                  codigoDefault: '5.2.09.001', nombreDefault: 'Ajuste de Centavos',             tipoDefault: 'GASTO',  naturalezaDefault: 'DEBITO'  },
];

// Conceptos de ventas (facturas de venta) — usados en crearAsientoFacturaAutorizada
const CONCEPTOS_VENTAS = [
  { codigoReferencia: 'CXC_CLIENTES',       etiqueta: 'Cuentas por Cobrar Clientes',          codigoDefault: '1.1.03.001', nombreDefault: 'Cuentas por Cobrar Clientes',  tipoDefault: 'ACTIVO',  naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'VENTAS_0',           etiqueta: 'Ventas Netas 0%',                      codigoDefault: '4.1.01.002', nombreDefault: 'Ventas Tarifa 0%',             tipoDefault: 'INGRESO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'VENTAS_GRAVADAS',    etiqueta: 'Ventas Netas Gravadas (IVA)',          codigoDefault: '4.1.01.001', nombreDefault: 'Ventas Netas Gravadas',         tipoDefault: 'INGRESO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'IVA_VENTAS',         etiqueta: 'IVA Ventas por Pagar',                codigoDefault: '2.1.01.001', nombreDefault: 'IVA Ventas por Pagar',         tipoDefault: 'PASIVO',  naturalezaDefault: 'CREDITO' },
  // Adicionales (presentes en la referencia SISOFIA)
  { codigoReferencia: 'COSTO_VENTAS_0',     etiqueta: 'Costo de Ventas 0%',                  codigoDefault: '5.1.01.001', nombreDefault: 'Costo de Ventas Tarifa 0%',    tipoDefault: 'GASTO',   naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'COSTO_VENTAS_GRAV',  etiqueta: 'Costo de Ventas Gravadas',            codigoDefault: '5.1.01.002', nombreDefault: 'Costo de Ventas Gravadas',     tipoDefault: 'GASTO',   naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'ANTICIPOS_CLIENTES', etiqueta: 'Anticipos de Clientes',               codigoDefault: '2.1.07.001', nombreDefault: 'Anticipos de Clientes',        tipoDefault: 'PASIVO',  naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'DESCUENTOS_VENTAS',  etiqueta: 'Descuentos y Devoluciones en Ventas', codigoDefault: '4.1.02.001', nombreDefault: 'Descuentos en Ventas',         tipoDefault: 'INGRESO', naturalezaDefault: 'DEBITO'  },
  { codigoReferencia: 'VENTAS_EXENTO',      etiqueta: 'Ventas Exentas de Impuesto',          codigoDefault: '4.1.01.003', nombreDefault: 'Ventas Exentas',               tipoDefault: 'INGRESO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'VENTAS_NO_IVA',      etiqueta: 'Ventas No Objeto de IVA',             codigoDefault: '4.1.01.004', nombreDefault: 'Ventas No Objeto de IVA',      tipoDefault: 'INGRESO', naturalezaDefault: 'CREDITO' },
  { codigoReferencia: 'MONTO_ICE_VENTAS',   etiqueta: 'Monto ICE Ventas',                   codigoDefault: '2.1.01.003', nombreDefault: 'ICE por Pagar',                tipoDefault: 'PASIVO',  naturalezaDefault: 'CREDITO' },
];

const CATALOGOS = {
  RETENCION_COMPRA: () => _catalogoRetencion(false),
  RETENCION_VENTA:  () => _catalogoRetencion(true),
  NOMINA:           () => CONCEPTOS_NOMINA,
  GENERAL:          () => CONCEPTOS_GENERAL,
  COMPRAS:          () => CONCEPTOS_COMPRAS,
  VENTAS:           () => CONCEPTOS_VENTAS,
};

function obtenerCatalogoReferencias(categoria) {
  const fn = CATALOGOS[categoria];
  if (!fn) throw new Error(`Categoría de configuración desconocida: ${categoria}`);
  return fn();
}

module.exports = {
  CATEGORIAS: Object.keys(CATALOGOS),
  obtenerCatalogoReferencias,
  CONCEPTOS_NOMINA,
  CONCEPTOS_COMPRAS,
  CONCEPTOS_VENTAS,
};
