// ====================================
// VERIFICAR / CORREGIR totalIva EN REGISTROS PRE-2024-04-22 (IVA 12% histórico)
// backend/scripts/verificarIvaHistorico.js
//
// La migración 20260715000000_subtotal12_iva_historico movió la base gravada
// de subtotal15 -> subtotal12 para fechaEmision < 2024-04-22, pero NO tocó el
// campo totalIva. Si un registro se cargó con la tarifa equivocada (15% en vez
// de 12%) -manual o import sin iva_porcentaje-, subtotal12 ya está correcto
// pero totalIva sigue con el valor viejo. Este script detecta (y opcionalmente
// corrige) esos casos.
//
// Uso:
//   node scripts/verificarIvaHistorico.js                 → solo diagnóstico
//   node scripts/verificarIvaHistorico.js --empresa=2      → filtra una empresa
//   node scripts/verificarIvaHistorico.js --fix            → corrige totalIva/importeTotal
//
// El --fix solo ajusta el campo totalIva (y importeTotal por el mismo delta).
// NO regenera asientos contables ya creados — si el registro tiene un asiento
// vinculado, el script lo señala para que se regenere manualmente desde la UI
// ("Regenerar asiento").
//
// IMPORTANTE: --fix solo corrige registros cuyo ratio actual/esperado cae en
// [1.20, 1.30] — el patrón exacto de "se cobró IVA al 15% sobre una base que
// en realidad es al 12%" (15/12 = 1.25). Registros con otro ratio (detectado
// en Puchaicela: ~0.917 y ~0.667 en asientos consolidados "H-YYMMDD-NN") NO
// se tocan — tienen otra causa raíz y requieren revisión manual de la
// contadora antes de decidir el valor correcto.
// ====================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const FIX = process.argv.includes('--fix');
const empresaArg = process.argv.find((a) => a.startsWith('--empresa='));
const empresaId = empresaArg ? parseInt(empresaArg.split('=')[1], 10) : null;
const CORTE = new Date('2024-04-22');
const TOLERANCIA = 0.02;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function esperado(row) {
  return round2(
    Number(row.subtotal5 || 0) * 0.05 +
    Number(row.subtotal12 || 0) * 0.12 +
    Number(row.subtotal15 || 0) * 0.15
  );
}

async function revisarTabla(nombre, tipoAsiento, prefijoReferencia, idField = 'id') {
  const where = {
    fechaEmision: { lt: CORTE },
    subtotal12: { gt: 0 },
    ...(empresaId ? { empresaId } : {}),
  };

  const filas = await prisma[nombre].findMany({ where });

  console.log(`\n=== ${nombre} — ${filas.length} registro(s) con subtotal12 > 0 antes de 2024-04-22 ===`);

  const mismatches = [];
  for (const f of filas) {
    const esp = esperado(f);
    const actual = round2(f.totalIva);
    const diff = round2(actual - esp);
    if (Math.abs(diff) > TOLERANCIA) {
      const ratio = esp !== 0 ? round2(actual / esp) : null;
      const confirmado = ratio !== null && ratio >= 1.20 && ratio <= 1.30;
      mismatches.push({ ...f, esperado: esp, actual, diff, ratio, confirmado });
    }
  }

  if (mismatches.length === 0) {
    console.log('  Sin discrepancias.');
    return { revisados: filas.length, corregidos: 0, pendientesRevisionManual: 0 };
  }

  let corregidos = 0;
  let revisionManual = 0;

  for (const m of mismatches) {
    const doc = m.numeroFactura || m.numeroLiquidacion || `id ${m.id}`;
    const etiqueta = m.confirmado ? '[15%→12% confirmado]' : '[⚠ REVISIÓN MANUAL — ratio no coincide con el bug conocido]';
    console.log(`  ${etiqueta} [${nombre}#${m.id}] ${doc} (${m.fechaEmision.toISOString().slice(0, 10)}) empresa=${m.empresaId} — totalIva=${m.actual} esperado=${m.esperado} (diff ${m.diff}, ratio ${m.ratio})`);

    let asiento = null;
    if (tipoAsiento) {
      asiento = await prisma.asientos_contables.findFirst({
        where: { empresaId: m.empresaId, tipo: tipoAsiento, referencia: `${prefijoReferencia}${m.id}` },
        select: { id: true, numero: true },
      });
      if (asiento) console.log(`      ⚠ tiene asiento contable ${asiento.numero} (id ${asiento.id}) — regenerar manualmente tras el fix`);
    }

    if (!m.confirmado) {
      revisionManual++;
      continue;
    }

    if (FIX) {
      const deltaIva = round2(m.esperado - m.actual);
      const nuevoImporte = round2(Number(m.importeTotal) + deltaIva);
      await prisma[nombre].update({
        where: { id: m.id },
        data: { totalIva: m.esperado, importeTotal: nuevoImporte },
      });
      corregidos++;
      console.log(`      ✔ corregido: totalIva ${m.actual} → ${m.esperado}, importeTotal ${m.importeTotal} → ${nuevoImporte}`);
    }
  }

  return {
    revisados: filas.length,
    corregidos,
    pendientes: !FIX ? mismatches.filter((m) => m.confirmado).length : 0,
    pendientesRevisionManual: revisionManual,
  };
}

async function main() {
  console.log(`Modo: ${FIX ? 'FIX (corrige datos)' : 'DIAGNÓSTICO (solo lectura)'}${empresaId ? ` — empresa ${empresaId}` : ' — todas las empresas'}`);

  const r1 = await revisarTabla('facturas', 'FACTURA', 'FAC-');
  const r2 = await revisarTabla('facturas_compra', 'COMPRA', 'COMP-');
  const r3 = await revisarTabla('liquidaciones_compra', 'COMPRA', 'LIQ-');

  console.log('\n=== Resumen ===');
  console.log('facturas:', r1);
  console.log('facturas_compra:', r2);
  console.log('liquidaciones_compra:', r3);

  if (!FIX && (r1.pendientes || r2.pendientes || r3.pendientes)) {
    console.log('\nEjecuta con --fix para corregir totalIva/importeTotal en los registros listados.');
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
