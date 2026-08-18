// ====================================
// CORREGIR COMPRAS DEL BUZÓN SRI CON 5%/12%/NO OBJETO/EXENTO MAL CLASIFICADOS
// backend/scripts/corregirComprasNoObjetoExentoBuzon.js
//
// utils/importacionProductos.js (parsearFacturaCompraDesdeXml, usado por
// utils/buzon.js al importar compras del Buzón SRI) tenía una tabla de
// codigoPorcentaje incorrecta: el código real '4' (15%, tabla 17 ficha
// técnica SRI v2.26, ya verificado en utils/sri.js) se trataba como
// "No objeto"; no había código para "Exento" en absoluto; y el cálculo de
// totales solo tenía 2 baldes (subtotal0/subtotal15) — cualquier detalle a
// 5%, 12%, No Objeto o Exento quedaba mal clasificado, y buzon.js encima
// nunca pasaba subtotal12/subtotalNoObjeto/subtotalExento al crear el
// registro (se quedaban en 0 por default del schema). Corregido el mismo
// día en el propio parser — este script es SOLO para las compras que ya se
// importaron ANTES del fix, re-parseando su xmlOrigen guardado (ver
// docs/pendientes-2026-08-18.md).
//
// Reprocesa toda compra con origenRegistro='BUZON_SRI' y xmlOrigen no nulo:
// re-corre el parser YA CORREGIDO sobre el XML original guardado, compara
// contra lo que hay en la fila, y solo la toca si hay diferencia real.
//
// Uso:
//   node scripts/corregirComprasNoObjetoExentoBuzon.js --empresa=4              → solo diagnóstico
//   node scripts/corregirComprasNoObjetoExentoBuzon.js --empresa=4 --fix        → corrige + backup
//
// Después de --fix, si delta de totalIva != 0 en algún registro, revisar si
// esa compra ya generó un asiento contable (asientos_contables_detalle vía
// referencia = numeroFactura) — este script NO toca asientos, solo
// facturas_compra. Si hace falta regenerar el asiento, hacerlo a mano desde
// Contabilidad → Libro Diario → Corrección, usando el backup para saber qué
// factura cambió y en cuánto.
// ====================================

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { parsearFacturaCompraDesdeXml } = require('../utils/importacionProductos');

const FIX = process.argv.includes('--fix');
const empresaArg = process.argv.find((a) => a.startsWith('--empresa='));
const empresaId = empresaArg ? parseInt(empresaArg.split('=')[1], 10) : null;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CAMPOS = ['subtotal0', 'subtotal5', 'subtotal12', 'subtotal15', 'subtotalNoObjeto', 'subtotalExento', 'totalIva', 'importeTotal'];

async function main() {
  console.log(`Modo: ${FIX ? 'FIX (corrige datos, con backup previo)' : 'DIAGNÓSTICO (solo lectura)'}${empresaId ? ` — empresa ${empresaId}` : ' — TODAS las empresas'}`);

  const where = {
    origenRegistro: 'BUZON_SRI',
    xmlOrigen: { not: null },
    ...(empresaId ? { empresaId } : {}),
  };

  const filas = await prisma.facturas_compra.findMany({
    where,
    select: {
      id: true, empresaId: true, numeroFactura: true, fechaEmision: true, xmlOrigen: true,
      subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
      subtotalNoObjeto: true, subtotalExento: true, totalIva: true, importeTotal: true,
    },
  });
  console.log(`\n${filas.length} compra(s) del Buzón SRI con XML original guardado — re-parseando...`);

  const plan = [];
  let errores = 0;
  for (const f of filas) {
    let datos;
    try {
      datos = parsearFacturaCompraDesdeXml(f.xmlOrigen);
    } catch (e) {
      errores++;
      console.log(`  [facturas_compra#${f.id}] ${f.numeroFactura} — ERROR reparseando XML: ${e.message}`);
      continue;
    }
    const t = datos.totales;
    const nuevo = {
      subtotal0: round2(t.subtotal0), subtotal5: round2(t.subtotal5 || 0),
      subtotal12: round2(t.subtotal12 || 0), subtotal15: round2(t.subtotal15),
      subtotalNoObjeto: round2(t.subtotalNoObjeto || 0), subtotalExento: round2(t.subtotalExento || 0),
      totalIva: round2(t.totalIva), importeTotal: round2(t.importeTotal),
    };
    const viejo = Object.fromEntries(CAMPOS.map((c) => [c, round2(f[c])]));
    const cambia = CAMPOS.some((c) => Math.abs(nuevo[c] - viejo[c]) > 0.01);
    if (cambia) plan.push({ id: f.id, empresaId: f.empresaId, numeroFactura: f.numeroFactura, fechaEmision: f.fechaEmision, viejo, nuevo });
  }

  if (errores > 0) console.log(`\n⚠ ${errores} XML no se pudieron reparsear (revisar a mano).`);
  console.log(`\n${plan.length} compra(s) con diferencia real tras re-parsear (de ${filas.length} revisadas).`);

  for (const p of plan) {
    const diffs = CAMPOS.filter((c) => Math.abs(p.nuevo[c] - p.viejo[c]) > 0.01)
      .map((c) => `${c} ${p.viejo[c].toFixed(2)}→${p.nuevo[c].toFixed(2)}`).join(', ');
    console.log(`  [facturas_compra#${p.id}] empresa=${p.empresaId} ${p.numeroFactura} (${new Date(p.fechaEmision).toISOString().slice(0, 10)}) — ${diffs}`);
  }

  if (plan.length === 0) {
    await prisma.$disconnect();
    return;
  }

  if (!FIX) {
    console.log('\nEjecuta con --fix para aplicar la corrección (genera backup antes de tocar nada).');
    await prisma.$disconnect();
    return;
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const backupFile = `scripts/_backup_comprasNoObjetoExentoBuzon_${empresaId || 'todas'}_${fecha}.json`;
  fs.writeFileSync(backupFile, JSON.stringify(filas.filter((f) => plan.some((p) => p.id === f.id)), null, 2));
  console.log(`\nBackup guardado en ${backupFile} (${plan.length} registro(s), valores originales completos incluido xmlOrigen).`);

  let corregidos = 0;
  for (const p of plan) {
    await prisma.facturas_compra.update({ where: { id: p.id }, data: p.nuevo });
    corregidos++;
  }
  console.log(`\n✔ ${corregidos} compra(s) corregidas. Revisar manualmente si alguna ya tiene asiento contable que necesite regenerarse (ver comentario al inicio del script).`);

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
