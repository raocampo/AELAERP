// ====================================
// utils/configuracionSistema.js — AELA
// Planes: lite | medium | pro
// ====================================
const prisma = require('../config/prisma');

const TIPOS_SISTEMA   = ['lite', 'medium', 'pro'];
const MODOS_OPERACION = ['monoempresa', 'multiempresa'];

// Prefijos que identifican ítems de regalo/combo del proveedor en compras
// (ej. "P-1043664" ligado al producto real "1043664"). Configurable por
// empresa vía configuracion_sistema.prefijosRegaloCompras (JSON en texto).
const PREFIJOS_REGALO_DEFAULT = ['P-', 'M-', 'OBQ-', 'COMBO-', 'REGALO-', 'BONI-'];

// Catálogo completo de flags de módulo — usado para validar `modulosContratados`
// y para construir el techo explícito por tenant en capacidadesModulos().
const MODULOS_TODOS = [
  'facturacionHabilitada',
  'cajaDiariaHabilitada', 'posHabilitado', 'inventarioHabilitado',
  'comprasHabilitadas', 'buzonSriHabilitado',
  'contabilidadHabilitada', 'retencionesHabilitadas', 'liquidacionesHabilitadas',
  'atsHabilitado', 'tributarioHabilitado', 'bancosHabilitado',
  'talentoHumanoHabilitado',
];

// ─── Normalizar prefijos de regalo/combo (JSON en texto -> array) ────────────
function normalizarPrefijosRegalo(value, fallback = PREFIJOS_REGALO_DEFAULT) {
  let lista = null;
  if (Array.isArray(value)) {
    lista = value;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) lista = parsed;
    } catch {
      // JSON inválido → usar fallback
    }
  }

  if (!lista) return [...fallback];

  const normalizada = [...new Set(
    lista
      .map((p) => String(p || '').trim().toUpperCase())
      .filter(Boolean)
  )];

  return normalizada.length > 0 ? normalizada : [...fallback];
}

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
      // Lite: Facturación, Notas de Venta, Caja, POS, Compras (solo ingreso
      // manual — Buzón SRI e importación histórica quedan en Medium+) e
      // Inventario (tope de 200 productos, ver LIMITE_PRODUCTOS_LITE).
      return {
        facturacionHabilitada:    true,
        cajaDiariaHabilitada:     true,
        posHabilitado:            true,
        inventarioHabilitado:     true,
        comprasHabilitadas:       true,
        buzonSriHabilitado:       false,
        contabilidadHabilitada:   false,
        retencionesHabilitadas:   false,
        liquidacionesHabilitadas: false,
        atsHabilitado:            false,
        tributarioHabilitado:     false,
        bancosHabilitado:         false,
        talentoHumanoHabilitado:  false,
      };
    case 'medium':
      return {
        facturacionHabilitada:    true,
        cajaDiariaHabilitada:     true,
        posHabilitado:            true,
        inventarioHabilitado:     true,
        comprasHabilitadas:       true,
        buzonSriHabilitado:       true,
        contabilidadHabilitada:   false,
        retencionesHabilitadas:   false,
        liquidacionesHabilitadas: false,
        atsHabilitado:            false,
        tributarioHabilitado:     true,
        bancosHabilitado:         true,
        talentoHumanoHabilitado:  true,
      };
    case 'pro':
    default:
      return {
        facturacionHabilitada:    true,
        cajaDiariaHabilitada:     true,
        posHabilitado:            true,
        inventarioHabilitado:     true,
        comprasHabilitadas:       true,
        buzonSriHabilitado:       true,
        contabilidadHabilitada:   true,
        retencionesHabilitadas:   true,
        liquidacionesHabilitadas: true,
        atsHabilitado:            true,
        tributarioHabilitado:     true,
        bancosHabilitado:         true,
        talentoHumanoHabilitado:  true,
      };
  }
}

// ─── Capacidades por tenant (techo explícito) ─────────────────────────────────
// Si la empresa tiene `modulosContratados` (array de claves), ese es el techo
// exacto — independiente del plan. Si es null/undefined, cae al techo legado
// por plan (capacidadesPlan) — cero cambio de comportamiento para tenants que
// no se hayan reconfigurado explícitamente desde el panel super-admin.
function capacidadesModulos(empresa = {}) {
  const contratados = empresa?.modulosContratados;
  if (Array.isArray(contratados)) {
    const set = new Set(contratados);
    return Object.fromEntries(MODULOS_TODOS.map((k) => [k, set.has(k)]));
  }
  return capacidadesPlan(normalizarTipoSistema(empresa?.plan));
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
  const modoOperacion  = normalizarModoOperacion(process.env.MODO_EMPRESA || 'monoempresa');
  const caps           = capacidadesModulos(empresa);

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
    prefijosRegaloCompras:   JSON.stringify(PREFIJOS_REGALO_DEFAULT),
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
  const caps        = capacidadesModulos(empresa);

  // Fusión: lo que dice la BD, pero limitado por el techo (módulos contratados o plan)
  return {
    ...construirConfiguracionSistemaBase(empresa),
    ...config,
    empresaId:   empresa.id,
    tipoSistema,
    modoOperacion: normalizarModoOperacion(config?.modoOperacion || await obtenerModoOperacionGlobal(tx)),
    impresionAutoReciboPos:  Boolean(config?.impresionAutoReciboPos ?? false),
    impresoraKiosko:         String(config?.impresoraKiosko || '').trim(),
    prefijosRegaloCompras:   normalizarPrefijosRegalo(config?.prefijosRegaloCompras),
    // Forzar a false los módulos que el techo no permite
    facturacionHabilitada:    caps.facturacionHabilitada    && Boolean(config?.facturacionHabilitada    ?? true),
    cajaDiariaHabilitada:     caps.cajaDiariaHabilitada     && Boolean(config?.cajaDiariaHabilitada     ?? true),
    posHabilitado:            caps.posHabilitado            && Boolean(config?.posHabilitado            ?? false),
    inventarioHabilitado:     caps.inventarioHabilitado     && Boolean(config?.inventarioHabilitado     ?? false),
    comprasHabilitadas:       caps.comprasHabilitadas       && Boolean(config?.comprasHabilitadas       ?? true),
    buzonSriHabilitado:       caps.buzonSriHabilitado       && Boolean(config?.buzonSriHabilitado       ?? true),
    contabilidadHabilitada:   caps.contabilidadHabilitada   && Boolean(config?.contabilidadHabilitada   ?? true),
    retencionesHabilitadas:   caps.retencionesHabilitadas   && Boolean(config?.retencionesHabilitadas   ?? true),
    liquidacionesHabilitadas: caps.liquidacionesHabilitadas && Boolean(config?.liquidacionesHabilitadas ?? true),
    atsHabilitado:            caps.atsHabilitado            && Boolean(config?.atsHabilitado            ?? true),
    tributarioHabilitado:     caps.tributarioHabilitado     && Boolean(config?.tributarioHabilitado     ?? true),
    bancosHabilitado:         caps.bancosHabilitado         && Boolean(config?.bancosHabilitado         ?? true),
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
  // Techo: modulosContratados de `actual` si existe (empresa fusionada, ver
  // routes/configuracionSistema.js), si no el legado por `tipoSistema` ya resuelto
  // arriba — nunca actual.plan directo, que puede faltar según qué se fusionó.
  const caps        = capacidadesModulos({ modulosContratados: actual.modulosContratados, plan: tipoSistema });

  // Helper: un flag solo puede ser true si el plan lo permite
  const flag = (key, defaultVal = false) => {
    const solicitado = reqBody[key] !== undefined ? Boolean(reqBody[key]) : Boolean(actual[key] ?? defaultVal);
    return caps[key] ? solicitado : false;
  };

  return {
    tipoSistema,
    modoOperacion:            normalizarModoOperacion(reqBody.modoOperacion, actual.modoOperacion),
    cajaNombre:               reqBody.cajaNombre?.trim() || actual.cajaNombre || 'Caja General',
    facturacionHabilitada:    flag('facturacionHabilitada', true),
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
    prefijosRegaloCompras:    JSON.stringify(normalizarPrefijosRegalo(
                                reqBody.prefijosRegaloCompras !== undefined ? reqBody.prefijosRegaloCompras : actual.prefijosRegaloCompras
                              )),
    comprasHabilitadas:       flag('comprasHabilitadas', true),
    buzonSriHabilitado:       flag('buzonSriHabilitado', true),
    contabilidadHabilitada:   flag('contabilidadHabilitada', true),
    retencionesHabilitadas:   flag('retencionesHabilitadas', true),
    liquidacionesHabilitadas: flag('liquidacionesHabilitadas', true),
    atsHabilitado:            flag('atsHabilitado', true),
    tributarioHabilitado:     flag('tributarioHabilitado', true),
    bancosHabilitado:         flag('bancosHabilitado', true),
    talentoHumanoHabilitado:  flag('talentoHumanoHabilitado', false),
    sbuEcuador:               parseFloat(reqBody.sbuEcuador) > 0
                                ? parseFloat(reqBody.sbuEcuador)
                                : parseFloat(actual.sbuEcuador) || 480.00,
  };
}

module.exports = {
  TIPOS_SISTEMA,
  MODOS_OPERACION,
  MODULOS_TODOS,
  PREFIJOS_REGALO_DEFAULT,
  normalizarPrefijosRegalo,
  normalizarTipoSistema,
  normalizarModoOperacion,
  capacidadesPlan,
  capacidadesModulos,
  limitesPlan,
  construirConfiguracionSistemaBase,
  construirPayloadConfiguracionSistema,
  asegurarConfiguracionSistemaEmpresa,
  obtenerConfiguracionSistemaOperativa,
  obtenerModoOperacionGlobal,
};
