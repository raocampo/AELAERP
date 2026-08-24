const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularAnticipoIR } = require('../utils/anticipoIR');

function f101Con(utilidadContable, retenciones = 0) {
  return {
    resultado: { utilidadContable },
    retenciones: { totalRetencionRentaRecibida: retenciones },
  };
}

test('calcularAnticipoIR marca RIMPE como no aplicable, sin calcular nada', () => {
  const r = calcularAnticipoIR(
    f101Con(10000),
    { tipoContribuyente: 'NATURAL' },
    { contribuyenteRimpe: true, obligadoContabilidad: false },
  );
  assert.equal(r.aplicable, false);
  assert.match(r.motivo, /RIMPE/);
});

test('calcularAnticipoIR marca persona natural no obligada a contabilidad como no aplicable', () => {
  const r = calcularAnticipoIR(
    f101Con(10000),
    { tipoContribuyente: 'NATURAL' },
    { contribuyenteRimpe: false, obligadoContabilidad: false },
  );
  assert.equal(r.aplicable, false);
  assert.match(r.motivo, /no obligada a llevar contabilidad/);
});

test('calcularAnticipoIR marca pérdida contable como no aplicable', () => {
  const r = calcularAnticipoIR(
    f101Con(-500),
    { tipoContribuyente: 'JURIDICA' },
    { contribuyenteRimpe: false },
  );
  assert.equal(r.aplicable, false);
  assert.match(r.motivo, /pérdida/);
});

test('calcularAnticipoIR — sociedad: 15% participación, 25% tarifa, 50% del causado neto de retenciones', () => {
  // utilidad 10000 -> participación 1500 -> base 8500 -> causado 8500*0.25=2125
  // retenciones 200 -> anticipo = (2125-200)*0.5 = 962.50
  const r = calcularAnticipoIR(
    f101Con(10000, 200),
    { tipoContribuyente: 'JURIDICA' },
    { contribuyenteRimpe: false },
  );
  assert.equal(r.aplicable, true);
  assert.equal(r.participacionTrabajadores, 1500);
  assert.equal(r.baseImponibleSimplificada, 8500);
  assert.equal(r.impuestoCausado, 2125);
  assert.equal(r.anticipoSugerido, 962.5);
});

test('calcularAnticipoIR — persona natural obligada a contabilidad usa la tabla progresiva LORTI', () => {
  // utilidad 50000 -> participación 7500 -> base 42500
  // tabla 2026: tramo 35136-46575, impFB 2678, 20%: 2678 + (42500-35136)*0.20 = 2678+1472.8=4150.8
  const r = calcularAnticipoIR(
    f101Con(50000, 0),
    { tipoContribuyente: 'NATURAL' },
    { contribuyenteRimpe: false, obligadoContabilidad: true },
  );
  assert.equal(r.aplicable, true);
  assert.equal(r.participacionTrabajadores, 7500);
  assert.equal(r.baseImponibleSimplificada, 42500);
  assert.equal(r.impuestoCausado, 4150.8);
  assert.equal(r.anticipoSugerido, 2075.4);
});

test('calcularAnticipoIR nunca sugiere un anticipo negativo cuando las retenciones superan al causado', () => {
  const r = calcularAnticipoIR(
    f101Con(1000, 999999),
    { tipoContribuyente: 'JURIDICA' },
    { contribuyenteRimpe: false },
  );
  assert.equal(r.aplicable, true);
  assert.equal(r.anticipoSugerido, 0);
});
