import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SelectorIvaFactura from '../components/shared/SelectorIvaFactura';
import { errorIvaFactura, opcionesIvaFactura } from './ivaFactura';

describe('IVA de facturas por fecha de emisión', () => {
  it('ofrece 12% para el 31/03/2024 y lo retira desde el 01/04/2024', () => {
    expect(opcionesIvaFactura('2024-03-31').map((opcion) => opcion.valor)).toContain(12);
    expect(opcionesIvaFactura('2024-04-01').map((opcion) => opcion.valor)).toEqual([0, 5, 15, 6, 7]);
  });

  it('identifica una tarifa antigua heredada del catálogo, una proforma o un carrito sin alterar importes', () => {
    const detalles = [{ ivaPorcentaje: 15 }, { codigoPrincipal: 'LEGADO12', ivaPorcentaje: '12', precioUnitario: 100 }];
    expect(errorIvaFactura(detalles, '2026-10-16')).toMatch(/ítem 2.*LEGADO12.*12%/);
    expect(detalles[1]).toEqual({ codigoPrincipal: 'LEGADO12', ivaPorcentaje: '12', precioUnitario: 100 });
    expect(errorIvaFactura(detalles, '2024-03-31')).toBe('');
  });

  it('acepta las tarifas vigentes y señala una tarifa desconocida en lugar de asumir 0%', () => {
    expect(errorIvaFactura([0, 5, 15, 6, 7].map((ivaPorcentaje) => ({ ivaPorcentaje })), '2026-10-16')).toBe('');
    expect(errorIvaFactura([{ ivaPorcentaje: 14 }], '2026-10-16')).toMatch(/14%.*no disponible/);
  });

  it('muestra explícitamente el 12% antiguo seleccionado y bloqueado, sin mostrar engañosamente 0%', () => {
    const html = renderToStaticMarkup(createElement(SelectorIvaFactura, { value: 12, fechaEmision: '2026-10-16', onChange: () => {} }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<option[^>]*value="12"[^>]*disabled=""[^>]*selected=""[^>]*>12% \(no disponible\)/);
    expect(html).toContain('value="15"');
  });
});
