// ====================================
// BACKFILL: cobros CxC no-efectivo sin fila en Libro de Bancos
// backend/scripts/backfillMovimientosCobros.js
//
// Hasta 2026-11-10 el cobro de CxC con transferencia/cheque/tarjeta guardaba
// bancoId pero no creaba su movimiento en Libro de Bancos (ver
// crearAsientoCobroCliente en utils/contabilidad.js). Este script crea ese
// movimiento para los cobros ya registrados, ligado a su asiento existente.
// No modifica asientos: los antiguos quedaron contra la cuenta "Bancos"
// genérica (1.1.02.001); se listan para revisión contable.
//
// Conecta con DATABASE_URL (apuntar a la BD del tenant).
// Uso:
//   node scripts/backfillMovimientosCobros.js            -> diagnóstico (solo lectura)
//   node scripts/backfillMovimientosCobros.js --apply    -> crea los movimientos
// ====================================

const { PrismaClient } = require('@prisma/client');
const { registrarMovimientoBancarioLigado } = require('../utils/contabilidad');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const TIPO = { transferencia: 'TRANSFERENCIA_IN', tarjeta: 'TRANSFERENCIA_IN', cheque: 'DEPOSITO' };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  console.log(`Modo: ${APPLY ? 'APPLY (crea movimientos)' : 'DIAGNÓSTICO (solo lectura)'}`);
  const cobros = await prisma.cobros_cliente.findMany({
    where: { anulado: false, metodoPago: { not: 'efectivo' }, bancoId: { not: null }, movimientoBancarioId: null },
    include: { factura: { select: { numeroFactura: true } }, banco: { select: { nombre: true } } },
    orderBy: { fecha: 'asc' },
  });
  console.log(`Cobros sin movimiento bancario: ${cobros.length}`);

  let procesados = 0;
  for (const c of cobros) {
    const monto = round2(c.monto);
    // Cobro en ruta del vendedor: su movimiento ya existe con referencia = número.
    const previo = await prisma.movimientos_bancarios.findFirst({
      where: { empresaId: c.empresaId, bancoId: c.bancoId, referencia: c.numero, debe: monto, cobroCliente: { is: null } },
    });
    console.log(`  ${c.numero} ${c.fecha.toISOString().slice(0, 10)} $${monto.toFixed(2)} ${c.metodoPago} -> ${c.banco?.nombre}`
      + `${previo ? ` (enlazar mov. existente ${previo.id})` : ''}${c.asientoId ? '' : ' [sin asiento]'}`);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      const mov = previo || await registrarMovimientoBancarioLigado({
        bancoId: c.bancoId, empresaId: c.empresaId, fecha: c.fecha,
        tipo: TIPO[c.metodoPago] || 'TRANSFERENCIA_IN',
        concepto: `Cobro ${c.numero} factura ${c.factura.numeroFactura}`,
        referencia: c.referencia || c.numero, monto, esIngreso: true,
        asientoId: c.asientoId, chequeId: c.chequeId || null, db: tx,
      });
      await tx.cobros_cliente.update({ where: { id: c.id }, data: { movimientoBancarioId: mov.id } });
    });
    procesados++;
  }
  if (APPLY) console.log(`Movimientos creados/enlazados: ${procesados}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
