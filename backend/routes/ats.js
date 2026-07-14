// ====================================
// RUTAS: ATS — ANEXO TRANSACCIONAL SIMPLIFICADO
// backend/routes/ats.js
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const PDFDocument = require('pdfkit');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('atsHabilitado'));
router.use(autorizarPermiso('tributario.reportes'));

const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function rangoPeriodo(mes, anio) {
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);
  return { desde, hasta };
}

function fmtFecha(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function parseNumero(num) {
  // "001-001-000000001" → { estab, pto, sec }
  const parts = (num || '').split('-');
  return {
    estab: (parts[0] || '001').padStart(3, '0'),
    pto:   (parts[1] || '001').padStart(3, '0'),
    sec:   (parts[2] || '000000001').padStart(9, '0'),
  };
}

function r2(v) { return Math.round(parseFloat(v || 0) * 100) / 100; }

async function getConfigSRI(empresaId) {
  const config = await prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } });
  if (!config) throw new Error('No hay configuración SRI configurada.');
  return config;
}

// ─── Mapeo retenciones IVA → campos ATS ──────────────────────────────────────
// codPorcentaje (codigo del JSON impuestos) → campo XML ATS
function mapRetIva(impuestosJson) {
  const imps = Array.isArray(impuestosJson) ? impuestosJson
    : (typeof impuestosJson === 'string' ? JSON.parse(impuestosJson) : []);

  const ivaImps = imps.filter(i => String(i.codigo) === '2');
  const retIva = {
    valRetBien10: 0, valRetServ20: 0, valorRetBienes: 0,
    valRetServ50: 0, valorRetServicios: 0, valRetServ100: 0,
  };
  ivaImps.forEach(i => {
    const v = r2(i.valorRetenido);
    const cod = String(i.codigoPorcentaje || '');
    if (cod === '9')  retIva.valRetBien10     += v;
    else if (cod === '10') retIva.valRetServ20 += v;
    else if (cod === '1')  retIva.valorRetBienes += v;
    else if (cod === '2')  retIva.valRetServ50 += v;
    else if (cod === '3')  retIva.valorRetServicios += v;
    else if (cod === '4')  retIva.valRetServ100 += v;
    else retIva.valorRetServicios += v; // fallback
  });
  return retIva;
}

// ─── GET /preview ─────────────────────────────────────────────────────────────
router.get('/preview', async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoPeriodo(mes, anio);
    const empresaId = req.empresa.id;

    const periodoWhere = { fechaEmision: { gte: desde, lte: hasta } };
    const [facturas, liquidaciones, retenciones, compras, ncs, anuladosFacturas] = await Promise.all([
      // Ventas: facturas emitidas autorizadas
      prisma.facturas.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere },
        select: {
          id: true, numeroFactura: true, fechaEmision: true,
          tipoIdentificacionComprador: true, identificacionComprador: true,
          razonSocialComprador: true,
          subtotal0: true, subtotal5: true, subtotal15: true, totalIva: true, importeTotal: true,
        },
        orderBy: { secuencial: 'asc' },
      }),
      // Ventas: liquidaciones de compra emitidas autorizadas (tipo 03)
      prisma.liquidaciones_compra.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere },
        select: {
          id: true, numeroLiquidacion: true, fechaEmision: true,
          tipoIdentificacionProveedor: true, identificacionProveedor: true,
          razonSocialProveedor: true,
          subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
        },
        orderBy: { secuencial: 'asc' },
      }),
      // Retenciones emitidas autorizadas (van dentro de compras como air)
      prisma.retenciones.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', anulada: false, ...periodoWhere },
        select: {
          id: true, numeroRetencion: true, fechaEmision: true, secuencial: true,
          tipoIdentificacionProveedor: true, identificacionProveedor: true,
          razonSocialProveedor: true, periodoFiscal: true,
          totalRetenido: true, impuestos: true, numeroAutorizacion: true,
          compraId: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      // Compras: facturas_compra NO anuladas del período
      prisma.facturas_compra.findMany({
        where: { empresaId, anulada: false, ...periodoWhere },
        include: {
          retenciones: {
            where: { anulada: false },
            select: {
              id: true, numeroRetencion: true, secuencial: true,
              impuestos: true, numeroAutorizacion: true, fechaEmision: true,
              estadoSri: true,
            },
          },
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      // Ventas: notas de crédito emitidas autorizadas (tipo 04)
      prisma.notas_credito.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } },
        select: {
          id: true, numeroNC: true, fechaEmision: true,
          tipoIdentificacionComprador: true, identificacionComprador: true,
          razonSocialComprador: true,
          totalSinImpuestos: true, totalIva: true, importeTotal: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      // Anulados: facturas emitidas anuladas del período
      prisma.facturas.findMany({
        where: { empresaId, anulada: true, ...periodoWhere },
        select: {
          id: true, numeroFactura: true, fechaEmision: true,
          numeroAutorizacion: true, estadoSri: true,
        },
        orderBy: { secuencial: 'asc' },
      }),
    ]);

    const sumar = (arr, campo) => arr.reduce((s, r) => s + r2(r[campo]), 0);

    const totales = {
      totalVentasFacturas:       sumar(facturas, 'importeTotal'),
      totalVentasLiquidaciones:  sumar(liquidaciones, 'importeTotal'),
      totalCompras:              sumar(compras, 'importeTotal'),
      totalRetenciones:          sumar(retenciones, 'totalRetenido'),
      docFacturas:               facturas.length,
      docLiquidaciones:          liquidaciones.length,
      docCompras:                compras.length,
      docRetenciones:            retenciones.length,
      docNCs:                    ncs.length,
      docAnulados:               anuladosFacturas.length,
    };

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes]} ${anio}` },
        facturas, liquidaciones, retenciones, compras, ncs,
        anulados: anuladosFacturas,
        totales,
      },
    });
  } catch (err) {
    console.error('[ATS preview]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /exportar — XML ATS ──────────────────────────────────────────────────
router.get('/exportar', async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoPeriodo(mes, anio);
    const empresaId = req.empresa.id;
    const config = await getConfigSRI(empresaId);
    const mesPad = String(mes).padStart(2, '0');

    const periodoWhere = { fechaEmision: { gte: desde, lte: hasta } };

    const [facturas, liquidaciones, compras, ncs, anuladosFacturas] = await Promise.all([
      prisma.facturas.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere },
        orderBy: { secuencial: 'asc' },
      }),
      prisma.liquidaciones_compra.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere },
        orderBy: { secuencial: 'asc' },
      }),
      prisma.facturas_compra.findMany({
        where: { empresaId, anulada: false, ...periodoWhere },
        include: {
          retenciones: {
            where: { anulada: false },
          },
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      prisma.notas_credito.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } },
        orderBy: { fechaEmision: 'asc' },
      }),
      prisma.facturas.findMany({
        where: { empresaId, anulada: true, ...periodoWhere },
        orderBy: { secuencial: 'asc' },
      }),
    ]);

    // ── totalVentas ───────────────────────────────────────────────────────────
    const totalVentas = [
      ...facturas.map(f => r2(f.importeTotal)),
      ...liquidaciones.map(l => r2(l.importeTotal)),
      ...ncs.map(n => r2(n.importeTotal)),
    ].reduce((s, v) => s + v, 0);

    // ── <ventas> — agrupar por (tipoId, id, tipoComprobante) ─────────────────
    const ventasMap = new Map();
    const acumularVenta = (tpId, idCliente, tipoCbte, row) => {
      const key = `${tpId}|${idCliente}|${tipoCbte}`;
      if (!ventasMap.has(key)) {
        ventasMap.set(key, {
          tpIdCliente: tpId, idCliente, tipoComprobante: tipoCbte,
          count: 0, baseNoGraIva: 0, baseImponible: 0, baseImpGrav: 0, montoIva: 0,
        });
      }
      const e = ventasMap.get(key);
      e.count++;
      e.baseImponible += r2(row.subtotal0 || 0);
      e.baseImpGrav   += r2((row.subtotal15 || 0) + (row.subtotal5 || 0));
      e.montoIva      += r2(row.totalIva   || 0);
    };

    facturas.forEach(f => acumularVenta(f.tipoIdentificacionComprador, f.identificacionComprador, '01', f));
    liquidaciones.forEach(l => acumularVenta(l.tipoIdentificacionProveedor, l.identificacionProveedor, '03', l));
    ncs.forEach(n => {
      const key = `${n.tipoIdentificacionComprador}|${n.identificacionComprador}|04`;
      if (!ventasMap.has(key)) {
        ventasMap.set(key, {
          tpIdCliente: n.tipoIdentificacionComprador, idCliente: n.identificacionComprador,
          tipoComprobante: '04', count: 0, baseNoGraIva: 0, baseImponible: 0, baseImpGrav: 0, montoIva: 0,
        });
      }
      const e = ventasMap.get(key);
      e.count++;
      // NC es negativo para ventas
      e.baseImpGrav -= r2(n.totalSinImpuestos || 0);
      e.montoIva    -= r2(n.totalIva || 0);
    });

    let ventasXML = '';
    ventasMap.forEach(v => {
      ventasXML += `
    <detalleVentas>
      <tpIdCliente>${v.tpIdCliente}</tpIdCliente>
      <idCliente>${v.idCliente}</idCliente>
      <parteRel>NO</parteRel>
      <tipoCli>01</tipoCli>
      <tipoComprobante>${v.tipoComprobante}</tipoComprobante>
      <tipoEmision>E</tipoEmision>
      <numeroComprobantes>${v.count}</numeroComprobantes>
      <baseNoGraIva>${v.baseNoGraIva.toFixed(2)}</baseNoGraIva>
      <baseImponible>${v.baseImponible.toFixed(2)}</baseImponible>
      <baseImpGrav>${v.baseImpGrav.toFixed(2)}</baseImpGrav>
      <montoIva>${v.montoIva.toFixed(2)}</montoIva>
      <montoIce>0.00</montoIce>
      <valorRetIva>0.00</valorRetIva>
      <valorRetRenta>0.00</valorRetRenta>
    </detalleVentas>`;
    });

    // ── <compras> — una entrada por factura_compra ────────────────────────────
    let comprasXML = '';
    compras.forEach(compra => {
      const { estab, pto, sec } = parseNumero(compra.numeroFactura);
      const auth = compra.numeroAutorizacion || compra.claveAcceso || '';
      const tpId = compra.tipoIdentificacionProveedor || '04';

      const retList = compra.retenciones || [];
      // Tomar la primera retención autorizada para datos de cabecera
      const retPrincipal = retList.find(r => r.estadoSri === 'AUTORIZADO') || retList[0];

      // Sumar retenciones IR y calcular air XML
      let airXML = '';
      const allImpuestos = retList.flatMap(r => {
        const imps = Array.isArray(r.impuestos) ? r.impuestos
          : (typeof r.impuestos === 'string' ? JSON.parse(r.impuestos) : []);
        return imps;
      });
      const irImps = allImpuestos.filter(i => String(i.codigo) === '1');
      irImps.forEach(i => {
        airXML += `
        <detalleAir>
          <codRetAir>${i.codigoPorcentaje || ''}</codRetAir>
          <baseImpAir>${r2(i.baseImponible).toFixed(2)}</baseImpAir>
          <porcentajeAir>${r2(i.porcentajeRetener).toFixed(2)}</porcentajeAir>
          <valRetAir>${r2(i.valorRetenido).toFixed(2)}</valRetAir>
        </detalleAir>`;
      });

      // Calcular retenciones IVA por campo ATS
      const retIvaMap = mapRetIva({ codigo: '2', ...{} });
      const ivaImps = allImpuestos.filter(i => String(i.codigo) === '2');
      const retIva = {
        valRetBien10: 0, valRetServ20: 0, valorRetBienes: 0,
        valRetServ50: 0, valorRetServicios: 0, valRetServ100: 0,
      };
      ivaImps.forEach(i => {
        const v = r2(i.valorRetenido);
        const cod = String(i.codigoPorcentaje || '');
        if (cod === '9') retIva.valRetBien10 += v;
        else if (cod === '10') retIva.valRetServ20 += v;
        else if (cod === '1') retIva.valorRetBienes += v;
        else if (cod === '2') retIva.valRetServ50 += v;
        else if (cod === '3') retIva.valorRetServicios += v;
        else if (cod === '4') retIva.valRetServ100 += v;
        else retIva.valorRetServicios += v;
      });

      const baseGravada = r2((compra.subtotal15 || 0) + (compra.subtotal5 || 0));
      const base0 = r2(compra.subtotal0 || 0);

      comprasXML += `
    <detalleCompras>
      <codSustento>${compra.tipoGasto === 'ACTIVO_FIJO' ? '03' : '01'}</codSustento>
      <tpIdProv>${tpId}</tpIdProv>
      <idProv>${compra.identificacionProveedor}</idProv>
      <tipoComprobante>01</tipoComprobante>
      <parteRel>NO</parteRel>
      <fechaRegistro>${fmtFecha(compra.createdAt || compra.fechaEmision)}</fechaRegistro>
      <establecimiento>${estab}</establecimiento>
      <puntoEmision>${pto}</puntoEmision>
      <secuencial>${sec}</secuencial>
      <fechaEmisionDoc>${fmtFecha(compra.fechaEmision)}</fechaEmisionDoc>
      <autorizacion>${auth}</autorizacion>
      <baseNoGraIva>0.00</baseNoGraIva>
      <baseImponible>${base0.toFixed(2)}</baseImponible>
      <baseImpGrav>${baseGravada.toFixed(2)}</baseImpGrav>
      <montoIce>0.00</montoIce>
      <montoIva>${r2(compra.totalIva).toFixed(2)}</montoIva>
      <valRetBien10>${retIva.valRetBien10.toFixed(2)}</valRetBien10>
      <valRetServ20>${retIva.valRetServ20.toFixed(2)}</valRetServ20>
      <valorRetBienes>${retIva.valorRetBienes.toFixed(2)}</valorRetBienes>
      <valRetServ50>${retIva.valRetServ50.toFixed(2)}</valRetServ50>
      <valorRetServicios>${retIva.valorRetServicios.toFixed(2)}</valorRetServicios>
      <valRetServ100>${retIva.valRetServ100.toFixed(2)}</valRetServ100>
      <totbasesImpReemb>0.00</totbasesImpReemb>
      <air>${airXML}
      </air>${retPrincipal ? (() => {
        const rp = parseNumero(retPrincipal.numeroRetencion);
        return `
      <estabRetencion1>${rp.estab}</estabRetencion1>
      <ptoEmiRetencion1>${rp.pto}</ptoEmiRetencion1>
      <secRetencion1>${rp.sec}</secRetencion1>
      <autRetencion1>${retPrincipal.numeroAutorizacion || ''}</autRetencion1>
      <fechaEmiRet1>${fmtFecha(retPrincipal.fechaEmision)}</fechaEmiRet1>`;
      })() : ''}
    </detalleCompras>`;
    });

    // ── <anulados> ────────────────────────────────────────────────────────────
    let anuladosXML = '';
    anuladosFacturas.forEach(f => {
      const { estab, pto, sec } = parseNumero(f.numeroFactura);
      anuladosXML += `
    <detalleAnulados>
      <tipoComprobante>01</tipoComprobante>
      <establecimiento>${estab}</establecimiento>
      <puntoEmision>${pto}</puntoEmision>
      <secuencialInicio>${sec}</secuencialInicio>
      <secuencialFin>${sec}</secuencialFin>
      <autorizacion>${f.numeroAutorizacion || ''}</autorizacion>
    </detalleAnulados>`;
    });

    const xmlATS = `<?xml version="1.0" encoding="UTF-8"?>
<ats>
  <TipoIDInformante>R</TipoIDInformante>
  <IdInformante>${config.ruc}</IdInformante>
  <razonSocial>${config.razonSocial}</razonSocial>
  <Anio>${anio}</Anio>
  <Mes>${mesPad}</Mes>
  <numEstabRuc>${String(config.establecimiento || '001').padStart(3,'0')}</numEstabRuc>
  <totalVentas>${totalVentas.toFixed(2)}</totalVentas>
  <codigoOperativo>IVA</codigoOperativo>
  <compras>${comprasXML}
  </compras>
  <ventas>${ventasXML}
  </ventas>
  <anulados>${anuladosXML}
  </anulados>
</ats>`;

    const filename = `ats_${config.ruc}_${anio}${mesPad}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xmlATS);
  } catch (err) {
    console.error('[ATS exportar]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /exportar/pdf — Talón Resumen ATS (PDFKit) ──────────────────────────
router.get('/exportar/pdf', async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoPeriodo(mes, anio);
    const empresaId = req.empresa.id;
    const config = await getConfigSRI(empresaId);
    const mesPad = String(mes).padStart(2, '0');
    const periodo = `${MESES[mes]} ${anio}`;

    const periodoWhere = { fechaEmision: { gte: desde, lte: hasta } };

    const [facturas, liquidaciones, compras, ncs, retenciones] = await Promise.all([
      prisma.facturas.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere } }),
      prisma.liquidaciones_compra.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere } }),
      prisma.facturas_compra.findMany({
        where: { empresaId, anulada: false, ...periodoWhere },
        include: { retenciones: { where: { anulada: false } } },
      }),
      prisma.notas_credito.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } } }),
      prisma.retenciones.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', anulada: false, ...periodoWhere },
      }),
    ]);

    // ── Calcular totales ──────────────────────────────────────────────────────
    const vBase0    = facturas.reduce((s, f) => s + r2(f.subtotal0), 0)
                    + liquidaciones.reduce((s, l) => s + r2(l.subtotal0), 0);
    const vBaseGrav = facturas.reduce((s, f) => s + r2(f.subtotal15) + r2(f.subtotal5 || 0), 0)
                    + liquidaciones.reduce((s, l) => s + r2(l.subtotal15), 0);
    const vIva      = facturas.reduce((s, f) => s + r2(f.totalIva), 0)
                    + liquidaciones.reduce((s, l) => s + r2(l.totalIva), 0);
    const vTotal    = facturas.reduce((s, f) => s + r2(f.importeTotal), 0)
                    + liquidaciones.reduce((s, l) => s + r2(l.importeTotal), 0);
    const vNcTotal  = ncs.reduce((s, n) => s + r2(n.importeTotal), 0);
    const vNeto     = vTotal - vNcTotal;

    const cBase0    = compras.reduce((s, c) => s + r2(c.subtotal0), 0);
    const cBaseGrav = compras.reduce((s, c) => s + r2(c.subtotal15) + r2(c.subtotal5 || 0), 0);
    const cIva      = compras.reduce((s, c) => s + r2(c.totalIva), 0);
    const cTotal    = compras.reduce((s, c) => s + r2(c.importeTotal), 0);
    const cRetIR    = compras.reduce((s, c) => s + r2(c.retencionRenta), 0);
    const cRetIva   = compras.reduce((s, c) => s + r2(c.retencionIVA), 0);

    // Retenciones emitidas por % (para campo 721-731)
    const retPorPct = {};
    retenciones.forEach(ret => {
      const imps = Array.isArray(ret.impuestos) ? ret.impuestos
        : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
      imps.filter(i => String(i.codigo) === '2').forEach(i => {
        const pct = parseFloat(i.porcentajeRetener || 0);
        const val = r2(i.valorRetenido);
        retPorPct[pct] = (retPorPct[pct] || 0) + val;
      });
    });
    const totalRetIvaPorPct = Object.values(retPorPct).reduce((s, v) => s + v, 0);
    const totalRetIrEmitido = retenciones.reduce((s, r) => {
      const imps = Array.isArray(r.impuestos) ? r.impuestos
        : (typeof r.impuestos === 'string' ? JSON.parse(r.impuestos) : []);
      return s + imps.filter(i => String(i.codigo) === '1').reduce((a, i) => a + r2(i.valorRetenido), 0);
    }, 0);

    // ── PDFKit ────────────────────────────────────────────────────────────────
    const retPctOrdenados = Object.entries(retPorPct).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));

    const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 36, left: 36, right: 36 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="talonATS_${anio}${mesPad}.pdf"`);
    doc.pipe(res);

    const ML = 36, MR = 36;
    const PW = 595 - ML - MR;
    const fmtM = (n) => `$ ${Number(n).toFixed(2)}`;
    const SRI_BLUE = '#003087';
    const COL_CAMPO = 46;
    const COL_VAL   = 88;
    const COL_DESC  = PW - COL_CAMPO - COL_VAL;
    const ROW_H     = 15;

    // ── Cabecera estilo SRI ──────────────────────────────────────────────────
    // Badge izquierdo (simula logo SRI)
    doc.rect(ML, 36, 88, 48).fillAndStroke(SRI_BLUE, SRI_BLUE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(6)
      .text('SERVICIO DE RENTAS INTERNAS', ML + 2, 42, { width: 84, align: 'center' });
    doc.fontSize(16).text('SRI', ML + 2, 51, { width: 84, align: 'center' });
    doc.fontSize(5.5).text('República del Ecuador', ML + 2, 73, { width: 84, align: 'center' });
    doc.fillColor('black');

    // Bloque central del título
    doc.fillColor(SRI_BLUE).font('Helvetica-Bold').fontSize(12)
      .text('ANEXO TRANSACCIONAL SIMPLIFICADO', ML + 94, 40, { width: PW - 94 - 78, align: 'center' });
    doc.fontSize(9)
      .text('TALÓN RESUMEN DEL PERÍODO', ML + 94, 56, { width: PW - 94 - 78, align: 'center' });
    doc.fillColor('black');

    // Caja "ATS" (esquina superior derecha)
    doc.rect(ML + PW - 76, 36, 76, 48).stroke(SRI_BLUE);
    doc.fontSize(6.5).font('Helvetica').fillColor('#64748b')
      .text('FORMULARIO', ML + PW - 76, 43, { width: 76, align: 'center' });
    doc.fontSize(20).font('Helvetica-Bold').fillColor(SRI_BLUE)
      .text('ATS', ML + PW - 76, 52, { width: 76, align: 'center' });
    doc.fillColor('black');

    // Fila de datos de la empresa
    const infoY = 90;
    doc.rect(ML, infoY, PW, 34).stroke('#94a3b8');
    const col3 = Math.floor(PW / 3);
    doc.moveTo(ML + col3, infoY).lineTo(ML + col3, infoY + 34).stroke('#94a3b8');
    doc.moveTo(ML + col3 * 2, infoY).lineTo(ML + col3 * 2, infoY + 34).stroke('#94a3b8');
    doc.fontSize(6.5).fillColor('#64748b').font('Helvetica')
      .text('RUC / NÚMERO DE IDENTIFICACIÓN', ML + 3, infoY + 3)
      .text('RAZÓN SOCIAL', ML + col3 + 3, infoY + 3)
      .text('PERÍODO FISCAL', ML + col3 * 2 + 3, infoY + 3);
    doc.fontSize(9).fillColor('black').font('Helvetica-Bold')
      .text(config.ruc || '—', ML + 3, infoY + 13, { width: col3 - 6 })
      .text(config.razonSocial || '—', ML + col3 + 3, infoY + 13, { width: col3 - 6 })
      .text(periodo, ML + col3 * 2 + 3, infoY + 13, { width: col3 - 6 });

    // ── Helpers tabla ────────────────────────────────────────────────────────
    let curY = infoY + 40;
    let rowAlt = false;

    const drawSecHeader = (letra, title) => {
      curY += 6;
      doc.rect(ML, curY, PW, ROW_H + 2).fillAndStroke(SRI_BLUE, SRI_BLUE);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5)
        .text(`${letra}.  ${title}`, ML + 4, curY + 4, { width: PW - 8 });
      doc.fillColor('black');
      curY += ROW_H + 4;
      rowAlt = false;
    };

    const drawTblHeader = () => {
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke('#dbeafe', '#93c5fd');
      doc.moveTo(ML + COL_CAMPO, curY).lineTo(ML + COL_CAMPO, curY + ROW_H).stroke('#93c5fd');
      doc.moveTo(ML + COL_CAMPO + COL_DESC, curY).lineTo(ML + COL_CAMPO + COL_DESC, curY + ROW_H).stroke('#93c5fd');
      doc.fillColor(SRI_BLUE).font('Helvetica-Bold').fontSize(7.5)
        .text('CAMPO', ML + 2, curY + 4, { width: COL_CAMPO - 4, align: 'center' })
        .text('DESCRIPCIÓN', ML + COL_CAMPO + 3, curY + 4, { width: COL_DESC - 6 })
        .text('VALOR (USD)', ML + COL_CAMPO + COL_DESC + 3, curY + 4, { width: COL_VAL - 6, align: 'right' });
      doc.fillColor('black');
      curY += ROW_H;
    };

    const drawRow = (campo, desc, valor, bold = false) => {
      const bg = rowAlt ? '#f8fafc' : '#ffffff';
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(bg, '#e2e8f0');
      doc.moveTo(ML + COL_CAMPO, curY + 1).lineTo(ML + COL_CAMPO, curY + ROW_H - 1).lineWidth(0.4).stroke('#cbd5e1');
      doc.moveTo(ML + COL_CAMPO + COL_DESC, curY + 1).lineTo(ML + COL_CAMPO + COL_DESC, curY + ROW_H - 1).stroke('#cbd5e1');
      doc.lineWidth(1);
      const fc = bold ? SRI_BLUE : '#1e293b';
      const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
      doc.fillColor(fc).font(fn).fontSize(7.5)
        .text(campo, ML + 2, curY + 4, { width: COL_CAMPO - 4, align: 'center' })
        .text(desc,   ML + COL_CAMPO + 3, curY + 4, { width: COL_DESC - 6 })
        .text(valor,  ML + COL_CAMPO + COL_DESC + 3, curY + 4, { width: COL_VAL - 6, align: 'right' });
      doc.fillColor('black');
      rowAlt = !rowAlt;
      curY += ROW_H;
    };

    const drawTotalRow = (campo, desc, valor) => {
      curY += 2;
      doc.rect(ML, curY, PW, ROW_H + 2).fillAndStroke('#1e40af', '#1e40af');
      doc.fillColor('white').font('Helvetica-Bold').fontSize(8)
        .text(campo, ML + 2, curY + 5, { width: COL_CAMPO - 4, align: 'center' })
        .text(desc,  ML + COL_CAMPO + 3, curY + 5, { width: COL_DESC - 6 })
        .text(valor, ML + COL_CAMPO + COL_DESC + 3, curY + 5, { width: COL_VAL - 6, align: 'right' });
      doc.fillColor('black');
      curY += ROW_H + 4;
      rowAlt = false;
    };

    // ── A. VENTAS ────────────────────────────────────────────────────────────
    drawSecHeader('A', 'VENTAS / INGRESOS');
    drawTblHeader();
    drawRow('', `Facturas emitidas autorizadas (${facturas.length} doc.)`, fmtM(facturas.reduce((s, f) => s + r2(f.importeTotal), 0)));
    if (liquidaciones.length > 0)
      drawRow('', `Liquidaciones de compra emitidas (${liquidaciones.length} doc.)`, fmtM(liquidaciones.reduce((s, l) => s + r2(l.importeTotal), 0)));
    drawRow('', 'Base tarifa 0% / no sujeto IVA', fmtM(vBase0));
    drawRow('', 'Base gravada (tarifa 15% y 5%)', fmtM(vBaseGrav));
    drawRow('429', 'IVA generado en ventas', fmtM(vIva));
    if (ncs.length > 0)
      drawRow('', `Notas de crédito emitidas (${ncs.length} doc.) — descuenta`, `(${fmtM(vNcTotal)})`);
    drawTotalRow('419', 'TOTAL VENTAS NETAS', fmtM(vNeto));

    // ── B. COMPRAS ───────────────────────────────────────────────────────────
    drawSecHeader('B', 'ADQUISICIONES / COMPRAS');
    drawTblHeader();
    drawRow('', `Facturas de compra registradas (${compras.length} doc.)`, fmtM(cTotal));
    drawRow('', 'Base tarifa 0% / no sujeto IVA', fmtM(cBase0));
    drawRow('', 'Base gravada (tarifa 15% y 5%)', fmtM(cBaseGrav));
    drawRow('563', 'IVA en adquisiciones', fmtM(cIva));
    drawRow('', 'Retención IR recibida en compras', fmtM(cRetIR));
    drawRow('564', 'Retención IVA recibida (crédito trib. IVA)', fmtM(cRetIva));
    drawTotalRow('509', 'TOTAL ADQUISICIONES', fmtM(cTotal));

    // ── C. AGENTE DE RETENCIÓN ───────────────────────────────────────────────
    drawSecHeader('C', 'AGENTE DE RETENCIÓN (retenciones emitidas)');
    drawTblHeader();
    drawRow('', `Comprobantes de retención emitidos (${retenciones.length} doc.)`, '');
    if (retPctOrdenados.length > 0) {
      retPctOrdenados.forEach(([pct, val]) => {
        drawRow('721', `Retención IVA al ${pct}%`, fmtM(val));
      });
    } else {
      drawRow('', 'Sin retenciones IVA emitidas en el período', '-');
    }
    drawRow('799-IR', 'Total retenciones IR emitidas', fmtM(totalRetIrEmitido));
    drawTotalRow('799', 'TOTAL RETENCIONES IVA EMITIDAS', fmtM(totalRetIvaPorPct));

    // ── D. LIQUIDACIÓN IVA ───────────────────────────────────────────────────
    drawSecHeader('D', 'LIQUIDACIÓN DEL IVA');
    drawTblHeader();
    const saldo = vIva - cIva;
    drawRow('429', 'IVA generado en ventas', fmtM(vIva));
    drawRow('564', '(-) Crédito tributario en adquisiciones', `(${fmtM(cIva)})`);
    drawTotalRow(
      saldo >= 0 ? '601' : '602',
      saldo >= 0 ? 'IMPUESTO CAUSADO' : 'CRÉDITO TRIBUTARIO SIGUIENTE PERÍODO',
      fmtM(Math.abs(saldo)),
    );

    // ── Footer ───────────────────────────────────────────────────────────────
    curY += 4;
    doc.rect(ML, curY, PW, 18).fillAndStroke('#f1f5f9', '#e2e8f0');
    doc.fontSize(6.5).font('Helvetica').fillColor('#64748b')
      .text(
        `Generado: ${new Date().toLocaleString('es-EC')}  |  AELA ERP  |  Solo para uso informativo — el archivo XML del ATS es el documento oficial`,
        ML + 4, curY + 5, { width: PW - 8, align: 'center' },
      );

    doc.end();
  } catch (err) {
    console.error('[ATS pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
