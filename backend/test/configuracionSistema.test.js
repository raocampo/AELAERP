const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizarTipoSistema,
  normalizarModoOperacion,
  capacidadesPlan,
  construirPayloadConfiguracionSistema,
} = require('../utils/configuracionSistema');

test('normalizarTipoSistema mantiene compatibilidad con full y cae a pro cuando es inválido', () => {
  assert.equal(normalizarTipoSistema('full'), 'pro');
  assert.equal(normalizarTipoSistema('medium'), 'medium');
  assert.equal(normalizarTipoSistema('desconocido'), 'pro');
});

test('normalizarModoOperacion resuelve alias multi y protege fallback', () => {
  assert.equal(normalizarModoOperacion('multi'), 'multiempresa');
  assert.equal(normalizarModoOperacion('multiempresa'), 'multiempresa');
  assert.equal(normalizarModoOperacion('otro'), 'monoempresa');
});

test('capacidadesPlan aplica restricciones correctas por plan', () => {
  assert.deepEqual(capacidadesPlan('lite'), {
    cajaDiariaHabilitada: false,
    posHabilitado: false,
    inventarioHabilitado: false,
    comprasHabilitadas: false,
    contabilidadHabilitada: false,
    retencionesHabilitadas: false,
    liquidacionesHabilitadas: false,
    atsHabilitado: false,
    talentoHumanoHabilitado: false,
  });

  assert.deepEqual(capacidadesPlan('medium'), {
    cajaDiariaHabilitada: true,
    posHabilitado: true,
    inventarioHabilitado: true,
    comprasHabilitadas: true,
    contabilidadHabilitada: false,
    retencionesHabilitadas: false,
    liquidacionesHabilitadas: false,
    atsHabilitado: false,
    talentoHumanoHabilitado: true,
  });
});

test('construirPayloadConfiguracionSistema no permite activar módulos bloqueados por el plan', () => {
  const actual = {
    tipoSistema: 'medium',
    modoOperacion: 'monoempresa',
    cajaNombre: 'Caja Matriz',
    cajaDiariaHabilitada: true,
    cierreCajaObligatorio: false,
    posHabilitado: true,
    documentoPosDefault: 'factura',
    impresionAutoReciboPos: false,
    impresoraKiosko: '',
    inventarioHabilitado: true,
    permitirStockNegativo: false,
    comprasHabilitadas: true,
    contabilidadHabilitada: false,
    retencionesHabilitadas: false,
    liquidacionesHabilitadas: false,
    atsHabilitado: false,
  };

  const payload = construirPayloadConfiguracionSistema(actual, {
    tipoSistema: 'medium',
    contabilidadHabilitada: true,
    retencionesHabilitadas: true,
    liquidacionesHabilitadas: true,
    atsHabilitado: true,
    inventarioHabilitado: false,
    posHabilitado: false,
  });

  assert.equal(payload.tipoSistema, 'medium');
  assert.equal(payload.contabilidadHabilitada, false);
  assert.equal(payload.retencionesHabilitadas, false);
  assert.equal(payload.liquidacionesHabilitadas, false);
  assert.equal(payload.atsHabilitado, false);
  assert.equal(payload.inventarioHabilitado, false);
  assert.equal(payload.posHabilitado, false);
  assert.equal(payload.impresionAutoReciboPos, false);
  assert.equal(payload.impresoraKiosko, '');
});

test('construirPayloadConfiguracionSistema normaliza datos de impresión para kiosko', () => {
  const payload = construirPayloadConfiguracionSistema({
    tipoSistema: 'pro',
    modoOperacion: 'monoempresa',
    impresoraKiosko: '  Epson TM-T20  ',
    impresionAutoReciboPos: false,
  }, {
    impresoraKiosko: '  Cocina / Caja  ',
    impresionAutoReciboPos: true,
  });

  assert.equal(payload.impresoraKiosko, 'Cocina / Caja');
  assert.equal(payload.impresionAutoReciboPos, true);
});
