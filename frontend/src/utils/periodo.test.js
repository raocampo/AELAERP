import { describe, expect, it } from 'vitest';
import { normalizarPeriodoMMYYYY, periodoActualMMYYYY } from './periodo';

describe('periodo utils', () => {
  it('normaliza formatos MM/YYYY, YYYY/MM y variantes con guion o punto', () => {
    expect(normalizarPeriodoMMYYYY('3/2026')).toBe('03/2026');
    expect(normalizarPeriodoMMYYYY('2026-03')).toBe('03/2026');
    expect(normalizarPeriodoMMYYYY('03.2026')).toBe('03/2026');
  });

  it('acepta cadenas de seis dígitos y rechaza meses inválidos', () => {
    expect(normalizarPeriodoMMYYYY('032026')).toBe('03/2026');
    expect(normalizarPeriodoMMYYYY('132026')).toBe('');
    expect(normalizarPeriodoMMYYYY('2026/13')).toBe('');
  });

  it('devuelve el periodo actual en formato MM/YYYY', () => {
    expect(periodoActualMMYYYY(new Date('2026-04-22T00:00:00Z'))).toBe('04/2026');
  });
});
