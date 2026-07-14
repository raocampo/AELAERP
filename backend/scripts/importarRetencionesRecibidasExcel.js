// ====================================
// IMPORTAR RETENCIONES RECIBIDAS DESDE EL EXCEL "LISTADO DE RETENCIONES" DEL SRI
//
// El sistema hoy solo carga retenciones_recibidas parseando XML del Buzón
// SRI (utils/buzon.js) — no existe una vía de Excel. Este script cubre el
// caso de contabilidad atrasada: el Excel "LISTADO RETENCIONES ..." ya trae
// una fila = un comprobante real (con clave de acceso, secuencial, documento
// sustento), así que se mapea 1:1 contra retenciones_recibidas usando la
// MISMA función de asiento contable que usa el Buzón SRI (no se reinventa).
//
// Por defecto corre en modo DRY-RUN (no escribe nada, solo valida y muestra
// qué crearía). Pasa --ejecutar para escribir de verdad — usa el
// DATABASE_URL que tenga backend/.env en ese momento, así que confirma antes
// contra qué base vas a correrlo (local de prueba vs producción).
//
// Uso:
//   node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId>              (dry-run)
//   node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId> --ejecutar    (escribe)
// ====================================

const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');
const { crearAsientoRetencionRecibida, round2 } = require('../utils/contabilidad');

const [, , archivo, empresaIdArg, flag] = process.argv;
if (!archivo || !empresaIdArg) {
  console.error('Uso: node scripts/importarRetencionesRecibidasExcel.js "<archivo.xlsx>" <empresaId> [--ejecutar]');
  process.exit(1);
}
const empresaId = parseInt(empresaIdArg, 10);
const ejecutar = flag === '--ejecutar';

function parsearFecha(valor) {
  if (!valor) return null;
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d, 12)) : null;
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  return null;
}
function parsearDecimal(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(',', '.').trim()) || 0;
}

function leerFilas(archivo) {
  const wb = XLSX.readFile(archivo);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
}

function validarFila(raw, numFila) {
  const errores = [];
  const clave = String(raw['Autorización'] || '').replace(/\s/g, '');
  if (!/^\d{49}$/.test(clave)) errores.push(`Autorización inválida (debe tener 49 dígitos): "${clave}"`);

  const rucAgente = String(raw['No. Id Age. Ret.'] || '').trim();
  if (!rucAgente) errores.push('No. Id Age. Ret. (RUC del agente de retención) es requerido');

  const razonSocialAgente = String(raw['Raz. Social Ag. Retención'] || '').trim();
  if (!razonSocialAgente) errores.push('Raz. Social Ag. Retención es requerida');

  const fechaEmision = parsearFecha(raw['Fecha Emisión']);
  if (!fechaEmision) errores.push(`Fecha Emisión inválida: "${raw['Fecha Emisión']}"`);

  const fechaAutorizacion = parsearFecha(raw['Fecha Autorización']) || fechaEmision;

  const baseRenta  = parsearDecimal(raw['Base Ret. Renta #1']);
  const pctRenta    = parsearDecimal(raw['Porcentaje Ret. Renta #1']);
  const valorRenta = parsearDecimal(raw['Valor Ret. Renta #1']);
  const baseIva    = parsearDecimal(raw['Base Ret. IVA #1']);
  const pctIva      = parsearDecimal(raw['Porcentaje Ret. IVA #1']);
  const valorIva   = parsearDecimal(raw['Valor Ret. IVA #1']);

  if (valorRenta === 0 && valorIva === 0) {
    errores.push('No tiene ni Valor Ret. Renta #1 ni Valor Ret. IVA #1 (fila sin monto)');
  }

  const numDocSustento = String(raw['Documento Sustento'] || '').trim() || null;
  const fechaDocSustento = parsearFecha(raw['Fecha Emi. Sustento']);

  const detalles = [];
  if (valorRenta !== 0 || baseRenta !== 0) {
    detalles.push({
      codigo: '1', codigoRetencion: String(raw['Cod. Ret. Renta #1'] || '').trim() || null,
      porcentajeRetener: pctRenta, valorRetener: valorRenta, baseImponible: baseRenta,
      numDocSustento, fechaEmisionDocSustento: fechaDocSustento,
    });
  }
  if (valorIva !== 0 || baseIva !== 0) {
    detalles.push({
      codigo: '2', codigoRetencion: null,
      porcentajeRetener: pctIva, valorRetener: valorIva, baseImponible: baseIva,
      numDocSustento, fechaEmisionDocSustento: fechaDocSustento,
    });
  }

  return {
    valida: errores.length === 0,
    errores,
    fila: numFila,
    datos: {
      claveAcceso: clave,
      numeroAutorizacion: clave,
      fechaAutorizacion,
      rucAgente,
      razonSocialAgente,
      fechaEmision,
      numDocSustento,
      totalRetencionIva: round2(valorIva),
      totalRetencionRenta: round2(valorRenta),
      detalles,
    },
  };
}

async function main() {
  const filas = leerFilas(archivo);
  console.log(`Leídas ${filas.length} filas de "${archivo}"\n`);

  const validadas = filas.map((raw, i) => validarFila(raw, i + 2));
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
    console.log('Ejemplo de la primera fila válida que se crearía:');
    console.log(JSON.stringify(validas[0]?.datos, null, 2));
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
