// ====================================
// MIDDLEWARE: Control de Edición
// Planes: lite | medium | pro
// ====================================
const prisma = require('../config/prisma');

// ─── Utilidad: obtener el plan efectivo ──────────────────────────────────────
// req.empresa puede ser undefined si se usa a nivel de app (antes de proteger).
// Fallback: AELA_EDITION env. "full" se mapea a "pro" por compatibilidad.
function obtenerPlan(req) {
  const raw = req.empresa?.plan || process.env.AELA_EDITION || 'pro';
  if (raw === 'full') return 'pro';   // alias legacy
  if (['lite', 'medium', 'pro'].includes(raw)) return raw;
  return 'pro';
}

// ─── soloMediumOPro: bloquea el plan Lite ────────────────────────────────────
// Uso: router.use(soloMediumOPro) — compras, caja, inventario, POS
const soloMediumOPro = (req, res, next) => {
  if (obtenerPlan(req) === 'lite') {
    return res.status(403).json({
      success: false,
      plan: 'lite',
      mensaje: 'Esta funcionalidad no está disponible en AELA Lite. Actualiza a AELA Medium o Pro.',
    });
  }
  next();
};

// ─── soloPro: bloquea Lite y Medium ──────────────────────────────────────────
// Uso: router.use(soloPro) — retenciones, liquidaciones, ATS, contabilidad
const soloPro = (req, res, next) => {
  const plan = obtenerPlan(req);
  if (plan === 'lite' || plan === 'medium') {
    return res.status(403).json({
      success: false,
      plan,
      mensaje: 'Esta funcionalidad solo está disponible en AELA Pro.',
    });
  }
  next();
};

// Alias para compatibilidad con código previo que usaba soloFull
const soloFull = soloMediumOPro;

// ─── soloMono: bloquear multiempresa en Lite y Medium ────────────────────────
const soloMono = (req, res, next) => {
  const plan = obtenerPlan(req);
  if (process.env.MODO_EMPRESA === 'multi' && (plan === 'lite' || plan === 'medium')) {
    return res.status(403).json({
      success: false,
      mensaje: 'AELA Pro es requerido para el modo multiempresa.',
    });
  }
  next();
};

// ─── checkLimiteProductos: máximo 200 ítems en catálogo para Lite ────────────
const LIMITE_PRODUCTOS_LITE = 200;

const checkLimiteProductos = async (req, res, next) => {
  try {
    if (obtenerPlan(req) !== 'lite') return next();

    const empresaId = req.empresa?.id;
    if (!empresaId) return next();

    const total = await prisma.productos_servicios.count({ where: { empresaId } });
    if (total >= LIMITE_PRODUCTOS_LITE) {
      return res.status(403).json({
        success: false,
        plan: 'lite',
        mensaje: `El plan AELA Lite permite un máximo de ${LIMITE_PRODUCTOS_LITE} productos en el catálogo. Actualiza a Medium o Pro para agregar más.`,
        total,
        limite: LIMITE_PRODUCTOS_LITE,
      });
    }
    next();
  } catch (err) {
    console.error('checkLimiteProductos:', err);
    next();
  }
};

// ─── checkLimiteFacturas: límite anual de facturas ───────────────────────────
const checkLimiteFacturas = async (req, res, next) => {
  try {
    const empresa = req.empresa;
    if (!empresa || empresa.factAnualesMax === null || empresa.factAnualesMax === undefined) {
      return next();
    }

    const inicioAño = new Date(new Date().getFullYear(), 0, 1);
    const finAño    = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

    const usadas = await prisma.facturas.count({
      where: {
        empresaId:    empresa.id,
        anulada:      false,
        fechaEmision: { gte: inicioAño, lte: finAño },
      },
    });

    if (usadas >= empresa.factAnualesMax) {
      const planLabel = obtenerPlan(req) === 'medium' ? 'Medium' : 'Lite';
      return res.status(403).json({
        success: false,
        mensaje: `Límite anual alcanzado: ${empresa.factAnualesMax} facturas/año en AELA ${planLabel}. Actualiza tu plan para continuar.`,
        usadas,
        limite: empresa.factAnualesMax,
      });
    }

    req.facturasUsadas     = usadas;
    req.facturasRestantes  = empresa.factAnualesMax - usadas;
    next();
  } catch (err) {
    console.error('checkLimiteFacturas:', err);
    next();
  }
};

// ─── checkLimiteNotasVenta: límite anual combinado ───────────────────────────
const checkLimiteNotasVenta = async (req, res, next) => {
  try {
    const empresa = req.empresa;
    if (!empresa || empresa.factAnualesMax === null || empresa.factAnualesMax === undefined) {
      return next();
    }

    const inicioAño = new Date(new Date().getFullYear(), 0, 1);
    const finAño    = new Date(new Date().getFullYear(), 11, 31, 23, 59, 59);

    const [facturas, notasV] = await Promise.all([
      prisma.facturas.count({
        where: { empresaId: empresa.id, anulada: false, fechaEmision: { gte: inicioAño, lte: finAño } },
      }),
      prisma.notas_venta.count({
        where: { empresaId: empresa.id, anulada: false, fechaEmision: { gte: inicioAño, lte: finAño } },
      }),
    ]);

    const totalComprobantes = facturas + notasV;
    if (totalComprobantes >= empresa.factAnualesMax) {
      return res.status(403).json({
        success: false,
        mensaje: `Límite anual alcanzado: ${empresa.factAnualesMax} comprobantes/año en tu plan actual.`,
        usadas: totalComprobantes,
        limite: empresa.factAnualesMax,
      });
    }

    next();
  } catch (err) {
    next();
  }
};

// ─── checkLimiteUsuarios: máximo de usuarios por plan ────────────────────────
const checkLimiteUsuarios = async (req, res, next) => {
  try {
    const empresa = req.empresa;
    if (!empresa || empresa.maxUsuarios === null || empresa.maxUsuarios === undefined) {
      return next();
    }

    const totalUsuarios = await prisma.usuarios.count({
      where: { empresaId: empresa.id, activo: true },
    });

    if (totalUsuarios >= empresa.maxUsuarios) {
      const plan = obtenerPlan(req);
      return res.status(403).json({
        success: false,
        mensaje: `Tu plan AELA ${plan.charAt(0).toUpperCase() + plan.slice(1)} permite máximo ${empresa.maxUsuarios} usuario(s). Actualiza tu plan para agregar más.`,
        usuarios: totalUsuarios,
        limite: empresa.maxUsuarios,
      });
    }

    next();
  } catch (err) {
    console.error('checkLimiteUsuarios:', err);
    next();
  }
};

module.exports = {
  obtenerPlan,
  soloFull,          // alias legacy → soloMediumOPro
  soloMediumOPro,
  soloPro,
  soloMono,
  checkLimiteFacturas,
  checkLimiteNotasVenta,
  checkLimiteUsuarios,
  checkLimiteProductos,
};
