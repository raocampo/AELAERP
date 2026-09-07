const test   = require('node:test');
const assert = require('node:assert/strict');
const jwt    = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-branding';

const { obtenerBranding } = require('../utils/branding');

// BD falsa con dos empresas del mismo tenant: la principal (id 1, sin logo) y
// una secundaria (id 4) que sí subió el suyo — el caso real reportado.
function crearDb({ configs, usuarios = [] } = {}) {
  const llamadas = [];
  return {
    llamadas,
    configuracion_sri: {
      async findFirst({ where, orderBy }) {
        llamadas.push(where);
        let filas = configs.filter((c) => c.activo === where.activo);
        if (where.empresaId !== undefined) {
          filas = filas.filter((c) => c.empresaId === where.empresaId);
        }
        if (orderBy?.empresaId === 'asc') {
          filas = [...filas].sort((a, b) => a.empresaId - b.empresaId);
        }
        return filas[0] || null;
      },
    },
    usuarios: {
      async findUnique({ where }) {
        return usuarios.find((u) => u.id === where.id) || null;
      },
    },
  };
}

const CONFIGS = [
  { empresaId: 1, activo: true, razonSocial: 'MACRO PRINCIPAL', nombreComercial: null,                 logoUrl: null },
  { empresaId: 4, activo: true, razonSocial: 'MENDOZA AGUIRRE', nombreComercial: 'COBIJANDO TUS SUEÑOS', logoUrl: 'data:image/png;base64,LOGO4' },
];

const req = (token, tenantSlug = null) => ({
  headers: token ? { authorization: `Bearer ${token}` } : {},
  tenant:  tenantSlug ? { slug: tenantSlug } : undefined,
});

const firmar = (payload) => jwt.sign(payload, process.env.JWT_SECRET);

test('sin token devuelve el branding del tenant (empresa de menor id)', async () => {
  const data = await obtenerBranding(req(null), crearDb({ configs: CONFIGS }));
  assert.equal(data.nombre, 'MACRO PRINCIPAL');
  assert.equal(data.logoUrl, null);
});

test('con sesión en una empresa secundaria devuelve SU logo, no el de la principal', async () => {
  const token = firmar({ id: 9, empresaId: 4, rol: 'admin' });
  const data  = await obtenerBranding(req(token), crearDb({ configs: CONFIGS }));

  assert.equal(data.logoUrl, 'data:image/png;base64,LOGO4');
  assert.equal(data.nombre, 'COBIJANDO TUS SUEÑOS');
});

test('sin empresaId en el JWT cae a la empresa base del usuario', async () => {
  const token = firmar({ id: 9, rol: 'admin' });
  const db    = crearDb({ configs: CONFIGS, usuarios: [{ id: 9, empresaId: 4, activo: true }] });

  assert.equal((await obtenerBranding(req(token), db)).logoUrl, 'data:image/png;base64,LOGO4');
});

test('un token de otro tenant se ignora (no resuelve empresa ajena)', async () => {
  const token = firmar({ id: 9, empresaId: 4, tenantSlug: 'otro-tenant' });
  const data  = await obtenerBranding(req(token), crearDb({ configs: CONFIGS }));

  assert.equal(data.nombre, 'MACRO PRINCIPAL'); // branding público, no el de la empresa 4
});

test('token inválido no rompe: responde como público', async () => {
  const data = await obtenerBranding(req('no-es-un-jwt'), crearDb({ configs: CONFIGS }));
  assert.equal(data.nombre, 'MACRO PRINCIPAL');
});

test('empresa con configuración propia SIN logo no hereda el de otra empresa', async () => {
  const configs = [
    { empresaId: 1, activo: true, razonSocial: 'PRINCIPAL', nombreComercial: null, logoUrl: 'data:image/png;base64,LOGO1' },
    { empresaId: 4, activo: true, razonSocial: 'SECUNDARIA', nombreComercial: null, logoUrl: null },
  ];
  const token = firmar({ id: 9, empresaId: 4 });
  const data  = await obtenerBranding(req(token), crearDb({ configs }));

  assert.equal(data.logoUrl, null);
  assert.equal(data.nombre, 'SECUNDARIA');
});

test('empresa activa sin configuracion_sri todavía cae al branding del tenant', async () => {
  const token = firmar({ id: 9, empresaId: 77 });
  const data  = await obtenerBranding(req(token), crearDb({ configs: CONFIGS }));

  assert.equal(data.nombre, 'MACRO PRINCIPAL');
});

test('monoempresa: la sesión resuelve la misma única configuración', async () => {
  const configs = [{ empresaId: 1, activo: true, razonSocial: 'UNICA', nombreComercial: null, logoUrl: 'data:image/png;base64,SOLO' }];
  const token   = firmar({ id: 1, empresaId: 1 });

  assert.equal((await obtenerBranding(req(token), crearDb({ configs }))).logoUrl, 'data:image/png;base64,SOLO');
});
