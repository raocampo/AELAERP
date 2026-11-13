const test = require('node:test');
const assert = require('node:assert/strict');
const { regimenDesdeSri, sincronizarRegimenConfig } = require('../utils/regimenSri');
const { parsearContribuyenteSri } = require('../utils/sriContribuyente');

// Respuestas reales del catastro (ConsolidadoContribuyente/obtenerPorNumerosRuc, 2026-11-13)
const GENERAL = { numeroRuc: '1103568240001', razonSocial: 'OCAMPO OCAMPO ROBERT ALEJANDRO', regimen: 'GENERAL', categoria: null, obligadoLlevarContabilidad: 'NO' };
const POPULAR = { numeroRuc: '0201133642001', razonSocial: 'LARA CARRERA LUIS SEVERO', regimen: 'RIMPE', categoria: 'NEGOCIO POPULAR', obligadoLlevarContabilidad: 'NO' };
const EMPRENDEDOR = { numeroRuc: '1105863839001', razonSocial: 'X', regimen: 'RIMPE', categoria: 'EMPRENDEDOR', obligadoLlevarContabilidad: 'NO' };

test('regimenDesdeSri interpreta regimen + categoria y descarta respuestas dudosas', () => {
  assert.deepEqual(regimenDesdeSri(GENERAL, GENERAL.numeroRuc), { contribuyenteRimpe: false, negocioPopular: false, obligadoContabilidad: false });
  assert.deepEqual(regimenDesdeSri(POPULAR), { contribuyenteRimpe: true, negocioPopular: true, obligadoContabilidad: false });
  assert.deepEqual(regimenDesdeSri(EMPRENDEDOR), { contribuyenteRimpe: true, negocioPopular: false, obligadoContabilidad: false });
  assert.equal(regimenDesdeSri(null), null);
  assert.equal(regimenDesdeSri({ ...GENERAL, regimen: '' }), null);
  assert.equal(regimenDesdeSri(GENERAL, '0999999999001'), null, 'RUC distinto no se aplica');
});

test('parsearContribuyenteSri detecta Negocio Popular por la categoria', () => {
  const r = parsearContribuyenteSri(POPULAR, POPULAR.numeroRuc);
  assert.equal(r.contribuyenteRimpe, true);
  assert.equal(r.negocioPopular, true);
  assert.equal(parsearContribuyenteSri(GENERAL, GENERAL.numeroRuc).contribuyenteRimpe, false);
});

function dbFake() {
  const st = { updates: [], raws: [], sistema: { documentoPosDefault: 'nota_venta' } };
  return {
    st,
    configuracion_sri: { update: async ({ data }) => { st.updates.push(data); return data; } },
    configuracion_sistema: {
      findUnique: async () => st.sistema,
      findFirst: async () => st.sistema,
      create: async ({ data }) => (st.sistema = data),
      update: async ({ data }) => Object.assign(st.sistema, data),
    },
    empresas: { findUnique: async () => ({ id: 1 }), findFirst: async () => ({ id: 1 }) },
    $executeRaw: async (strings) => { st.raws.push(strings.join('?')); return 1; },
  };
}

test('RIMPE -> GENERAL: actualiza la configuración y registra el cambio', async () => {
  const db = dbFake();
  const config = { id: 1, empresaId: 1, ruc: GENERAL.numeroRuc, contribuyenteRimpe: true, negocioPopular: false, obligadoContabilidad: false };
  const r = await sincronizarRegimenConfig({ db, config, consultar: async () => GENERAL });
  assert.equal(r.estado, 'actualizado');
  assert.deepEqual(r.cambios, ['contribuyenteRimpe']);
  const u = db.st.updates[0];
  assert.equal(u.contribuyenteRimpe, false);
  assert.equal(u.regimenSriCambio.antes.regimen, 'RIMPE Emprendedor');
  assert.equal(u.regimenSriCambio.despues.regimen, 'Régimen General');
  assert.equal(db.st.raws.length, 0, 'sin Negocio Popular de por medio no se tocan precios');
});

test('sin cambios solo marca la fecha de verificación; SRI caído no toca nada', async () => {
  const db = dbFake();
  const config = { id: 1, empresaId: 1, ruc: GENERAL.numeroRuc, contribuyenteRimpe: false, negocioPopular: false, obligadoContabilidad: false };
  assert.equal((await sincronizarRegimenConfig({ db, config, consultar: async () => GENERAL })).estado, 'sin_cambios');
  assert.deepEqual(Object.keys(db.st.updates[0]), ['regimenSriVerificadoEn']);
  const db2 = dbFake();
  assert.equal((await sincronizarRegimenConfig({ db: db2, config, consultar: async () => null })).estado, 'sri_no_disponible');
  assert.equal(db2.st.updates.length, 0);
});

test('Negocio Popular -> GENERAL convierte el catálogo a base sin IVA', async () => {
  const db = dbFake();
  const config = { id: 1, empresaId: 1, ruc: GENERAL.numeroRuc, contribuyenteRimpe: true, negocioPopular: true, obligadoContabilidad: false };
  const r = await sincronizarRegimenConfig({ db, config, consultar: async () => GENERAL });
  assert.deepEqual(r.cambios.sort(), ['contribuyenteRimpe', 'negocioPopular']);
  assert.equal(db.st.raws.length, 1);
  assert.match(db.st.raws[0], /"precioUnitario" \//);
});
