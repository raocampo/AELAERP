// ====================================
// RECONCILIAR COMPRAS HISTÓRICAS IMPORTADAS CONTRA EL EXCEL DE ORIGEN
// backend/scripts/reconciliarComprasHistoricas.js
//
// Después de convertir (convertirComprasHistoricasSRI.js) e importar un
// Excel de compras históricas, este script compara — mes por mes — los
// totales que quedaron en facturas_compra contra los totales reales del
// Excel de origen (agrupados por factura con la misma lógica robusta del
// conversor: clave de acceso > estab+ptoEmi+secuencial > fecha autorización
// > RUC+fecha). Solo lectura, no modifica nada.
//
// Motivo: un import histórico puede "verse bien" en el preview (89 filas,
// sin errores) pero terminar con el IVA mal calculado por un bug de fondo
// (ver corregirCorteIva15Abril2024.js) — el preview no garantiza que los
// totales por mes coincidan con el documento fuente. Este script sí lo
// verifica, con precisión de centavos, reutilizando el mismo parser que ya
// sabe leer los ~8 layouts distintos que trae el export crudo del SRI.
//
// Uso:
//   node scripts/reconciliarComprasHistoricas.js \
//     --excel="C:/ruta/Compras Cliente.xlsx" --empresa=4
//
// Requiere DATABASE_URL apuntando a la base del tenant correcto.
// Un delta de IVA/Total de más de ~$1-2 por mes NO es normal — investigar.
// Diferencias de un par de centavos por factura son redondeo esperado del SRI.
// ====================================

const XLSX = require('xlsx');
const { Client } = require('pg');

const excelArg = process.argv.find((a) => a.startsWith('--excel='));
const empresaArg = process.argv.find((a) => a.startsWith('--empresa='));
if (!excelArg || !empresaArg) {
  console.error('Uso: node scripts/reconciliarComprasHistoricas.js --excel="<archivo.xlsx>" --empresa=<id>');
  process.exit(1);
}
const excelPath = excelArg.split('=').slice(1).join('=');
const empresaId = parseInt(empresaArg.split('=')[1], 10);

// ─── Reutiliza el mismo parser robusto de convertirComprasHistoricasSRI.js ──
function normHeader(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
const ALIAS = {
  'no id emisor': 'rucEmisor', 'razon social emisor': 'razonSocialEmisor',
  'fecha emision': 'fechaEmision', 'fecha autorizacion': 'fechaAutorizacion',
  'autorizacion': 'autorizacion', 'establecimiento': 'estab', 'punto de emision': 'ptoEmi',
  'secuencial': 'secuencial', 'tipo de comprobante': 'tipoComprobante', 'descripcion': 'descripcion',
  'precio total sin impuesto': 'precioTotalSinImpuesto', 'tarifa iva': 'tarifaIva',
  'monto iva': 'montoIva', 'importe total': 'importeTotal',
};
function mapearFila(rawRow, headerMap) {
  const fila = {};
  for (const [idx, campo] of Object.entries(headerMap)) {
    if (campo) fila[campo] = rawRow[idx];
  }
  return fila;
}
function parsearFecha(valor) {
  if (!valor && valor !== 0) return null;
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d, 12)) : null;
  }
  const s = String(valor).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1], 12));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return null;
}
function parsearDecimal(v) {
  if (v === null || v === undefined || v === '') return 0;
  return parseFloat(String(v).replace(',', '.').trim()) || 0;
}
function normalizarRuc(v) { return String(v || '').trim().replace(/[^0-9]/g, ''); }
function parsearClaveAcceso(clave) {
  const s = String(clave || '').replace(/\s/g, '');
  if (!/^\d{49}$/.test(s)) return null;
  return { estab: s.slice(24, 27), ptoEmi: s.slice(27, 30), secuencial: s.slice(30, 39) };
}

// Algunas hojas de origen no traen columna de Fecha Emisión en absoluto (ej.
// "DIC 2023 COMPRAS") — mismo fallback que convertirComprasHistoricasSRI.js:
// inferir año/mes del nombre de la hoja y usar el día 1 para esas filas. Sin
// esto, una hoja sin columna de fecha desaparece entera del reporte en vez
// de aparecer con sus totales bajo el mes correcto.
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

// Agrupa TODAS las hojas del libro en facturas, sin importar a qué mes/hoja
// pertenecen — el mes real de cada factura se toma de su propia fecha (o del
// nombre de la hoja si la hoja no trae columna de fecha).
function leerYAgruparLibroCompleto(wb) {
  const grupos = new Map();
  for (const nombreHoja of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: '', raw: false });
    if (rows.length < 2) continue;
    const headerMap = rows[0].map((h) => ALIAS[normHeader(h)] || null);
    if (!headerMap.includes('rucEmisor')) continue; // hoja sin datos reconocibles (ej. resumen aparte)
    const { anio: anioHoja, mes: mesHoja } = inferirMesAnioDeHoja(nombreHoja);

    for (let i = 1; i < rows.length; i++) {
      const raw = rows[i];
      if (raw.every((c) => String(c).trim() === '')) continue;
      const f = mapearFila(raw, headerMap);
      if (f.tipoComprobante && normHeader(f.tipoComprobante) !== 'factura') continue;
      const rucEmisor = normalizarRuc(f.rucEmisor);
      if (!rucEmisor) continue;

      let fecha = parsearFecha(f.fechaEmision);
      if (!fecha) {
        if (!anioHoja || !mesHoja) continue; // no hay ni fecha en la fila ni forma de inferir el mes — se omite
        fecha = new Date(Date.UTC(anioHoja, mesHoja - 1, 1, 12));
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

      if (!grupos.has(key)) grupos.set(key, { fecha, base0: 0, baseGravado: 0, iva: 0 });
      const g = grupos.get(key);
      if (tarifa > 0) g.baseGravado += base; else g.base0 += base;
      g.iva += iva;
    }
  }
  return grupos;
}

function agruparPorMes(grupos) {
  const meses = new Map(); // 'YYYY-MM' -> {n, base0, baseGravado, iva}
  for (const g of grupos.values()) {
    const key = g.fecha.toISOString().slice(0, 7);
    if (!meses.has(key)) meses.set(key, { n: 0, base0: 0, baseGravado: 0, iva: 0 });
    const m = meses.get(key);
    m.n++; m.base0 += g.base0; m.baseGravado += g.baseGravado; m.iva += g.iva;
  }
  return meses;
}

async function totalesProduccion(c, empresaId, anio, mes) {
  const desde = new Date(Date.UTC(anio, mes - 1, 1));
  const hasta = new Date(Date.UTC(anio, mes, 1));
  const r = await c.query(
    `SELECT count(*) n, COALESCE(SUM(subtotal0),0) base0,
            COALESCE(SUM(subtotal5)+SUM(subtotal12)+SUM(subtotal15),0) "baseGravado",
            COALESCE(SUM("totalIva"),0) iva
     FROM facturas_compra
     WHERE "empresaId"=$1 AND "fechaEmision" >= $2 AND "fechaEmision" < $3 AND anulada=false`,
    [empresaId, desde, hasta]
  );
  const row = r.rows[0];
  return { n: Number(row.n), base0: Number(row.base0), baseGravado: Number(row.baseGravado), iva: Number(row.iva) };
}

async function main() {
  console.log(`Leyendo ${excelPath}...`);
  const wb = XLSX.readFile(excelPath);
  const grupos = leerYAgruparLibroCompleto(wb);
  const meses = agruparPorMes(grupos);
  console.log(`${grupos.size} factura(s) agrupada(s) en ${meses.size} mes(es).\n`);

  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const d = (a, b) => Math.round((a - b) * 100) / 100;
  console.log('Mes'.padEnd(10), 'n(excel/prod)'.padEnd(16), 'base0 Δ'.padEnd(10), 'baseGrav Δ'.padEnd(12), 'IVA Δ');
  let huboAlerta = false;
  for (const [mesKey, excel] of [...meses.entries()].sort()) {
    const [anio, mes] = mesKey.split('-').map(Number);
    const prod = await totalesProduccion(c, empresaId, anio, mes);
    const dBase0 = d(prod.base0, excel.base0), dGrav = d(prod.baseGravado, excel.baseGravado), dIva = d(prod.iva, excel.iva);
    const alerta = Math.abs(dIva) > 2 || Math.abs(dGrav) > 2 || Math.abs(dBase0) > 2;
    if (alerta) huboAlerta = true;
    console.log(
      mesKey.padEnd(10), `${excel.n}/${prod.n}`.padEnd(16),
      String(dBase0).padEnd(10), String(dGrav).padEnd(12), String(dIva) + (alerta ? ' ⚠' : '')
    );
  }

  console.log(huboAlerta
    ? '\n⚠ Hay mes(es) con diferencia mayor a $2 — revisar antes de dar por buena la importación.'
    : '\n✔ Todos los meses cuadran dentro de tolerancia de redondeo normal.');

  await c.end();
}

main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
