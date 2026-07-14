// ====================================
// CONVERTIR EXPORTACIÓN CRUDA DEL SRI (línea por línea, multi-hoja) A LA
// PLANTILLA DE "IMPORTAR COMPRAS HISTÓRICAS" DE AELA
//
// Uso:
//   node scripts/convertirComprasHistoricasSRI.js "<archivo_origen.xlsx>" "<carpeta_salida>"
//
// El archivo origen es el típico export de "Comprobantes Recibidos" del SRI:
// una hoja por mes, una fila por LÍNEA DE ÍTEM (no por factura), sin columnas
// fijas — el layout cambia de hoja en hoja según cuándo se exportó. Este
// script:
//   1. Normaliza encabezados (acepta variantes de puntuación/mayúsculas).
//   2. Agrupa líneas en facturas (por clave de acceso si existe, si no por
//      establecimiento+ptoEmi+secuencial, si no por emisor+fecha autorización,
//      si no por emisor+fecha emisión — en ese orden de confianza).
//   3. Calcula subtotal 0% / subtotal gravado / IVA / total por factura.
//   4. Escribe un archivo por hoja de origen, con las columnas EXACTAS que
//      espera "Importar Compras Históricas" (generarPlantillaCompras en
//      utils/importarComprasHistoricas.js) — listo para subir por el asistente
//      ya existente en la app (que valida/preview antes de ejecutar).
//
// No escribe nada en la base de datos — solo genera archivos .xlsx para que
// el flujo de importación ya construido (con su propio preview) se encargue.
// ====================================

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const [, , archivoOrigen, carpetaSalida] = process.argv;
if (!archivoOrigen || !carpetaSalida) {
  console.error('Uso: node scripts/convertirComprasHistoricasSRI.js "<archivo_origen.xlsx>" "<carpeta_salida>"');
  process.exit(1);
}

// ─── Normalización de encabezados ──────────────────────────────────────────
function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// clave normalizada → campo canónico
const ALIAS = {
  'no id emisor': 'rucEmisor',
  'razon social emisor': 'razonSocialEmisor',
  'fecha emision': 'fechaEmision',
  'fecha autorizacion': 'fechaAutorizacion',
  'autorizacion': 'autorizacion',
  'establecimiento': 'estab',
  'punto de emision': 'ptoEmi',
  'secuencial': 'secuencial',
  'tipo de comprobante': 'tipoComprobante',
  'descripcion': 'descripcion',
  'precio total sin impuesto': 'precioTotalSinImpuesto',
  'tarifa iva': 'tarifaIva',
  'monto iva': 'montoIva',
  'importe total': 'importeTotal',
};

function mapearFila(rawRow, headerMap) {
  const fila = {};
  for (const [idx, campo] of Object.entries(headerMap)) {
    if (!campo) continue;
    fila[campo] = rawRow[idx];
  }
  return fila;
}

// ─── Parseo de fechas (varios formatos vistos en el archivo real) ─────────
function parsearFecha(valor) {
  if (!valor && valor !== 0) return null;
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d, 12));
    return null;
  }
  const s = String(valor).trim();
  // DD/MM/AAAA
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  // ISO con hora, ej 2023-06-04T09:39:59-05:00
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`);
  // AAAA-MM-DD
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return null;
}

function parsearDecimal(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(',', '.').trim()) || 0;
}

// Deriva mes/año de nombres de hoja como "DIC 2023 COMPRAS", "FEB 2025",
// "septiembre 2023", "MARZO 2024 COMP" — usado como fecha de respaldo cuando
// la hoja no trae columna de Fecha Emisión.
const MESES = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, septi: 9, septiembre: 9, oct: 10, octubre: 10, nov: 11, noviembre: 11,
  dic: 12, diciembre: 12,
};
function inferirMesAnioDeHoja(nombreHoja) {
  const norm = normHeader(nombreHoja);
  const anioMatch = norm.match(/(20\d{2})/);
  const anio = anioMatch ? parseInt(anioMatch[1], 10) : null;
  let mes = null;
  for (const [alias, num] of Object.entries(MESES)) {
    if (norm.includes(alias)) { mes = num; break; }
  }
  return { anio, mes };
}

// Extrae estab/ptoEmi/secuencial de una clave de acceso de 49 dígitos
// (mismo layout que utils/sri.js#generarClaveAcceso).
function parsearClaveAcceso(clave) {
  const s = String(clave || '').replace(/\s/g, '');
  if (!/^\d{49}$/.test(s)) return null;
  return { estab: s.slice(24, 27), ptoEmi: s.slice(27, 30), secuencial: s.slice(30, 39) };
}

function normalizarRuc(v) {
  return String(v || '').trim().replace(/[^0-9]/g, '');
}

// ─── Procesar una hoja ──────────────────────────────────────────────────────
function procesarHoja(nombreHoja, ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (rows.length < 2) return { facturas: [], avisos: ['Hoja vacía'], filasLeidas: 0 };

  const headerMap = rows[0].map((h) => ALIAS[normHeader(h)] || null);
  const { anio: anioHoja, mes: mesHoja } = inferirMesAnioDeHoja(nombreHoja);
  const avisos = [];
  let sinFechaColumna = false;

  const grupos = new Map(); // key -> acumulador

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i];
    if (raw.every((c) => String(c).trim() === '')) continue; // fila vacía
    const f = mapearFila(raw, headerMap);

    if (f.tipoComprobante && normHeader(f.tipoComprobante) !== 'factura') continue; // NC/otros, no es compra

    const rucEmisor = normalizarRuc(f.rucEmisor);
    if (!rucEmisor) continue; // fila basura / totales

    let fecha = parsearFecha(f.fechaEmision);
    if (!fecha) {
      sinFechaColumna = true;
      fecha = anioHoja && mesHoja ? new Date(Date.UTC(anioHoja, mesHoja - 1, 1, 12)) : new Date();
    }
    const fechaAut = parsearFecha(f.fechaAutorizacion);

    const claveInfo = parsearClaveAcceso(f.autorizacion);

    let key;
    if (claveInfo) key = `AUT:${f.autorizacion}`;
    else if (f.estab && f.ptoEmi && f.secuencial) key = `NUM:${rucEmisor}-${f.estab}-${f.ptoEmi}-${f.secuencial}`;
    else if (fechaAut) key = `FA:${rucEmisor}|${fechaAut.toISOString()}`;
    else key = `FE:${rucEmisor}|${fecha.toISOString().slice(0, 10)}`;

    const tarifa = parsearDecimal(f.tarifaIva);
    const base = parsearDecimal(f.precioTotalSinImpuesto);
    const iva = parsearDecimal(f.montoIva);
    const total = parsearDecimal(f.importeTotal) || (base + iva);

    if (!grupos.has(key)) {
      grupos.set(key, {
        rucEmisor, razonSocialEmisor: String(f.razonSocialEmisor || '').trim(),
        fecha, autorizacion: claveInfo ? String(f.autorizacion).replace(/\s/g, '') : null,
        estabPtoSec: claveInfo || (f.estab && f.ptoEmi && f.secuencial ? { estab: f.estab, ptoEmi: f.ptoEmi, secuencial: f.secuencial } : null),
        subtotal0: 0, subtotalGravado: 0, ivaTotal: 0, importeTotal: 0,
        descripciones: [], lineas: 0,
      });
    }
    const g = grupos.get(key);
    if (tarifa > 0) g.subtotalGravado += base; else g.subtotal0 += base;
    g.ivaTotal += iva;
    g.importeTotal += total;
    g.lineas++;
    const desc = String(f.descripcion || '').trim();
    if (desc && g.descripciones.length < 3 && !g.descripciones.includes(desc)) g.descripciones.push(desc);
  }

  if (sinFechaColumna) {
    avisos.push(`Esta hoja no tiene columna de Fecha Emisión — se usó el día 1 de ${mesHoja}/${anioHoja} como fecha para todas sus facturas (revisar si importa la fecha exacta).`);
  }

  // Numerar facturas sintéticas por RUC+fecha cuando no hay número real
  const contadorSintetico = new Map();
  const facturas = [];
  for (const g of grupos.values()) {
    let numeroFactura;
    if (g.estabPtoSec) {
      numeroFactura = `${String(g.estabPtoSec.estab).padStart(3, '0')}-${String(g.estabPtoSec.ptoEmi).padStart(3, '0')}-${String(g.estabPtoSec.secuencial).padStart(9, '0')}`;
    } else {
      const fkey = `${g.rucEmisor}|${g.fecha.toISOString().slice(0, 10)}`;
      const n = (contadorSintetico.get(fkey) || 0) + 1;
      contadorSintetico.set(fkey, n);
      numeroFactura = `H-${g.fecha.toISOString().slice(2, 10).replace(/-/g, '')}-${String(n).padStart(2, '0')}`;
    }

    facturas.push({
      fecha_emision: g.fecha.toISOString().slice(0, 10),
      tipo_id: g.rucEmisor.length === 13 ? 'RUC' : g.rucEmisor.length === 10 ? 'CEDULA' : 'PASAPORTE',
      identificacion: g.rucEmisor,
      razon_social: g.razonSocialEmisor || 'SIN NOMBRE',
      numero_factura: numeroFactura,
      descripcion: (g.descripciones.join(' / ') || 'Compra / gasto varios').slice(0, 300),
      subtotal_sin_iva: round2(g.subtotal0),
      subtotal_con_iva: round2(g.subtotalGravado),
      iva_porcentaje: g.subtotalGravado > 0 ? round2((g.ivaTotal / g.subtotalGravado) * 100) : 0,
      iva_total: round2(g.ivaTotal),
      forma_pago: 'EFECTIVO',
      tipo_gasto: '',
      numero_autorizacion: g.autorizacion || '',
      observaciones: `Importado de "${nombreHoja}" (${g.lineas} línea(s))`,
    });
  }

  facturas.sort((a, b) => a.fecha_emision.localeCompare(b.fecha_emision));
  return { facturas, avisos, filasLeidas: rows.length - 1 };
}

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ─── Escribir plantilla de salida (mismas columnas que generarPlantillaCompras) ───
const ENCABEZADOS = [
  'fecha_emision', 'tipo_id', 'identificacion', 'razon_social', 'numero_factura',
  'descripcion', 'subtotal_sin_iva', 'subtotal_con_iva', 'iva_porcentaje', 'iva_total',
  'forma_pago', 'tipo_gasto', 'numero_autorizacion', 'observaciones',
];

function escribirPlantilla(facturas, rutaSalida) {
  const filas = facturas.map((f) => ENCABEZADOS.map((c) => f[c]));
  const ws = XLSX.utils.aoa_to_sheet([ENCABEZADOS, ...filas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');
  XLSX.writeFile(wb, rutaSalida);
}

// ─── Main ───────────────────────────────────────────────────────────────────
function main() {
  const wb = XLSX.readFile(archivoOrigen);
  fs.mkdirSync(carpetaSalida, { recursive: true });

  let totalFacturas = 0, totalImporte = 0, totalLineas = 0;
  const resumen = [];

  for (const nombreHoja of wb.SheetNames) {
    const { facturas, avisos, filasLeidas } = procesarHoja(nombreHoja, wb.Sheets[nombreHoja]);
    if (facturas.length === 0) {
      resumen.push({ hoja: nombreHoja, filasLeidas, facturas: 0, importe: 0, avisos });
      continue;
    }
    const importe = round2(facturas.reduce((s, f) => s + f.subtotal_sin_iva + f.subtotal_con_iva + f.iva_total, 0));
    const nombreArchivo = `plantilla-compras-${nombreHoja.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}.xlsx`;
    escribirPlantilla(facturas, path.join(carpetaSalida, nombreArchivo));

    totalFacturas += facturas.length;
    totalImporte += importe;
    totalLineas += filasLeidas;
    resumen.push({ hoja: nombreHoja, filasLeidas, facturas: facturas.length, importe, avisos, archivo: nombreArchivo });
  }

  console.log('\n=== RESUMEN DE CONVERSIÓN ===\n');
  for (const r of resumen) {
    console.log(`${r.hoja.padEnd(24)} | ${String(r.filasLeidas).padStart(5)} líneas → ${String(r.facturas).padStart(4)} facturas | $${r.importe.toFixed(2).padStart(12)} | ${r.archivo || '(sin datos)'}`);
    r.avisos.forEach((a) => console.log(`   ⚠ ${a}`));
  }
  console.log(`\nTOTAL: ${totalLineas} líneas leídas → ${totalFacturas} facturas agrupadas, $${totalImporte.toFixed(2)}`);
  console.log(`\nArchivos escritos en: ${carpetaSalida}`);
  console.log('Súbelos uno por uno en AELA → Compras → Importar históricas (cada uno ya trae menos de 1000 filas).');
}

main();
