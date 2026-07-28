// ====================================
// CORREGIR CORTE INCORRECTO DE LA TARIFA IVA 12%→15% (abril 2024)
// backend/scripts/corregirCorteIva15Abril2024.js
//
// La migración `20260715000000_subtotal12_iva_historico` (applySchemaFixes.js)
// reclasificó subtotal15 -> subtotal12 para fechaEmision < '2024-04-22',
// asumiendo que la tarifa 15% empezó a regir en esa fecha. El corte real es
// '2024-04-01' (confirmado en backend/utils/sri.js:96 — "15% tarifa vigente
// desde abr 2024" — y verificado empíricamente contra el export real del SRI
// del cliente Puchaicela: cero líneas al 12% en todo abril-2024). Esto dejó
// 3 semanas (01 al 21 de abril de 2024) mal clasificadas al 12% en vez de
// 15%, y el fix posterior (verificarIvaHistorico.js --fix, sesión 2026-07-15)
// "confirmó" y horneó el totalIva incorrecto al 12% para esos registros,
// porque su ratio 15/12=1.25 coincidía con el patrón del bug ya conocido.
//
// Este script SOLO corrige facturas_compra con fechaEmision en
// [2024-04-01, 2024-04-22) y subtotal12 > 0 — devuelve la base a subtotal15
// y recalcula totalIva/importeTotal al 15%. NO toca asientos contables (usar
// después scripts/regenerarAsientosCompraIva12.js con el backup generado).
//
// Uso:
//   node scripts/corregirCorteIva15Abril2024.js --empresa=4              → solo diagnóstico
//   node scripts/corregirCorteIva15Abril2024.js --empresa=4 --fix        → corrige + backup
// ====================================

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIX = process.argv.includes('--fix');
const empresaArg = process.argv.find((a) => a.startsWith('--empresa='));
const empresaId = empresaArg ? parseInt(empresaArg.split('=')[1], 10) : null;

const DESDE = new Date('2024-04-01T00:00:00.000Z');
const HASTA = new Date('2024-04-22T00:00:00.000Z'); // exclusivo

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function main() {
  console.log(`Modo: ${FIX ? 'FIX (corrige datos, con backup previo)' : 'DIAGNÓSTICO (solo lectura)'}${empresaId ? ` — empresa ${empresaId}` : ' — todas las empresas'}`);

  const where = {
    fechaEmision: { gte: DESDE, lt: HASTA },
    subtotal12: { gt: 0 },
    ...(empresaId ? { empresaId } : {}),
  };

  const filas = await prisma.facturas_compra.findMany({
    where,
    select: {
      id: true, empresaId: true, numeroFactura: true, fechaEmision: true,
      subtotal12: true, subtotal15: true, totalIva: true, importeTotal: true,
    },
  });
  console.log(`\n${filas.length} factura(s) de compra con subtotal12 > 0 entre 2024-04-01 y 2024-04-21 (deberían ser subtotal15).`);

  if (filas.length === 0) {
    await prisma.$disconnect();
    return;
  }

  let totalDeltaIva = 0;
  const plan = filas.map((f) => {
    const nuevoIva = round2(Number(f.subtotal12) * 0.15);
    const deltaIva = round2(nuevoIva - Number(f.totalIva));
    totalDeltaIva += deltaIva;
    return {
      id: f.id, empresaId: f.empresaId, numeroFactura: f.numeroFactura,
      fechaEmision: f.fechaEmision,
      baseMovida: Number(f.subtotal12),
      ivaViejo: Number(f.totalIva), ivaNuevo: nuevoIva, deltaIva,
      importeTotalViejo: Number(f.importeTotal), importeTotalNuevo: round2(Number(f.importeTotal) + deltaIva),
    };
  });

  for (const p of plan) {
    console.log(`  [facturas_compra#${p.id}] empresa=${p.empresaId} ${p.numeroFactura} (${p.fechaEmision.toISOString().slice(0, 10)}) — base $${p.baseMovida.toFixed(2)} — IVA ${p.ivaViejo.toFixed(2)}→${p.ivaNuevo.toFixed(2)} (+${p.deltaIva.toFixed(2)})`);
  }
  console.log(`\nDelta total de IVA a corregir: +$${totalDeltaIva.toFixed(2)}`);

  if (!FIX) {
    console.log('\nEjecuta con --fix para aplicar la corrección (genera backup antes de tocar nada).');
    await prisma.$disconnect();
    return;
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const backupFile = `scripts/_backup_corteIva15Abril2024_${empresaId || 'todas'}_${fecha}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(filas, null, 2));
  console.log(`\nBackup guardado en ${backupFile} (${filas.length} registros, valores originales completos).`);

  let corregidos = 0;
  for (const p of plan) {
    await prisma.facturas_compra.update({
      where: { id: p.id },
      data: {
        subtotal15: { increment: p.baseMovida },
        subtotal12: { decrement: p.baseMovida },
        totalIva: p.ivaNuevo,
        importeTotal: p.importeTotalNuevo,
      },
    });
    corregidos++;
  }
  console.log(`\n✔ ${corregidos} factura(s) de compra corregidas.`);

  // Backup en el mismo formato que espera regenerarAsientosCompraIva12.js
  const backupParaAsientos = `scripts/_backup_totalIva_corteAbril2024_${empresaId || 'todas'}_${fecha}.json`;
  fs.writeFileSync(backupParaAsientos, JSON.stringify(plan.map((p) => ({ id: p.id })), null, 2));
  console.log(`Lista de IDs para regenerar asientos guardada en ${backupParaAsientos}.`);
  console.log(`\nSiguiente paso: node scripts/regenerarAsientosCompraIva12.js --backup=${backupParaAsientos}${empresaId ? ` --empresa=${empresaId}` : ''}`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
