import { describe, expect, it } from 'vitest';
import {
  CAPACIDADES_PLAN,
  capacidadesPlan,
  construirSistemaFallback,
  crearEmpresaFallback,
  normalizarModoOperacion,
  normalizarTipoSistema,
  obtenerModulosHabilitados,
  obtenerPlanLabel,
  planBloqueadoPorRequisito,
  moduloDeshabilitadoPorConfiguracion,
  resolverEstadoSistema,
} from './sistema';

describe('sistema utils', () => {
  it('normaliza plan, modo y etiquetas con compatibilidad legacy', () => {
    expect(normalizarTipoSistema('full')).toBe('pro');
    expect(normalizarTipoSistema('medium')).toBe('medium');
    expect(normalizarTipoSistema('otra-cosa')).toBe('pro');
    expect(normalizarModoOperacion('multi')).toBe('multiempresa');
    expect(normalizarModoOperacion('otro')).toBe('monoempresa');
    expect(obtenerPlanLabel('full')).toBe('Pro');
  });

  it('devuelve las capacidades correctas por plan', () => {
    expect(capacidadesPlan('lite')).toEqual(CAPACIDADES_PLAN.lite);
    expect(capacidadesPlan('medium').comprasHabilitadas).toBe(true);
    expect(capacidadesPlan('pro').retencionesHabilitadas).toBe(true);
  });

  it('construye fallbacks de empresa y sistema de manera consistente', () => {
    expect(crearEmpresaFallback('medium')).toEqual({
      plan: 'medium',
      factAnualesMax: 1000,
      maxUsuarios: 3,
    });

    expect(construirSistemaFallback({ plan: 'lite' }, {
      edition: 'full',
      modoOperacion: 'multi',
    })).toMatchObject({
      tipoSistema: 'lite',
      modoOperacion: 'multiempresa',
      documentoPosDefault: 'nota_venta',
      comprasHabilitadas: false,
      retencionesHabilitadas: false,
    });
  });

  it('resuelve flags de estado y módulos habilitados', () => {
    const estado = resolverEstadoSistema({
      sistema: { tipoSistema: 'medium', modoOperacion: 'multiempresa' },
      empresa: { plan: 'lite' },
      edition: 'full',
      modoOperacion: 'monoempresa',
    });

    expect(estado.esMedium).toBe(true);
    expect(estado.esLite).toBe(false);
    expect(estado.modoMulti).toBe(true);
    expect(estado.planLabel).toBe('Medium');

    expect(obtenerModulosHabilitados({
      comprasHabilitadas: true,
      retencionesHabilitadas: false,
      cajaDiariaHabilitada: true,
    })).toMatchObject({
      compras: true,
      retenciones: false,
      caja: true,
    });
  });

  it('evalúa bloqueo por plan y deshabilitación por configuración', () => {
    expect(planBloqueadoPorRequisito('medium', { esLite: true, esMedium: false })).toBe(true);
    expect(planBloqueadoPorRequisito('pro', { esLite: false, esMedium: true })).toBe(true);
    expect(planBloqueadoPorRequisito('pro', { esLite: false, esMedium: false })).toBe(false);

    expect(moduloDeshabilitadoPorConfiguracion(
      { modulo: 'retencionesHabilitadas' },
      { retencionesHabilitadas: false }
    )).toBe(true);
    expect(moduloDeshabilitadoPorConfiguracion(
      { modulo: 'comprasHabilitadas' },
      { comprasHabilitadas: true }
    )).toBe(false);
  });
});
