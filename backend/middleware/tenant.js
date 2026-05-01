// ====================================
// MIDDLEWARE — Resolución de Tenant
// Determina qué tenant corresponde al request actual.
//
// Estrategia de resolución (en orden de prioridad):
//   1. Header  X-Tenant-Slug     (para APIs internas / testing)
//   2. Subdominio del host       empresa.aela.ec → slug = "empresa"
//   3. Dominio personalizado     factura.miempresa.com → brandConfig.dominio
//   4. Variable de entorno       AELA_TENANT_SLUG (modo monoinstancia/dev)
//
// Si se resuelve un tenant → inyecta req.tenant y req.prisma
// Si no se resuelve → deja pasar (modo monoinstancia sin multi-tenant)
// ====================================

const { getPrismaMaster } = require('../config/prismaMaster');
const { getTenantPrisma }  = require('../config/prismaTenant');

// ─── Cache de tenants en memoria (TTL 5 min) ─────────────────────────────────
const _cache  = new Map(); // slug/dominio → { tenant, expiresAt }
const TTL_MS  = 5 * 60 * 1000; // 5 minutos

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { _cache.delete(key); return null; }
  return entry.tenant;
}

function setCache(key, tenant) {
  _cache.set(key, { tenant, expiresAt: Date.now() + TTL_MS });
}

// ─── Resolver slug desde el host ─────────────────────────────────────────────
function resolverSlugDesdeHost(host) {
  if (!host) return null;
  const hostSinPuerto = host.split(':')[0];

  // Subdominio de aela.ec / scfi.ec / tu dominio base
  const dominioBase = process.env.AELA_DOMINIO_BASE || 'aela.ec';
  const sufijo = `.${dominioBase}`;

  if (hostSinPuerto.endsWith(sufijo)) {
    const slug = hostSinPuerto.slice(0, -sufijo.length);
    // Evitar el propio dominio base y www
    if (slug && slug !== 'www' && slug !== 'app') return slug;
  }

  return null;
}

// ─── Buscar tenant en BD master ───────────────────────────────────────────────
async function buscarTenant({ slug, dominio }) {
  const cacheKey = slug || dominio;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const master = getPrismaMaster();
    let tenant = null;

    if (slug) {
      tenant = await master.tenants.findUnique({ where: { slug } });
    } else if (dominio) {
      // Buscar por dominio personalizado en brandConfig
      const todos = await master.tenants.findMany({
        where: { estado: 'activo' },
        select: { id: true, slug: true, plan: true, estado: true, dbName: true, dbHost: true, dbPort: true, dbUser: true, dbPass: true, brandConfig: true },
      });
      tenant = todos.find((t) => {
        const bc = t.brandConfig;
        return bc && typeof bc === 'object' && bc.dominio === dominio;
      }) || null;
    }

    if (tenant) setCache(cacheKey, tenant);
    return tenant;
  } catch (err) {
    // Si la BD master no está disponible (modo dev sin multi-tenant),
    // devolvemos null silenciosamente
    if (process.env.NODE_ENV === 'development') return null;
    throw err;
  }
}

// ─── Middleware principal ─────────────────────────────────────────────────────
async function resolverTenant(req, res, next) {
  try {
    let slug = null;

    // 1. Header explícito (APIs internas, testing)
    if (req.headers['x-tenant-slug']) {
      slug = String(req.headers['x-tenant-slug']).toLowerCase().trim();
    }

    // 2. Subdominio del host
    if (!slug) {
      slug = resolverSlugDesdeHost(req.headers.host);
    }

    // 3. Variable de entorno (monoinstancia / desarrollo)
    if (!slug && process.env.AELA_TENANT_SLUG) {
      slug = process.env.AELA_TENANT_SLUG;
    }

    if (!slug) {
      // Sin slug → modo monoinstancia sin multi-tenant, continuar normal
      return next();
    }

    // 4. Buscar tenant en BD master
    const tenant = await buscarTenant({ slug });

    if (!tenant) {
      return res.status(404).json({
        success: false,
        mensaje: `Tenant '${slug}' no encontrado.`,
      });
    }

    if (tenant.estado === 'suspendido') {
      return res.status(402).json({
        success: false,
        mensaje: 'Tu cuenta está suspendida. Por favor contacta a soporte.',
        codigo: 'TENANT_SUSPENDIDO',
      });
    }

    if (tenant.estado === 'vencido') {
      return res.status(402).json({
        success: false,
        mensaje: 'Tu plan ha vencido. Por favor renueva tu suscripción.',
        codigo: 'TENANT_VENCIDO',
      });
    }

    if (tenant.estado === 'provisioning') {
      return res.status(503).json({
        success: false,
        mensaje: 'Tu cuenta está siendo configurada. Intenta en unos minutos.',
        codigo: 'TENANT_PROVISIONING',
      });
    }

    // 5. Inyectar en el request
    req.tenant = tenant;
    req.prisma = getTenantPrisma(tenant);

    next();
  } catch (err) {
    console.error('Error resolviendo tenant:', err?.message);
    res.status(500).json({ success: false, mensaje: 'Error interno al resolver tenant.' });
  }
}

// ─── Invalidar cache de un tenant (llamar tras actualizar plan/estado) ────────
function invalidarCacheTenant(slug) {
  _cache.delete(slug);
}

module.exports = { resolverTenant, invalidarCacheTenant };
