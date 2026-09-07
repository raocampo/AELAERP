// ====================================
// BRANDING — logo y nombre visible del sistema
// backend/utils/branding.js
// ====================================
//
// El endpoint público /api/auth/branding sirve dos escenarios distintos:
//
//   1. Login (SIN sesión): no se sabe qué empresa va a usar quien entra, así
//      que se muestra el branding del tenant — la primera configuración
//      activa (menor empresaId), que es la empresa principal.
//   2. Sidebar del sistema (CON sesión): ahí sí se sabe en qué empresa está
//      parado el usuario. En un tenant multiempresa cada empresa tiene su
//      propia fila de configuracion_sri con su propio logo, y debe verse el
//      de la empresa activa — no el de la principal.
//
// Antes se resolvía siempre como (1), por eso una empresa secundaria con
// logo cargado seguía mostrando el ícono genérico en su sidebar.

const jwt = require('jsonwebtoken');

const SELECT_BRANDING = { razonSocial: true, nombreComercial: true, logoUrl: true };

// Lee el JWT del header SOLO si es válido y pertenece a este tenant.
// Devuelve null en cualquier otro caso — la ruta es pública, un token
// ausente o inservible no es un error, simplemente no hay empresa activa.
function leerTokenOpcional(req) {
  const header = req.headers?.authorization || '';
  if (!header.startsWith('Bearer')) return null;

  const token = header.split(' ')[1];
  if (!token) return null;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }

  // Mismo criterio que middleware/auth.js: un token emitido para otro tenant
  // no da contexto sobre este. Sin esta validación, un token de otro tenant
  // haría resolver un usuario por id contra la BD equivocada.
  const tokenTenant   = decoded.tenantSlug ?? null;
  const requestTenant = req.tenant?.slug    ?? null;
  if (tokenTenant !== requestTenant) return null;

  return decoded;
}

// Empresa activa del request, con la misma prioridad que middleware/auth.js:
// decoded.empresaId (puede venir de cambiar-empresa) > usuario.empresaId.
async function resolverEmpresaActiva(req, db) {
  const decoded = leerTokenOpcional(req);
  if (!decoded) return null;
  if (decoded.empresaId) return decoded.empresaId;
  if (!decoded.id) return null;

  const usuario = await db.usuarios.findUnique({
    where:  { id: decoded.id },
    select: { empresaId: true, activo: true },
  });
  if (!usuario || !usuario.activo) return null;
  return usuario.empresaId ?? null;
}

async function obtenerBranding(req, db) {
  let config = null;

  const empresaId = await resolverEmpresaActiva(req, db);
  if (empresaId) {
    config = await db.configuracion_sri.findFirst({
      where:  { empresaId, activo: true },
      select: SELECT_BRANDING,
    });
  }

  // Sin sesión (login), o empresa activa sin configuración propia todavía →
  // branding del tenant. Ojo: si la empresa SÍ tiene configuración pero sin
  // logo, se respeta ese vacío en vez de caer al logo de otra empresa —
  // mostrar la marca ajena sería peor que mostrar el ícono genérico.
  if (!config) {
    config = await db.configuracion_sri.findFirst({
      where:   { activo: true },
      orderBy: { empresaId: 'asc' },
      select:  SELECT_BRANDING,
    });
  }

  return {
    nombre:  config?.nombreComercial || config?.razonSocial || null,
    logoUrl: config?.logoUrl         || null,
  };
}

module.exports = { obtenerBranding, resolverEmpresaActiva };
