// ====================================
// IMPORTAR RETENCIONES RECIBIDAS DESDE EXCEL — LÍNEA DE COMANDOS
//
// Ahora que existe la pestaña "Importar" dentro de Retenciones Recibidas en
// la app (misma lógica, en backend/utils/importarRetencionesRecibidas.js),
// este script sigue sirviendo para cargas masivas fuera del navegador —
// por ejemplo, escribir directo contra una base que no sea la que tenga
// activo backend/.env en ese momento.
//
// Por defecto corre en modo DRY-RUN (no escribe nada, solo valida). Pasa
// --ejecutar para escribir de verdad.
//
// Uso:
//   node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId>              (dry-run)
//   node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId> --ejecutar    (escribe)
// ====================================

const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { leerExcel, validarFila, round2 } = require('../utils/importarRetencionesRecibidas');
const { crearAsientoRetencionRecibida } = require('../utils/contabilidad');

const [, , archivo, empresaIdArg, flag] = process.argv;
if (!archivo || !empresaIdArg) {
  console.error('Uso: node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId> [--ejecutar]');
  process.exit(1);
}
const empresaId = parseInt(empresaIdArg, 10);
const ejecutar = flag === '--ejecutar';

async function main() {
  const buffer = fs.readFileSync(archivo);
  const filas = leerExcel(buffer);
  console.log(`Leídas ${filas.length} filas de "${archivo}"\n`);

  const validadas = filas.map((raw, i) => ({ fila: i + 2, ...validarFila(raw) }));
  const validas = validadas.filter((v) => v.valida);
  const invalidas = validadas.filter((v) => !v.valida);

  if (invalidas.length > 0) {
    console.log(`⚠ ${invalidas.length} fila(s) con errores de validación:`);
    invalidas.forEach((v) => console.log(`  Fila ${v.fila}: ${v.errores.join('; ')}`));
    console.log();
  }

  const totalIva = round2(validas.reduce((s, v) => s + v.datos.totalRetencionIva, 0));
  const totalRenta = round2(validas.reduce((s, v) => s + v.datos.totalRetencionRenta, 0));
  console.log(`${validas.length} fila(s) válidas | Total Ret. IVA: $${totalIva.toFixed(2)} | Total Ret. Renta: $${totalRenta.toFixed(2)}\n`);

  if (!ejecutar) {
    console.log('Modo DRY-RUN — no se escribió nada. Revisa los datos arriba y vuelve a correr con --ejecutar para confirmar.');
    return;
  }

  const prisma = new PrismaClient();
  let creados = 0, omitidos = 0, fallidos = 0;
  try {
    for (const v of validas) {
      const existente = await prisma.retenciones_recibidas.findFirst({
        where: { empresaId, claveAcceso: v.datos.claveAcceso },
        select: { id: true },
      });
      if (existente) { omitidos++; continue; }

      try {
        let facturaId = null;
        if (v.datos.numDocSustento) {
          const f = await prisma.facturas.findFirst({
            where: { empresaId, numeroFactura: v.datos.numDocSustento },
            select: { id: true },
          });
          facturaId = f?.id || null;
        }

        const nueva = await prisma.retenciones_recibidas.create({
          data: { empresaId, facturaId, ...v.datos },
        });
        await crearAsientoRetencionRecibida({ retencionRecibidaId: nueva.id, usuarioId: null, fecha: v.datos.fechaEmision, db: prisma });
        creados++;
      } catch (err) {
        fallidos++;
        console.error(`  Fila ${v.fila} falló al crear: ${err.message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nListo — creados: ${creados}, ya existían: ${omitidos}, fallidos: ${fallidos}`);
}

main().catch((e) => { console.error('FALLO:', e); process.exit(1); });
