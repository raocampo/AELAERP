/**
 * importarAsientosPuchaicela.js
 *
 * Crea empresa Daniel Puchaicela, plan de cuentas mínimo (basado en
 * ASIENTO TIPO), periodos contables 2023-2025, y los asientos históricos:
 *   - COMPRAS: un asiento mensual agregado por hoja del Excel (23 meses)
 *   - VENTAS: un asiento por factura emitida (35 XMLs), con retenciones recibidas
 *
 * Uso: node scripts/importarAsientosPuchaicela.js
 */
'use strict';

const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

// ─── Datos pre-extraídos ──────────────────────────────────────────────────────
const comprasData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_compras_puchaicela.json'), 'utf8')
);
const ventasData = JSON.parse(
  fs.readFileSync(path.join(__dirname, '_ventas_puchaicela.json'), 'utf8')
);

// ─── Plan de cuentas basado en ASIENTO TIPO ───────────────────────────────────
// Estructura: [codigo, nombre, tipo, naturaleza, codigoPadre, aceptaMovimiento]
const CUENTAS_TEMPLATE = [
  // Nivel 1 — Grupos principales
  ['1',   'ACTIVO',                                     'ACTIVO',  'DEBITO',  null,  false],
  ['2',   'PASIVO',                                     'PASIVO',  'CREDITO', null,  false],
  ['4',   'INGRESOS',                                   'INGRESO', 'CREDITO', null,  false],
  ['5',   'COSTOS Y GASTOS',                            'GASTO',   'DEBITO',  null,  false],

  // Nivel 2 — Sub-grupos
  ['101', 'Activo Corriente',                           'ACTIVO',  'DEBITO',  '1',   false],
  ['201', 'Pasivo Corriente',                           'PASIVO',  'CREDITO', '2',   false],
  ['410', 'Ventas',                                     'INGRESO', 'CREDITO', '4',   false],
  ['510', 'Costo de Ventas',                            'GASTO',   'DEBITO',  '5',   false],

  // Nivel 3 — Agrupaciones
  ['10101',   'Caja y Bancos',                          'ACTIVO',  'DEBITO',  '101', false],
  ['10105',   'Créditos Tributarios',                   'ACTIVO',  'DEBITO',  '101', false],
  ['20107',   'Retenciones y Tributos por Pagar',       'PASIVO',  'CREDITO', '201', false],
  ['41010',   'Ventas Locales',                         'INGRESO', 'CREDITO', '410', false],
  ['51010',   'Costo de Ventas Local',                  'GASTO',   'DEBITO',  '510', false],

  // ─── Cuentas de movimiento (ASIENTO TIPO) ────────────────────────────────
  // ACTIVO
  ['101010101', 'Caja General',                         'ACTIVO',  'DEBITO',  '10101', true],
  ['1010504',   'IVA Crédito Tributario Compras',       'ACTIVO',  'DEBITO',  '10105', true],
  ['1010505',   'Retención IR en Ventas',               'ACTIVO',  'DEBITO',  '10105', true],
  ['1010506',   'Retención IVA en Ventas',              'ACTIVO',  'DEBITO',  '10105', true],
  // PASIVO
  ['201070101', 'Retenciones en la Fuente por Pagar',  'PASIVO',  'CREDITO', '20107', true],
  ['201070102', 'Retenciones IVA por Pagar',           'PASIVO',  'CREDITO', '20107', true],
  ['201070103', 'IVA en Ventas por Pagar',             'PASIVO',  'CREDITO', '20107', true],
  // INGRESO
  ['410101',    'Ventas Netas Locales',                 'INGRESO', 'CREDITO', '41010', true],
  // GASTO/COSTO
  ['510101',    'Costo de Ventas',                     'GASTO',   'DEBITO',  '51010', true],
];

// ─── Periodos contables ───────────────────────────────────────────────────────
const PERIODOS = [
  { codigo: '01/2023', nombre: 'Ejercicio 2023', fechaInicio: '2023-01-01', fechaFin: '2023-12-31', estado: 'CERRADO' },
  { codigo: '01/2024', nombre: 'Ejercicio 2024', fechaInicio: '2024-01-01', fechaFin: '2024-12-31', estado: 'CERRADO' },
  { codigo: '01/2025', nombre: 'Ejercicio 2025', fechaInicio: '2025-01-01', fechaFin: '2025-12-31', estado: 'ABIERTO' },
];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// Generador de numero asiento tipo AAAAMM-NNNN
const contadoresMes = {};
async function siguienteNumero(empresaId, fecha, db = prisma) {
  const d = new Date(fecha);
  const periodo = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (!contadoresMes[periodo]) {
    // Find current max in DB
    const inicio = new Date(d.getFullYear(), d.getMonth(), 1);
    const fin    = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const ultimo = await db.asientos_contables.findFirst({
      where: { empresaId, fecha: { gte: inicio, lte: fin } },
      orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
      select: { numero: true },
    });
    const match = ultimo?.numero ? ultimo.numero.match(/(\d+)$/) : null;
    contadoresMes[periodo] = match ? parseInt(match[1], 10) : 0;
  }
  contadoresMes[periodo]++;
  return `${periodo}-${String(contadoresMes[periodo]).padStart(4, '0')}`;
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log(' Importación histórica Puchaicela — INICIO');
  console.log('═══════════════════════════════════════════════════');

  // ── 1. Crear empresa ──────────────────────────────────────────────────────
  let empresa = await prisma.empresas.findUnique({ where: { ruc: '1104196546001' } });
  if (empresa) {
    console.log(`\n✓ Empresa ya existe (id=${empresa.id}): ${empresa.razonSocial}`);
  } else {
    empresa = await prisma.empresas.create({
      data: {
        ruc: '1104196546001',
        razonSocial: 'DANIEL RAMIRO PUCHAICELA ABENDAÑO',
        nombreComercial: 'PUCHAICELA CONSTRUCCIONES',
        direccion: 'Loja, Ecuador',
        email: 'daniel_rpa@yahoo.es',
        telefono: '',
        activo: true,
        plan: 'full',
      },
    });
    console.log(`\n✓ Empresa creada: id=${empresa.id} | ${empresa.razonSocial}`);
  }
  const empresaId = empresa.id;

  // ── 2. Crear plan de cuentas ─────────────────────────────────────────────
  console.log('\n── Plan de cuentas ──────────────────────────────');
  const cuentaMap = {}; // codigo → id

  for (const [codigo, nombre, tipo, naturaleza, codigoPadre, aceptaMovimiento] of CUENTAS_TEMPLATE) {
    // Determine nivel by code length groupings
    const nivel = codigo.length <= 1 ? 1
      : codigo.length <= 3 ? 2
      : codigo.length <= 5 ? 3
      : 4;

    const existing = await prisma.plan_cuentas.findFirst({
      where: { empresaId, codigo },
    });

    if (existing) {
      cuentaMap[codigo] = existing.id;
      continue;
    }

    const cuenta = await prisma.plan_cuentas.create({
      data: {
        empresaId,
        codigo,
        nombre,
        nivel,
        tipo,
        naturaleza,
        codigoPadre: codigoPadre ?? null,
        aceptaMovimiento,
        activo: true,
      },
    });
    cuentaMap[codigo] = cuenta.id;
    console.log(`  + ${codigo.padEnd(12)} ${nombre}`);
  }
  console.log(`  Total cuentas mapa: ${Object.keys(cuentaMap).length}`);

  // Helper: obtener id de cuenta
  const cid = (codigo) => {
    const id = cuentaMap[codigo];
    if (!id) throw new Error(`Cuenta no encontrada en mapa: ${codigo}`);
    return id;
  };

  // ── 3. Crear periodos contables ──────────────────────────────────────────
  console.log('\n── Periodos contables ───────────────────────────');
  for (const p of PERIODOS) {
    const existing = await prisma.periodos_contables.findFirst({
      where: { empresaId, codigo: p.codigo },
    });
    if (existing) {
      console.log(`  ~ Ya existe: ${p.codigo}`);
      continue;
    }
    await prisma.periodos_contables.create({
      data: {
        empresaId,
        codigo: p.codigo,
        nombre: p.nombre,
        fechaInicio: new Date(p.fechaInicio),
        fechaFin: new Date(p.fechaFin),
        estado: p.estado,
      },
    });
    console.log(`  + Periodo: ${p.codigo} (${p.estado})`);
  }

  // ── 4. Asientos de COMPRAS (mensuales) ───────────────────────────────────
  console.log('\n── Asientos COMPRAS mensuales ───────────────────');
  let asientosCompra = 0;
  let asientosCompraExist = 0;

  for (const mes of comprasData) {
    const total = round2(mes.Total);
    const iva   = round2(mes.Iva);
    const costo = round2(total - iva);

    if (total <= 0) { continue; }

    const fechaStr = `${mes.Ano}-${String(mes.Mes).padStart(2, '0')}-28`;
    const fecha = new Date(fechaStr);
    const referencia = `COMP-HIST-${mes.Ano}-${String(mes.Mes).padStart(2, '0')}`;
    const mesNombre = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'][mes.Mes - 1];

    const existing = await prisma.asientos_contables.findFirst({
      where: { empresaId, tipo: 'COMPRA', referencia },
    });
    if (existing) {
      console.log(`  ~ Ya existe: ${referencia}`);
      asientosCompraExist++;
      continue;
    }

    const detalles = [];

    if (costo > 0) {
      detalles.push({
        cuentaId: cid('510101'),
        descripcion: `Compras ${mesNombre} ${mes.Ano} — costo`,
        debe: costo,
        haber: 0,
      });
    }
    if (iva > 0) {
      detalles.push({
        cuentaId: cid('1010504'),
        descripcion: `IVA compras ${mesNombre} ${mes.Ano}`,
        debe: iva,
        haber: 0,
      });
    }
    detalles.push({
      cuentaId: cid('101010101'),
      descripcion: `Pago compras ${mesNombre} ${mes.Ano}`,
      debe: 0,
      haber: total,
    });

    // Verify balance
    const sumDebe  = round2(detalles.reduce((a, d) => a + d.debe, 0));
    const sumHaber = round2(detalles.reduce((a, d) => a + d.haber, 0));
    if (Math.abs(sumDebe - sumHaber) > 0.02) {
      console.warn(`  ! Desbalance en ${referencia}: debe=${sumDebe} haber=${sumHaber}`);
    }

    const numero = await siguienteNumero(empresaId, fecha);
    const totalDebe  = round2(detalles.reduce((a, d) => a + d.debe, 0));
    const totalHaber = round2(detalles.reduce((a, d) => a + d.haber, 0));
    await prisma.asientos_contables.create({
      data: {
        empresaId,
        fecha,
        numero,
        descripcion: `Compras históricas ${mesNombre} ${mes.Ano} (${mes.Filas} documentos)`,
        tipo: 'COMPRA',
        referencia,
        cerrado: false,
        totalDebe,
        totalHaber,
        detalles: { create: detalles },
      },
    });

    console.log(`  + ${referencia} | Costo=${costo} IVA=${iva} Total=${total} (${mes.Filas} docs)`);
    asientosCompra++;
  }
  console.log(`  Compras creadas: ${asientosCompra} | Ya existían: ${asientosCompraExist}`);

  // ── 5. Asientos de VENTAS (por factura) ──────────────────────────────────
  console.log('\n── Asientos VENTAS por factura ──────────────────');
  let asientosVenta = 0;
  let asientosVentaExist = 0;

  for (const v of ventasData) {
    const total       = round2(v.Total);
    const iva         = round2(v.IVA);
    const ventas      = round2(v.TotalSinImp);
    const retIR       = round2(v.RetIR);
    const retIVA      = round2(v.RetIVA);
    const cajaCobrado = round2(total - retIR - retIVA);

    // Parse fecha dd/MM/yyyy
    const parts = v.Fecha.split('/');
    const fecha = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    const referencia = `VTA-HIST-${v.Secuencial.replace(/\//g, '-')}`;

    const existing = await prisma.asientos_contables.findFirst({
      where: { empresaId, tipo: 'FACTURA', referencia },
    });
    if (existing) {
      asientosVentaExist++;
      continue;
    }

    const detalles = [];

    // DÉBITOS
    if (cajaCobrado > 0) {
      detalles.push({
        cuentaId: cid('101010101'),
        descripcion: `Cobro factura ${v.Secuencial} — ${v.Comprador}`,
        debe: cajaCobrado,
        haber: 0,
      });
    }
    if (retIR > 0) {
      detalles.push({
        cuentaId: cid('1010505'),
        descripcion: `Ret. IR recibida (${v.Secuencial})`,
        debe: retIR,
        haber: 0,
      });
    }
    if (retIVA > 0) {
      detalles.push({
        cuentaId: cid('1010506'),
        descripcion: `Ret. IVA recibida (${v.Secuencial})`,
        debe: retIVA,
        haber: 0,
      });
    }

    // CRÉDITOS
    if (ventas > 0) {
      detalles.push({
        cuentaId: cid('410101'),
        descripcion: `Venta ${v.Secuencial} — ${v.Comprador}`,
        debe: 0,
        haber: ventas,
      });
    }
    if (iva > 0) {
      detalles.push({
        cuentaId: cid('201070103'),
        descripcion: `IVA venta ${v.Secuencial}`,
        debe: 0,
        haber: iva,
      });
    }

    // Verify balance
    const sumDebe  = round2(detalles.reduce((a, d) => a + d.debe, 0));
    const sumHaber = round2(detalles.reduce((a, d) => a + d.haber, 0));
    if (Math.abs(sumDebe - sumHaber) > 0.02) {
      console.warn(`  ! Desbalance venta ${v.Secuencial}: debe=${sumDebe} haber=${sumHaber} (cajaCobrado=${cajaCobrado})`);
      // Fix: adjust caja
      const diff = round2(sumHaber - sumDebe);
      const cajaDetalle = detalles.find(d => d.cuentaId === cid('101010101'));
      if (cajaDetalle) cajaDetalle.debe = round2(cajaDetalle.debe + diff);
    }

    const numeroV = await siguienteNumero(empresaId, fecha);
    const totalDebeV  = round2(detalles.reduce((a, d) => a + d.debe, 0));
    const totalHaberV = round2(detalles.reduce((a, d) => a + d.haber, 0));
    await prisma.asientos_contables.create({
      data: {
        empresaId,
        fecha,
        numero: numeroV,
        descripcion: `Factura ${v.Secuencial} — ${v.Comprador}`,
        tipo: 'FACTURA',
        referencia,
        cerrado: false,
        totalDebe: totalDebeV,
        totalHaber: totalHaberV,
        detalles: { create: detalles },
      },
    });

    console.log(`  + ${v.Secuencial} ${v.Fecha} | Ventas=${ventas} IVA=${iva} RetIR=${retIR} RetIVA=${retIVA} Caja=${cajaCobrado}`);
    asientosVenta++;
  }
  console.log(`  Ventas creadas: ${asientosVenta} | Ya existían: ${asientosVentaExist}`);

  // ── Resumen ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════');
  console.log(' RESUMEN FINAL');
  console.log(`  Empresa id: ${empresaId}`);
  console.log(`  Cuentas en mapa: ${Object.keys(cuentaMap).length}`);
  console.log(`  Asientos compras creados: ${asientosCompra}`);
  console.log(`  Asientos ventas creados: ${asientosVenta}`);

  const totCompras = comprasData.reduce((a, m) => a + (m.Total || 0), 0);
  const totVentas  = ventasData.reduce((a, v) => a + (v.Total || 0), 0);
  console.log(`  Total compras procesadas: $${totCompras.toFixed(2)}`);
  console.log(`  Total ventas procesadas:  $${totVentas.toFixed(2)}`);
  console.log('═══════════════════════════════════════════════════');

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  console.error(e.stack);
  prisma.$disconnect();
  process.exit(1);
});
