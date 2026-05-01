#!/usr/bin/env node
// ====================================
// SCRIPT: Importar catastro SRI desde CSVs oficiales
//
// Uso: node scripts/importarCatastroSRI.js [ruta-directorio-csvs]
//
// Si no se pasa ruta, usa los CSVs del directorio docs/ del proyecto.
//
// Los CSVs oficiales se descargan de:
//   https://srienlinea.sri.gob.ec/sri-en-linea/inicio/
//   Datos Abiertos → Catastro de Contribuyentes
//
// Formato: separados por | (pipe), encoding latin1
// ====================================

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const BATCH_SIZE = 2000; // registros por lote (createMany es mucho más eficiente que upserts individuales)

// Nombres de columnas en el CSV del SRI
const COL = {
  RUC:              'NUMERO_RUC',
  RAZON_SOCIAL:     'RAZON_SOCIAL',
  NOMBRE_COMERCIAL: 'NOMBRE_FANTASIA_COMERCIAL',
  ESTADO:           'ESTADO_CONTRIBUYENTE',
  CLASE:            'CLASE_CONTRIBUYENTE',
  TIPO:             'TIPO_CONTRIBUYENTE',
  OBLIGADO:         'OBLIGADO',
  PROVINCIA:        'DESCRIPCION_PROVINCIA_EST',
  CANTON:           'DESCRIPCION_CANTON_EST',
};

function parsearLinea(cols, indices) {
  const ruc = (cols[indices[COL.RUC]] || '').trim();
  if (!/^\d{13}$/.test(ruc)) return null;

  const obligadoRaw = (cols[indices[COL.OBLIGADO]] || '').trim().toUpperCase();

  return {
    ruc,
    razonSocial:          (cols[indices[COL.RAZON_SOCIAL]] || '').trim().toUpperCase() || 'SIN NOMBRE',
    nombreComercial:      (cols[indices[COL.NOMBRE_COMERCIAL]] || '').trim() || null,
    estado:               (cols[indices[COL.ESTADO]] || '').trim().toUpperCase() || null,
    claseContribuyente:   (cols[indices[COL.CLASE]] || '').trim() || null,
    tipoContribuyente:    (cols[indices[COL.TIPO]] || '').trim() || null,
    obligadoContabilidad: obligadoRaw === 'S' || obligadoRaw === 'SI' || obligadoRaw === 'Y',
    provincia:            (cols[indices[COL.PROVINCIA]] || '').trim() || null,
    canton:               (cols[indices[COL.CANTON]] || '').trim() || null,
  };
}

async function flushBatch(batch) {
  try {
    // createMany con skipDuplicates es mucho más rápido que upserts individuales
    const result = await prisma.contribuyentes_sri.createMany({
      data: batch,
      skipDuplicates: true,
    });
    return { insertados: result.count, errores: 0 };
  } catch (e) {
    // Si falla el batch entero, intentar uno a uno como fallback
    let insertados = 0;
    let errores = 0;
    for (const r of batch) {
      try {
        await prisma.contribuyentes_sri.upsert({
          where:  { ruc: r.ruc },
          create: r,
          update: {
            razonSocial:          r.razonSocial,
            nombreComercial:      r.nombreComercial,
            estado:               r.estado,
            claseContribuyente:   r.claseContribuyente,
            tipoContribuyente:    r.tipoContribuyente,
            obligadoContabilidad: r.obligadoContabilidad,
            provincia:            r.provincia,
            canton:               r.canton,
          },
        });
        insertados++;
      } catch { errores++; }
    }
    return { insertados, errores };
  }
}

async function importarArchivo(filePath) {
  console.log(`\nImportando: ${path.basename(filePath)}`);

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'latin1' }),
    crlfDelay: Infinity,
  });

  let indices  = null;
  let batch    = [];
  let total    = 0;
  let errores  = 0;
  let omitidos = 0;

  for await (const linea of rl) {
    if (!linea.trim()) continue;

    const cols = linea.split('|');

    // Primera fila = encabezados
    if (!indices) {
      indices = {};
      cols.forEach((h, i) => { indices[h.trim()] = i; });

      const faltantes = Object.values(COL).filter((c) => indices[c] === undefined);
      if (faltantes.length > 0) {
        console.error(`  ⚠  Columnas faltantes: ${faltantes.join(', ')}`);
        console.error(`  Encabezados: ${Object.keys(indices).join(' | ')}`);
        return { total: 0, errores: 1, omitidos: 0 };
      }
      continue;
    }

    const registro = parsearLinea(cols, indices);
    if (!registro) { omitidos++; continue; }

    batch.push(registro);

    if (batch.length >= BATCH_SIZE) {
      const r = await flushBatch(batch);
      total   += r.insertados;
      errores += r.errores;
      batch = [];
      process.stdout.write(`  ${total} registros procesados...\r`);
    }
  }

  if (batch.length > 0) {
    const r = await flushBatch(batch);
    total   += r.insertados;
    errores += r.errores;
  }

  console.log(`  ✓ ${total} insertados/actualizados, ${omitidos} omitidos (RUC inválido), ${errores} errores`);
  return { total, errores, omitidos };
}

async function main() {
  // Soporte para pasar archivos específicos O un directorio
  // Uso: node importarCatastroSRI.js <dir>
  // Uso: node importarCatastroSRI.js archivo1.csv archivo2.csv
  const args = process.argv.slice(2);
  let archivos = [];

  if (args.length === 0) {
    // Directorio por defecto
    const dir = path.join(__dirname, '../../../docs/datosRuc');
    if (!fs.existsSync(dir)) {
      console.error(`Directorio no encontrado: ${dir}`);
      console.error('Uso: node scripts/importarCatastroSRI.js <ruta-directorio-o-archivos.csv>');
      process.exit(1);
    }
    archivos = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .map((f) => path.join(dir, f))
      .sort();
  } else if (args.length === 1 && fs.statSync(args[0]).isDirectory()) {
    archivos = fs.readdirSync(args[0])
      .filter((f) => f.toLowerCase().endsWith('.csv'))
      .map((f) => path.join(args[0], f))
      .sort();
  } else {
    archivos = args.filter((a) => a.toLowerCase().endsWith('.csv'));
  }

  if (archivos.length === 0) {
    console.error('No se encontraron archivos .csv');
    process.exit(1);
  }

  console.log(`Archivos CSV a importar: ${archivos.length}`);
  archivos.forEach((f) => console.log(`  - ${path.basename(f)}`));

  let totalGlobal = 0;
  let erroresTotal = 0;

  for (const archivo of archivos) {
    const r = await importarArchivo(archivo);
    totalGlobal  += r.total;
    erroresTotal += r.errores;
  }

  const count = await prisma.contribuyentes_sri.count();
  console.log('\n========================================');
  console.log(`Total importado esta ejecución : ${totalGlobal.toLocaleString()}`);
  console.log(`Total en BD                    : ${count.toLocaleString()} contribuyentes`);
  if (erroresTotal > 0) console.log(`Errores                        : ${erroresTotal}`);
  console.log('========================================');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
