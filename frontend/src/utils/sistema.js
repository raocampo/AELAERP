export const CAPACIDADES_PLAN = {
  lite: {
    cajaDiariaHabilitada: true,
    posHabilitado: true,
    inventarioHabilitado: true,
    comprasHabilitadas: false,
    contabilidadHabilitada: false,
    retencionesHabilitadas: false,
    liquidacionesHabilitadas: false,
    atsHabilitado: false,
    talentoHumanoHabilitado: false,
  },
  medium: {
    cajaDiariaHabilitada: true,
    posHabilitado: true,
    inventarioHabilitado: true,
    comprasHabilitadas: true,
    contabilidadHabilitada: false,
    retencionesHabilitadas: false,
    liquidacionesHabilitadas: false,
    atsHabilitado: false,
    talentoHumanoHabilitado: true,
  },
  pro: {
    cajaDiariaHabilitada: true,
    posHabilitado: true,
    inventarioHabilitado: true,
    comprasHabilitadas: true,
    contabilidadHabilitada: true,
    retencionesHabilitadas: true,
    liquidacionesHabilitadas: true,
    atsHabilitado: true,
    talentoHumanoHabilitado: true,
  },
};

export function normalizarTipoSistema(value, fallback = 'pro') {
  const raw = String(value || fallback || 'pro').trim().toLowerCase();
  if (raw === 'full') return 'pro';
  return ['lite', 'medium', 'pro'].includes(raw) ? raw : 'pro';
}

export function normalizarModoOperacion(value, fallback = 'monoempresa') {
  const raw = String(value || fallback || 'monoempresa').trim().toLowerCase();
  if (['multi', 'multiempresa'].includes(raw)) return 'multiempresa';
  return 'monoempresa';
}

export function capacidadesPlan(plan) {
  return CAPACIDADES_PLAN[normalizarTipoSistema(plan)] || CAPACIDADES_PLAN.pro;
}

export function construirSistemaFallback(empresaActual = null, {
  edition = 'full',
  modoOperacion = 'monoempresa',
} = {}) {
  const plan = normalizarTipoSistema(empresaActual?.plan || edition || 'pro');
  const esPro = plan === 'pro';
  const esMedium = plan === 'medium';

  return {
    tipoSistema: plan,
    modoOperacion: normalizarModoOperacion(modoOperacion),
    cajaNombre: 'Caja General',
    cajaDiariaHabilitada: esPro || esMedium || plan === 'lite',
    cierreCajaObligatorio: false,
    posHabilitado: esPro || esMedium || plan === 'lite',
    documentoPosDefault: plan === 'lite' ? 'nota_venta' : 'factura',
    inventarioHabilitado: esPro || esMedium || plan === 'lite',
    permitirStockNegativo: false,
    comprasHabilitadas: esPro || esMedium,
    contabilidadHabilitada: esPro,
    retencionesHabilitadas: esPro,
    liquidacionesHabilitadas: esPro,
    atsHabilitado: esPro,
    talentoHumanoHabilitado: esPro || esMedium,
    sbuEcuador: 480.00,
  };
}

export function crearEmpresaFallback(edition = 'full') {
  const plan = normalizarTipoSistema(edition);
  return {
    plan,
    factAnualesMax: plan === 'lite' ? 100 : plan === 'medium' ? 1000 : null,
    maxUsuarios: plan === 'lite' ? 1 : plan === 'medium' ? 3 : null,
  };
}

export function obtenerPlanLabel(plan) {
  const tipoSistema = normalizarTipoSistema(plan);
  if (tipoSistema === 'lite') return 'Lite';
  if (tipoSistema === 'medium') return 'Medium';
  return 'Pro';
}

export function resolverEstadoSistema({ sistema = null, empresa = null, edition = 'full', modoOperacion = 'monoempresa' } = {}) {
  const tipoSistemaActual = normalizarTipoSistema(sistema?.tipoSistema || empresa?.plan || edition || 'pro');
  const modoOperacionActual = normalizarModoOperacion(sistema?.modoOperacion || modoOperacion);
  const esLite = tipoSistemaActual === 'lite';
  const esMedium = tipoSistemaActual === 'medium';
  const esPro = tipoSistemaActual === 'pro';

  return {
    tipoSistemaActual,
    modoOperacionActual,
    esLite,
    esMedium,
    esPro,
    esFull: esPro,
    modoMulti: modoOperacionActual === 'multiempresa',
    planLabel: obtenerPlanLabel(tipoSistemaActual),
  };
}

export function obtenerModulosHabilitados(sistema) {
  return {
    pos: Boolean(sistema?.posHabilitado),
    inventario: Boolean(sistema?.inventarioHabilitado),
    caja: Boolean(sistema?.cajaDiariaHabilitada),
    compras: Boolean(sistema?.comprasHabilitadas),
    contabilidad: Boolean(sistema?.contabilidadHabilitada),
    retenciones: Boolean(sistema?.retencionesHabilitadas),
    liquidaciones: Boolean(sistema?.liquidacionesHabilitadas),
    ats: Boolean(sistema?.atsHabilitado),
    talentoHumano: Boolean(sistema?.talentoHumanoHabilitado),
  };
}

export function planBloqueadoPorRequisito(planMin, { esLite = false, esMedium = false } = {}) {
  if (!planMin) return false;
  if (planMin === 'medium') return esLite;
  if (planMin === 'pro') return esLite || esMedium;
  return false;
}

export function moduloDeshabilitadoPorConfiguracion(item, sistema) {
  if (!item?.modulo) return false;
  return !sistema?.[item.modulo];
}
