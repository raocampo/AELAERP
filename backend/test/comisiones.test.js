const test = require('node:test');
const assert = require('node:assert/strict');
const { devengarComisionFacturacion, devengarComisionCobro } = require('../utils/comisiones');

// Mock mínimo de Prisma: solo lo que asegurarConfiguracionSistemaEmpresa()
// necesita (empresas.findUnique + configuracion_sistema.findUnique) más
// comision_devengada.create, capturando los argumentos con los que se llamó.
function crearDb({ comisionVendedorFacturar = 2, comisionVendedorCobrar = 1 } = {}) {
  const creadas = [];
  return {
    creadas,
    empresas: { async findUnique({ where }) { return { id: where.id }; } },
    configuracion_sistema: {
      async findUnique({ where }) {
        return { empresaId: where.empresaId, comisionVendedorFacturar, comisionVendedorCobrar };
      },
    },
    comision_devengada: {
      async create({ data }) { creadas.push(data); return { id: creadas.length, ...data }; },
    },
  };
}

test('devengarComisionFacturacion calcula el % sobre el subtotal sin IVA', async () => {
  const db = crearDb({ comisionVendedorFacturar: 2 });
  const r = await devengarComisionFacturacion({ db, empresaId: 1, vendedorId: 7, facturaId: 100, subtotalSinIva: 500 });
  assert.equal(r.monto, 10); // 2% de 500
  assert.equal(db.creadas[0].origen, 'FACTURACION');
  assert.equal(db.creadas[0].base, 500);
  assert.equal(db.creadas[0].facturaId, 100);
  assert.equal(db.creadas[0].vendedorId, 7);
});

test('devengarComisionFacturacion no crea nada si el % configurado es 0', async () => {
  const db = crearDb({ comisionVendedorFacturar: 0 });
  const r = await devengarComisionFacturacion({ db, empresaId: 1, vendedorId: 7, facturaId: 100, subtotalSinIva: 500 });
  assert.equal(r, null);
  assert.equal(db.creadas.length, 0);
});

test('devengarComisionCobro calcula sobre la porción neta (sin IVA) proporcional al cobro', async () => {
  // Factura de $115 (subtotal $100 + IVA $15) — proporción neta = 100/115.
  const db = crearDb({ comisionVendedorCobrar: 1 });
  const r = await devengarComisionCobro({
    db, empresaId: 1, vendedorId: 7, facturaId: 100, cobroId: 200,
    montoCobro: 57.5, importeTotalFactura: 115, totalIvaFactura: 15,
  });
  // base neta = 57.5 * (100/115) = 50; comisión 1% de 50 = 0.5
  assert.equal(r.base, 50);
  assert.equal(r.monto, 0.5);
  assert.equal(db.creadas[0].origen, 'COBRO');
  assert.equal(db.creadas[0].cobroId, 200);
});

test('devengarComisionCobro devuelve null sin factura/monto/porcentaje válidos', async () => {
  const dbSinPct = crearDb({ comisionVendedorCobrar: 0 });
  assert.equal(await devengarComisionCobro({
    db: dbSinPct, empresaId: 1, vendedorId: 7, facturaId: 1, cobroId: 1,
    montoCobro: 100, importeTotalFactura: 115, totalIvaFactura: 15,
  }), null);

  const db = crearDb();
  assert.equal(await devengarComisionCobro({
    db, empresaId: 1, vendedorId: 7, facturaId: 1, cobroId: 1,
    montoCobro: 0, importeTotalFactura: 115, totalIvaFactura: 15,
  }), null);
});
