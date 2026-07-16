// ====================================
// REGENERAR ASIENTOS DE COMPRA TRAS FIX DE totalIva (IVA 12% histórico)
// backend/scripts/regenerarAsientosCompraIva12.js
//
// verificarIvaHistorico.js --fix corrigió el campo totalIva/importeTotal de
// facturas_compra, pero los asientos contables ya generados con el valor
// viejo (15%) siguen intactos hasta que se regeneran. Este script reproduce
// exactamente lo que hace POST /api/compras/:id/regenerar-asiento (borra el
// asiento COMPRA existente y sus líneas, y crea uno nuevo con los valores ya
// corregidos), pero en lote sobre la lista de compras del backup.
//
// Uso:
//   node scripts/regenerarAsientosCompraIva12.js --backup=scripts/_backup_totalIva_facturas_compra_2026-07-15.json --empresa=4
//
// Respeta los mismos guards que el endpoint: no toca asientos en período
// cerrado ni bloqueado — los reporta para acción manual.
// ====================================

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { crearAsientoFacturaCompraRegistrada } = require('../utils/contabilidad');
const prisma = new PrismaClient();

const backupArg = process.argv.find((a) => a.startsWith('--backup='));
const empresaArg = process.argv.find((a) => a.startsWith('--empresa='));
if (!backupArg) { console.error('Falta --backup=<archivo.json>'); process.exit(1); }
const empresaId = empresaArg ? parseInt(empresaArg.split('=')[1], 10) : null;

async function main() {
  const backup = JSON.parse(fs.readFileSync(backupArg.split('=')[1], 'utf8'));
  console.log(`Regenerando asientos para ${backup.length} compra(s) del backup...`);

  const resultado = { regenerados: 0, creados: 0, sinAsientoPrevio: 0, omitidos: [] };

  for (const b of backup) {
    const compra = await prisma.facturas_compra.findUnique({ where: { id: b.id } });
    if (!compra) { resultado.omitidos.push({ id: b.id, motivo: 'compra no encontrada' }); continue; }
    if (empresaId && compra.empresaId !== empresaId) continue;
    if (compra.anulada) { resultado.omitidos.push({ id: b.id, motivo: 'compra anulada' }); continue; }

    const asientoExistente = await prisma.asientos_contables.findFirst({
      where: { empresaId: compra.empresaId, tipo: 'COMPRA', referencia: `COMP-${compra.id}` },
      select: { id: true, numero: true, cerrado: true, bloqueado: true },
    });

    if (asientoExistente) {
      if (asientoExistente.cerrado) { resultado.omitidos.push({ id: b.id, asiento: asientoExistente.numero, motivo: 'período cerrado' }); continue; }
      if (asientoExistente.bloqueado) { resultado.omitidos.push({ id: b.id, asiento: asientoExistente.numero, motivo: 'asiento bloqueado' }); continue; }

      await prisma.$transaction(async (tx) => {
        await tx.asientos_contables_detalle.deleteMany({ where: { asientoId: asientoExistente.id } });
        await tx.asientos_contables.delete({ where: { id: asientoExistente.id } });
      });
      resultado.regenerados++;
    } else {
      resultado.sinAsientoPrevio++;
    }

    const r = await crearAsientoFacturaCompraRegistrada({
      compraId: compra.id,
      usuarioId: null,
      fecha: compra.fechaEmision || new Date(),
      db: prisma,
    });
    if (r.creado === false && !asientoExistente) resultado.creados++;
  }

  console.log('\n=== Resumen ===');
  console.log('Asientos regenerados (borrados y recreados):', resultado.regenerados);
  console.log('Sin asiento previo (no requerían regenerar):', resultado.sinAsientoPrevio);
  console.log('Omitidos (requieren acción manual):', resultado.omitidos.length);
  if (resultado.omitidos.length) console.log(JSON.stringify(resultado.omitidos, null, 2));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
