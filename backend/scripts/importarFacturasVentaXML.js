// ====================================
// IMPORTAR FACTURAS DE VENTA HISTÓRICAS DESDE UN ZIP DE XML AUTORIZADOS
//
// Alternativa a "Importar Históricas" por Excel (routes/facturas.js) para
// cuando el cliente ya tiene los XML de sus facturas emitidas a la mano
// (descargados de srienlinea.sri.gob.ec) — evita re-teclear cada factura.
// Reutiliza exactamente el mismo criterio de creación que el importador de
// históricas: estadoSri='AUTORIZADO' (o 'HISTORICO' si no hay autorización),
// origenRegistro='IMPORTACION', y genera el asiento contable con la fecha
// histórica real vía crearAsientoFacturaAutorizada — no pasa por la cola de
// firma/envío SRI (el XML ya viene autorizado).
//
// Por defecto corre en modo DRY-RUN. Pasa --ejecutar para escribir de
// verdad — usa el DATABASE_URL que tenga backend/.env en ese momento.
//
// Uso:
//   node scripts/importarFacturasVentaXML.js "<carpeta o .zip con los XML>" <empresaId>              (dry-run)
//   node scripts/importarFacturasVentaXML.js "<carpeta o .zip con los XML>" <empresaId> --ejecutar    (escribe)
// ====================================

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { PrismaClient } = require('@prisma/client');
const { parsearFacturaXML } = require('../utils/importarFacturasVentaXML');
const { crearAsientoFacturaAutorizada } = require('../utils/contabilidad');

const [, , origen, empresaIdArg, flag] = process.argv;
if (!origen || !empresaIdArg) {
  console.error('Uso: node scripts/importarFacturasVentaXML.js "<carpeta o .zip>" <empresaId> [--ejecutar]');
  process.exit(1);
}
const empresaId = parseInt(empresaIdArg, 10);
const ejecutar = flag === '--ejecutar';

function leerXMLs(origen) {
  const stat = fs.statSync(origen);
  const archivos = [];
  if (stat.isDirectory()) {
    for (const f of fs.readdirSync(origen)) {
      if (f.toLowerCase().endsWith('.xml')) archivos.push({ nombre: f, contenido: fs.readFileSync(path.join(origen, f), 'utf8') });
    }
  } else if (origen.toLowerCase().endsWith('.zip')) {
    const zip = new AdmZip(origen);
    for (const entry of zip.getEntries()) {
      if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.xml')) {
        archivos.push({ nombre: entry.entryName, contenido: entry.getData().toString('utf8') });
      }
    }
  } else {
    throw new Error('El origen debe ser una carpeta o un archivo .zip');
  }
  return archivos;
}

async function main() {
  const archivos = leerXMLs(origen);
  console.log(`Leídos ${archivos.length} archivo(s) XML de "${origen}"\n`);

  const validas = [];
  const invalidas = [];
  for (const a of archivos) {
    try {
      const datos = parsearFacturaXML(a.contenido);
      validas.push({ archivo: a.nombre, datos });
    } catch (err) {
      invalidas.push({ archivo: a.nombre, error: err.message });
    }
  }

  if (invalidas.length > 0) {
    console.log(`⚠ ${invalidas.length} archivo(s) no se pudieron parsear:`);
    invalidas.forEach((v) => console.log(`  ${v.archivo}: ${v.error}`));
    console.log();
  }

  const totalImporte = round2(validas.reduce((s, v) => s + v.datos.importeTotal, 0));
  console.log(`${validas.length} factura(s) válidas | Total: $${totalImporte.toFixed(2)}\n`);

  if (!ejecutar) {
    console.log('Modo DRY-RUN — no se escribió nada. Revisa los datos y vuelve a correr con --ejecutar para confirmar.');
    if (validas[0]) {
      console.log('Ejemplo de la primera factura que se crearía:');
      console.log(JSON.stringify({ ...validas[0].datos, detalles: `[${validas[0].datos.detalles.length} ítem(s)]` }, null, 2));
    }
    return;
  }

  const prisma = new PrismaClient();
  let creadas = 0, omitidas = 0, fallidas = 0;
  try {
    for (const v of validas) {
      const d = v.datos;
      const existente = await prisma.facturas.findUnique({ where: { claveAcceso: d.claveAcceso }, select: { id: true } });
      if (existente) { omitidas++; continue; }

      let cliente = null;
      try {
        cliente = await prisma.clientes.upsert({
          where: { empresaId_identificacion: { identificacion: d.identificacionComprador, empresaId } },
          update: {},
          create: {
            empresaId, identificacion: d.identificacionComprador, razonSocial: d.razonSocialComprador,
            tipoIdentificacion: d.tipoIdentificacionComprador,
          },
        });
      } catch { /* identificación no válida para clientes (ej. consumidor final genérico) — se deja sin vincular */ }

      try {
        const creada = await prisma.facturas.create({
          data: {
            empresaId, claveAcceso: d.claveAcceso, numeroFactura: d.numeroFactura, secuencial: d.secuencial,
            rucEmisor: d.rucEmisor, razonSocialEmisor: d.razonSocialEmisor,
            tipoIdentificacionComprador: d.tipoIdentificacionComprador,
            identificacionComprador: d.identificacionComprador, razonSocialComprador: d.razonSocialComprador,
            emailComprador: d.emailComprador, clienteId: cliente?.id || null,
            fechaEmision: d.fechaEmision,
            subtotal0: d.subtotal0, subtotal5: d.subtotal5, subtotal15: d.subtotal15,
            subtotalNoObjetoIva: d.subtotalNoObjetoIva, totalDescuento: d.totalDescuento,
            totalIva: d.totalIva, propina: d.propina, importeTotal: d.importeTotal,
            detalles: d.detalles, pagos: d.pagos,
            estadoSri: 'AUTORIZADO', numeroAutorizacion: d.numeroAutorizacion,
            origenRegistro: 'IMPORTACION',
          },
          select: { id: true },
        });
        await crearAsientoFacturaAutorizada({ facturaId: creada.id, usuarioId: null, fecha: d.fechaEmision, db: prisma });
        creadas++;
      } catch (err) {
        fallidas++;
        console.error(`  ${v.archivo} falló al crear: ${err.message}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nListo — creadas: ${creadas}, ya existían: ${omitidas}, fallidas: ${fallidas}`);
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

main().catch((e) => { console.error('FALLO:', e); process.exit(1); });
