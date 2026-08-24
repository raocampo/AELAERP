// ====================================
// ANTICIPO DE IMPUESTO A LA RENTA (Art. 41 LRTI) — Fase 1 simplificada
// backend/utils/anticipoIR.js
//
// Base legal (texto vigente confirmado 2026-08-24 contra la LRTI codificada
// oficial del SRI, sri.gob.ec): "El pago del impuesto podrá anticiparse de
// forma voluntaria, y será equivalente al cincuenta por ciento (50%) del
// impuesto a la renta causado del ejercicio fiscal anterior, menos las
// retenciones en la fuente efectuadas en dicho ejercicio fiscal." (Art. 41).
// La fórmula clásica 0.2%/0.4% sobre activos/patrimonio YA NO EXISTE — es
// una fórmula única, no varía por tipo de contribuyente.
//
// El "impuesto causado" real exige la conciliación tributaria completa que
// declaraciones.js (calcularF101) explícitamente deja fuera de alcance
// (gastos no deducibles, amortización de pérdidas de años anteriores,
// créditos por ISD/incentivos de tarifa). Fase 1 cubre el caso simple con
// datos 100% reales:
//   - Participación a trabajadores 15% sobre la utilidad contable (Código
//     del Trabajo Art. 97) — sí se calcula con datos reales del sistema.
//   - Tarifa según régimen: sociedad → 25% general (Art. 37 LRTI, sin las
//     reducciones especiales de micro/pequeña empresa, exportador habitual
//     o nueva inversión); persona natural obligada a llevar contabilidad →
//     tabla progresiva LORTI (la misma que usa Talento Humano para nómina).
//   - Asume $0 en gastos no deducibles y pérdidas de años anteriores —
//     advertencia explícita en el resultado y en el PDF.
// Solo aplica a régimen general (sociedades o personas naturales obligadas
// a llevar contabilidad): RIMPE tiene su propio mecanismo de declaración y
// pago anticipado (calendario por noveno dígito del RUC, no relacionado con
// el Art. 41) y no presenta Formulario 101 — se marca explícitamente "no
// aplicable" en vez de calcular un número incorrecto.
// ====================================

const { aplicarTablaProgresivaRenta } = require('./tablaRentaPN');

const TARIFA_SOCIEDADES_2026 = 0.25; // Art. 37 LRTI, tarifa general (sin reducciones especiales)

/**
 * @param {object} f101 - resultado de calcularF101 (declaraciones.js): usa
 *   f101.resultado.utilidadContable y f101.retenciones.totalRetencionRentaRecibida.
 * @param {{tipoContribuyente?: string}} empresa - fila de `empresas` (NATURAL | JURIDICA).
 * @param {{obligadoContabilidad?: boolean, contribuyenteRimpe?: boolean}} config - fila de `configuracion_sri`.
 */
function calcularAnticipoIR(f101, empresa, config) {
  const tipo = (empresa?.tipoContribuyente || '').toUpperCase();
  const obligadoContabilidad = !!config?.obligadoContabilidad;
  const esRimpe = !!config?.contribuyenteRimpe;
  const esSociedad = !esRimpe && tipo === 'JURIDICA';
  const esPersonaNaturalContab = !esRimpe && tipo === 'NATURAL' && obligadoContabilidad;

  if (esRimpe) {
    return {
      aplicable: false,
      motivo: 'Contribuyente RIMPE — el Art. 41 LRTI y el Formulario 101 aplican a régimen general; RIMPE tiene su propio mecanismo de declaración y pago (calendario por noveno dígito del RUC), no soportado por AELA.',
    };
  }
  if (!esSociedad && !esPersonaNaturalContab) {
    return {
      aplicable: false,
      motivo: 'Persona natural no obligada a llevar contabilidad — el Formulario 101 aplica a sociedades o a personas naturales obligadas a llevar contabilidad. Verifique "Obligado a llevar contabilidad" en Configuración SRI si esto no es correcto.',
    };
  }

  if (f101.resultado.utilidadContable <= 0) {
    return {
      aplicable: false,
      motivo: 'El ejercicio registra pérdida contable (o utilidad cero) — no hay impuesto causado ni anticipo aplicable.',
    };
  }

  const participacionTrabajadores = parseFloat((f101.resultado.utilidadContable * 0.15).toFixed(2));
  const baseImponibleSimplificada = parseFloat((f101.resultado.utilidadContable - participacionTrabajadores).toFixed(2));

  let impuestoCausado, tarifaDesc;
  if (esSociedad) {
    impuestoCausado = parseFloat((baseImponibleSimplificada * TARIFA_SOCIEDADES_2026).toFixed(2));
    tarifaDesc = `${(TARIFA_SOCIEDADES_2026 * 100).toFixed(0)}% tarifa general sociedades (Art. 37 LRTI)`;
  } else {
    impuestoCausado = aplicarTablaProgresivaRenta(baseImponibleSimplificada);
    tarifaDesc = 'Tabla progresiva LORTI (persona natural obligada a llevar contabilidad)';
  }

  const retenciones = f101.retenciones.totalRetencionRentaRecibida;
  const anticipoSugerido = parseFloat((Math.max(0, impuestoCausado - retenciones) * 0.5).toFixed(2));

  return {
    aplicable: true,
    tipoContribuyente: esSociedad ? 'Sociedad' : 'Persona natural obligada a contabilidad',
    tarifaDesc,
    participacionTrabajadores,
    baseImponibleSimplificada,
    impuestoCausado,
    retenciones,
    anticipoSugerido,
    advertencias: [
      'Cálculo simplificado (Fase 1): NO incluye gastos no deducibles, ingresos exentos, amortización de pérdidas tributarias de años anteriores, créditos por ISD, ni reducciones especiales de tarifa (micro/pequeña empresa, exportador habitual, nueva inversión). El impuesto causado real puede ser distinto.',
      'El anticipo es VOLUNTARIO (Art. 41 LRTI reformado) — no es obligatorio pagarlo. El valor sugerido corresponde al ejercicio SIGUIENTE al aquí calculado.',
    ],
  };
}

module.exports = { calcularAnticipoIR, TARIFA_SOCIEDADES_2026 };
