import { describe, expect, it } from 'vitest';
import { distribuirDescuentoGeneral, subtotalBase } from './descuentoGeneral';

describe('distribuirDescuentoGeneral', () => {
  it('reparte a prorrata según el peso de cada línea y cuadra exacto con el monto general', () => {
    const detalles = [
      { cantidad: 1, precioUnitario: 30, descuento: 0 },
      { cantidad: 1, precioUnitario: 70, descuento: 0 },
    ];
    const resultado = distribuirDescuentoGeneral(detalles, 10);
    // 30/100 * 10 = 3.00; el resto (7.00) va a la última línea
    expect(resultado[0].descuento).toBe(3);
    expect(resultado[1].descuento).toBe(7);
    const sumaDescuentos = resultado.reduce((a, d) => a + d.descuento, 0);
    expect(sumaDescuentos).toBe(10);
  });

  it('suma al descuento de línea ya existente, no lo reemplaza', () => {
    const detalles = [
      { cantidad: 1, precioUnitario: 50, descuento: 5 },  // base 45
      { cantidad: 1, precioUnitario: 50, descuento: 0 },  // base 50
    ];
    const resultado = distribuirDescuentoGeneral(detalles, 19);
    // base total 95; línea 1: 45/95*19=9.00 + su propio 5 = 14; línea 2 (última): resto
    expect(resultado[0].descuento).toBe(14);
    expect(resultado[1].descuento).toBe(0 + (19 - 9));
    const sumaGeneral = (resultado[0].descuento - 5) + resultado[1].descuento;
    expect(Number(sumaGeneral.toFixed(2))).toBe(19);
  });

  it('no cuadra en centavos con 3+ líneas (caso clásico de redondeo) y aun así la suma es exacta', () => {
    const detalles = [
      { cantidad: 1, precioUnitario: 10, descuento: 0 },
      { cantidad: 1, precioUnitario: 10, descuento: 0 },
      { cantidad: 1, precioUnitario: 10, descuento: 0 },
    ];
    const resultado = distribuirDescuentoGeneral(detalles, 10);
    const suma = resultado.reduce((a, d) => a + d.descuento, 0);
    expect(Number(suma.toFixed(2))).toBe(10);
  });

  it('monto general 0, vacío o negativo no modifica los detalles', () => {
    const detalles = [{ cantidad: 1, precioUnitario: 30, descuento: 0 }];
    expect(distribuirDescuentoGeneral(detalles, 0)).toBe(detalles);
    expect(distribuirDescuentoGeneral(detalles, '')).toBe(detalles);
    expect(distribuirDescuentoGeneral(detalles, -5)).toBe(detalles);
  });

  it('detalles vacío o con base total 0 devuelve los detalles sin tocar (evita división por cero)', () => {
    expect(distribuirDescuentoGeneral([], 10)).toEqual([]);
    const detalles = [{ cantidad: 1, precioUnitario: 0, descuento: 0 }];
    expect(distribuirDescuentoGeneral(detalles, 10)).toBe(detalles);
  });

  it('ninguna línea da negativo — regresión del caso real que el SRI rechazó (error 35, descuento -0.01)', () => {
    // 5 líneas de igual peso y un descuento general de $0.03: el algoritmo
    // viejo redondeaba cada una de las 4 primeras líneas hacia arriba
    // (0.006 → 0.01) de forma independiente, acumulando 0.04 antes de
    // llegar a la última línea, que se quedaba con 0.03 - 0.04 = -0.01 —
    // exactamente el valor que el SRI rechazó en producción.
    const detalles = Array.from({ length: 5 }, () => ({ cantidad: 1, precioUnitario: 20, descuento: 0 }));
    const resultado = distribuirDescuentoGeneral(detalles, 0.03);
    resultado.forEach((d) => expect(d.descuento).toBeGreaterThanOrEqual(0));
    const suma = resultado.reduce((a, d) => a + d.descuento, 0);
    expect(Number(suma.toFixed(2))).toBe(0.03);
  });

  it('el reparto en centavos nunca deja una línea negativa con muchas líneas y montos "feos"', () => {
    const detalles = Array.from({ length: 11 }, (_, i) => ({ cantidad: 1, precioUnitario: 7 + i, descuento: 0 }));
    const resultado = distribuirDescuentoGeneral(detalles, 3.33);
    resultado.forEach((d) => expect(d.descuento).toBeGreaterThanOrEqual(0));
    const suma = resultado.reduce((a, d) => a + d.descuento, 0);
    expect(Number(suma.toFixed(2))).toBe(3.33);
  });
});

describe('subtotalBase', () => {
  it('suma cantidad*precio menos el descuento de línea de cada detalle', () => {
    const detalles = [
      { cantidad: 2, precioUnitario: 10, descuento: 1 }, // 19
      { cantidad: 1, precioUnitario: 5, descuento: 0 },  // 5
    ];
    expect(subtotalBase(detalles)).toBe(24);
  });

  it('nunca da negativo por línea aunque el descuento de línea supere su propio subtotal', () => {
    const detalles = [{ cantidad: 1, precioUnitario: 5, descuento: 100 }];
    expect(subtotalBase(detalles)).toBe(0);
  });
});
