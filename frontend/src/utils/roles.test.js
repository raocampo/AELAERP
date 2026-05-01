import { describe, expect, it } from 'vitest';
import { normalizarRol, obtenerRolLabel, tienePermiso } from './roles';

describe('roles utils', () => {
  it('normaliza aliases y usa operador por defecto', () => {
    expect(normalizarRol('Administrador')).toBe('admin');
    expect(normalizarRol('gerente')).toBe('supervisor');
    expect(normalizarRol('')).toBe('operador');
  });

  it('devuelve etiquetas legibles para roles conocidos', () => {
    expect(obtenerRolLabel('contador')).toBe('Contador / Financiero');
    expect(obtenerRolLabel('facturador')).toBe('Facturador');
  });

  it('evalúa permisos de acuerdo al rol', () => {
    expect(tienePermiso('contador', 'contabilidad.gestionar')).toBe(true);
    expect(tienePermiso('operador', 'contabilidad.gestionar')).toBe(false);
    expect(tienePermiso('facturador', 'productos.gestionar')).toBe(true);
  });
});
