// ====================================
// utils/configuracionSistema.js — AELA
// Planes: lite | medium | pro
// ====================================
const prisma = require('../config/prisma');

const TIPOS_SISTEMA   = ['lite', 'medium', 'pro'];
const MODOS_OPERACION = ['monoempresa', 'multiempresa'];

// ─── Normalizar plan ──────────────────────────────────────────────────────────
function normalizarTipoSistema(value, fallback = 'pro') {
  const raw = String(value || fallback || 'pro').toLowerCase();
  if (raw === 'full') return 'pro';    // alias legacy
  return TIPOS_SISTEMA.includes(raw) ? raw : 'pro';
}

function normalizarModoOperacion(value, fallback = 'monoempresa') {
  const raw = String(value || fallback || 'monoempresa').toLowerCase();
  if (['multi', 'multiempresa'].includes(raw)) return 'multiempresa';
  return 'monoempresa';
}

// ─── Capacidades por plan ─────────────────────────────────────────────────────
// Devuelve qué módulos están permitidos para un plan dado.
// Estos son los TOPES; el admin puede desactivar hacia abajo pero no activar lo que el plan no permite.
function capacidadesPlan(plan) {
  switch (plan) {
    case 'lite':
      return {
        cajaDiariaHabilitada:     false,
        posHabilitado:            false,
        inventarioHabilitado:     false,
        comprasHabilitadas:       false,
        contabilidadHabilitada:   false,
        retencionesHabilitadas:   false,
        liquidacionesHabilitadas: false,
        atsHabilitado:            false,
        talentoHumanoHabilitado:  false,
      };
    case 'medium':
      return {
        cajaDiariaHabilitada:     true,
        posHabilitado:            true,
        inventarioHabilitado:     true,
        comprasHabilitadas:       true,
        contabilidadHabilitada:   false,
        retencionesHabilitadas:   false,
        liquidacionesHabilitadas: false,
        atsHabilitado:            false,
        talentoHumanoHabilitado:  true,
      };
    case 'pro':
    default:
      return {
        cajaDiariaHabilitada:     true,
        posHabilitado:            true,
        inventarioHabilitado:     true,
        comprasHabilitadas:       true,
        contabilidadHabilitada:   true,
        retencionesHabilitadas:   true,
        liquidacionesHabilitadas: true,
        atsHabilitado:            true,
        talentoHumanoHabilitado:  true,
      };
  }
}

// ─── Limites por plan ─────────────────────────────────────────────────────────
function limitesPlan(plan) {
  switch (plan) {
    case 'lite':   return { factAnualesMax: 100,  maxUsuarios: 1    };
    case 'medium': return { factAnualesMax: 1000, maxUsuarios: 3    };
    case 'pro':    return { factAnualesMax: null,  maxUsuarios: null };
    default:       return { factAnualesMax: null,  maxUsuarios: null };
  }
}

// ─── Configuración base al crear empresa ─────────────────────────────────────
function construirConfiguracionSistemaBase(empresa = {}) {
  const tipoSistema    = normalizarTipoSistema(empresa.plan || process.env.AELA_EDITION || 'pro');
  const modoOperacion  = tipoSistema === 'pro'
    ? 'multiempresa'
    : normalizarModoOperacion(process.env.MODO_EMPRESA || 'monoempresa');
  const caps           = capacidadesPlan(tipoSistema);

  return {
    empresaId: empresa.id,
    tipoSistema,
    modoOperacion,
    cajaNombre:              'Caja General',
    cierreCajaObligatorio:   false,
    documentoPosDefault:     tipoSistema === 'lite' ? 'nota_venta' : 'factura',
    impresionAutoReciboPos:  false,
    impresoraKiosko:         '',
    permitirStockNegativo:   false,
    sbuEcuador:              480.00,
    ...caps,
  };
}

// ─── Asegurar que existe la configuración para una empresa ────────────────────
async function asegurarConfiguracionSistemaEmpresa(empresaOrId, tx = prisma) {
  const empresa = typeof empresaOrId === 'object'
    ? empresaOrId
    : await tx.empresas.findUnique({ where: { id: parseInt(empresaOrId, 10) } });

  if (!empresa?.id) return null;

  const existente = await tx.configuracion_sistema.findUnique({
    where: { empresaId: empresa.id },
  });

  if (existente) return existente;

  const modoOperacion = await obtenerModoOperacionGlobal(tx);
  return tx.configuracion_sistema.create({
    data: {
      ...construirConfiguracionSistemaBase(empresa),
      modoOperacion,
    },
  });
}

// ─── Leer configuración operativa (fusiona BD + plan) ────────────────────────
async function obtenerConfiguracionSistemaOperativa(empresaOrId, tx = prisma) {
  const empresa = typeof empresaOrId === 'object'
    ? empresaOrId
    : await tx.empresas.findUnique({ where: { id: parseInt(empresaOrId, 10) } });

  if (!empresa?.id) return null;

  const config      = await asegurarConfiguracionSistemaEmpresa(empresa, tx);
  const tipoSistema = normalizarTipoSistema(config?.tipoSistema || empresa.plan || process.env.AELA_EDITION);
  const caps        = capacidadesPlan(tipoSistema);

  // Fusión: lo que dice la BD, pero limitado por las capacidades del plan
  return {
    ...construirConfiguracionSistemaBase(empresa),
    ...config,
    empresaId:   empresa.id,
    tipoSistema,
    modoOperacion: tipoSistema === 'pro'
      ? 'multiempresa'
      : normalizarModoOperacion(config?.modoOperacion || await obtenerModoOperacionGlobal(tx)),
    impresionAutoReciboPos:  Boolean(config?.impresionAutoReciboPos ?? false),
    impresoraKiosko:         String(config?.impresoraKiosko || '').trim(),
    // Forzar a false los módulos que el plan no permite
    cajaDiariaHabilitada:     caps.cajaDiariaHabilitada     && Boolean(config?.cajaDiariaHabilitada     ?? true),
    posHabilitado:            caps.posHabilitado            && Boolean(config?.posHabilitado            ?? false),
    inventarioHabilitado:     caps.inventarioHabilitado     && Boolean(config?.inventarioHabilitado     ?? false),
    comprasHabilitadas:       caps.comprasHabilitadas       && Boolean(config?.comprasHabilitadas       ?? true),
    contabilidadHabilitada:   caps.contabilidadHabilitada   && Boolean(config?.contabilidadHabilitada   ?? true),
    retencionesHabilitadas:   caps.retencionesHabilitadas   && Boolean(config?.retencionesHabilitadas   ?? true),
    liquidacionesHabilitadas: caps.liquidacionesHabilitadas && Boolean(config?.liquidacionesHabilitadas ?? true),
    atsHabilitado:            caps.atsHabilitado            && Boolean(config?.atsHabilitado            ?? true),
    talentoHumanoHabilitado:  caps.talentoHumanoHabilitado  && Boolean(config?.talentoHumanoHabilitado  ?? false),
    sbuEcuador:               parseFloat(config?.sbuEcuador) || 480.00,
  };
}

// ─── Modo de operación global ─────────────────────────────────────────────────
async function obtenerModoOperacionGlobal(tx = prisma) {
  const primeraConfig = await tx.configuracion_sistema.findFirst({
    orderBy: { empresaId: 'asc' },
    select: { modoOperacion: true },
  });
  return normalizarModoOperacion(primeraConfig?.modoOperacion || process.env.MODO_EMPRESA || 'monoempresa');
}

// ─── Construir payload para actualización ────────────────────────────────────
function construirPayloadConfiguracionSistema(actual = {}, reqBody = {}) {
  const tipoSistema = normalizarTipoSistema(reqBody.tipoSistema, actual.tipoSistema);
  const caps        = capacidadesPlan(tipoSistema);

  // Helper: un flag solo puede ser true si el plan lo permite
  const flag = (key, defaultVal = false) => {
    const solicitado = reqBody[key] !== undefined ? Boolean(reqBody[key]) : Boolean(actual[key] ?? defaultVal);
    return caps[key] ? solicitado : false;
  };

  return {
    tipoSistema,
    modoOperacion:            tipoSistema === 'pro'
                                ? 'multiempresa'
                                : normalizarModoOperacion(reqBody.modoOperacion, actual.modoOperacion),
    cajaNombre:               reqBody.cajaNombre?.trim() || actual.cajaNombre || 'Caja General',
    cajaDiariaHabilitada:     flag('cajaDiariaHabilitada', true),
    cierreCajaObligatorio:    Boolean(reqBody.cierreCajaObligatorio !== undefined ? reqBody.cierreCajaObligatorio : actual.cierreCajaObligatorio),
    posHabilitado:            flag('posHabilitado', false),
    documentoPosDefault:      ['factura', 'nota_venta'].includes(reqBody.documentoPosDefault)
                                ? reqBody.documentoPosDefault
                                : (actual.documentoPosDefault || (tipoSistema === 'lite' ? 'nota_venta' : 'factura')),
    impresionAutoReciboPos:   Boolean(reqBody.impresionAutoReciboPos !== undefined ? reqBody.impresionAutoReciboPos : actual.impresionAutoReciboPos),
    impresoraKiosko:          reqBody.impresoraKiosko?.trim() || actual.impresoraKiosko || '',
    inventarioHabilitado:     flag('inventarioHabilitado', false),
    permitirStockNegativo:    Boolean(reqBody.permitirStockNegativo !== undefined ? reqBody.permitirStockNegativo : actual.permitirStockNegativo),
    comprasHabilitadas:       flag('comprasHabilitadas', true),
    contabilidadHabilitada:   flag('contabilidadHabilitada', true),
    retencionesHabilitadas:   flag('retencionesHabilitadas', true),
    liquidacionesHabilitadas: flag('liquidacionesHabilitadas', true),
    atsHabilitado:            flag('atsHabilitado', true),
    talentoHumanoHabilitado:  flag('talentoHumanoHabilitado', false),
    sbuEcuador:               parseFloat(reqBody.sbuEcuador) > 0
                                ? parseFloat(reqBody.sbuEcuador)
                                : parseFloat(actual.sbuEcuador) || 480.00,
  };
}

module.exports = {
  TIPOS_SISTEMA,
  MODOS_OPERACION,
  normalizarTipoSistema,
  normalizarModoOperacion,
  capacidadesPlan,
  limitesPlan,
  construirConfiguracionSistemaBase,
  construirPayloadConfiguracionSistema,
  asegurarConfiguracionSistemaEmpresa,
  obtenerConfiguracionSistemaOperativa,
  obtenerModoOperacionGlobal,
};
