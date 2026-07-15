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
const { CODIGOS_RETENCION_RENTA } = require('../utils/sri');

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
    const [facturas, liquidaciones, retenciones, compras, ncs, anuladosFacturas, retencionesRecibidas] = await Promise.all([
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
      // Retenciones recibidas de clientes (del buzón SRI)
      prisma.retenciones_recibidas.findMany({
        where: { empresaId, anulada: false, fechaEmision: { gte: desde, lte: hasta } },
        select: {
          id: true, rucAgente: true, razonSocialAgente: true, fechaEmision: true,
          numDocSustento: true, totalRetencionIva: true, totalRetencionRenta: true,
        },
        orderBy: { fechaEmision: 'asc' },
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
      totalRetIvaRecibida:       sumar(retencionesRecibidas, 'totalRetencionIva'),
      totalRetIrRecibida:        sumar(retencionesRecibidas, 'totalRetencionRenta'),
      docRetencionesRecibidas:   retencionesRecibidas.length,
    };

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes]} ${anio}` },
        facturas, liquidaciones, retenciones, compras, ncs,
        anulados: anuladosFacturas,
        retencionesRecibidas,
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
    const periodoLabel = `${mesPad}-${anio}`;

    const periodoWhere = { fechaEmision: { gte: desde, lte: hasta } };

    const [facturas, liquidaciones, compras, ncs, retenciones, anuladosFacturas, retencionesRecibidas] = await Promise.all([
      prisma.facturas.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere } }),
      prisma.liquidaciones_compra.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere } }),
      prisma.facturas_compra.findMany({
        where: { empresaId, anulada: false, ...periodoWhere },
        include: { retenciones: { where: { anulada: false } } },
      }),
      prisma.notas_credito.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } } }),
      prisma.retenciones.findMany({ where: { empresaId, estadoSri: 'AUTORIZADO', anulada: false, ...periodoWhere } }),
      prisma.facturas.findMany({ where: { empresaId, anulada: true, ...periodoWhere }, select: { id: true } }),
      prisma.retenciones_recibidas.findMany({
        where: { empresaId, anulada: false, fechaEmision: { gte: desde, lte: hasta } },
        select: { totalRetencionIva: true, totalRetencionRenta: true },
      }),
    ]);

    // ── Totales por tipo de comprobante ───────────────────────────────────────
    const vFact = { n: facturas.length,     b0: 0, bt: 0, iva: 0 };
    const vLiq  = { n: liquidaciones.length, b0: 0, bt: 0, iva: 0 };
    const vNcEm = { n: ncs.length,           b0: 0, bt: 0, iva: 0 };
    facturas.forEach(f => { vFact.b0 += r2(f.subtotal0); vFact.bt += r2(f.subtotal15) + r2(f.subtotal5 || 0); vFact.iva += r2(f.totalIva); });
    liquidaciones.forEach(l => { vLiq.b0 += r2(l.subtotal0); vLiq.bt += r2(l.subtotal15); vLiq.iva += r2(l.totalIva); });
    ncs.forEach(n => { vNcEm.bt -= r2(n.totalSinImpuestos); vNcEm.iva -= r2(n.totalIva); });
    const vTotN = vFact.n + vLiq.n + vNcEm.n;
    const vTotB0 = vFact.b0 + vLiq.b0;
    const vTotBt = vFact.bt + vLiq.bt;
    const vTotIva = vFact.iva + vLiq.iva;

    const cFact = { n: compras.length, b0: 0, bt: 0, iva: 0 };
    compras.forEach(c => { cFact.b0 += r2(c.subtotal0); cFact.bt += r2(c.subtotal15) + r2(c.subtotal5 || 0); cFact.iva += r2(c.totalIva); });

    // ── Retenciones IR por código SRI (303, 307, …) ───────────────────────────
    const retIrPorCod = {};
    retenciones.forEach(ret => {
      const imps = Array.isArray(ret.impuestos) ? ret.impuestos
        : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
      imps.filter(i => String(i.codigo) === '1').forEach(i => {
        const cod = String(i.codigoPorcentaje || '000');
        if (!retIrPorCod[cod]) retIrPorCod[cod] = {
          n: 0, base: 0, valor: 0,
          concepto: (CODIGOS_RETENCION_RENTA[cod]?.descripcion || `Retención código ${cod}`).toUpperCase(),
        };
        retIrPorCod[cod].n++;
        retIrPorCod[cod].base  += r2(i.baseImponible);
        retIrPorCod[cod].valor += r2(i.valorRetenido);
      });
    });
    const retIrCodigos  = Object.entries(retIrPorCod).sort((a, b) => a[0].localeCompare(b[0]));
    const totalRetIr    = retIrCodigos.reduce((s, [, v]) => s + v.valor, 0);
    const totalRetIrN   = retIrCodigos.reduce((s, [, v]) => s + v.n, 0);
    const totalRetIrBase = retIrCodigos.reduce((s, [, v]) => s + v.base, 0);

    // ── Retenciones IVA por porcentaje ────────────────────────────────────────
    const retIvaPorPct = {};
    retenciones.forEach(ret => {
      const imps = Array.isArray(ret.impuestos) ? ret.impuestos
        : (typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : []);
      imps.filter(i => String(i.codigo) === '2').forEach(i => {
        const pct = String(parseFloat(i.porcentajeRetener || 0));
        retIvaPorPct[pct] = (retIvaPorPct[pct] || 0) + r2(i.valorRetenido);
      });
    });
    const retIvaPcts      = Object.entries(retIvaPorPct).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
    const totalRetIvaEmit = retIvaPcts.reduce((s, [, v]) => s + v, 0);

    // ── Retenciones recibidas de clientes ─────────────────────────────────────
    const totalRetIvaRecib = retencionesRecibidas.reduce((s, r) => s + r2(r.totalRetencionIva), 0);
    const totalRetIrRecib  = retencionesRecibidas.reduce((s, r) => s + r2(r.totalRetencionRenta), 0);

    // ── PDFKit ────────────────────────────────────────────────────────────────
    const doc = new PDFDocument({ size: 'A4', margins: { top: 30, bottom: 30, left: 36, right: 36 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="talonATS_${anio}${mesPad}.pdf"`);
    doc.pipe(res);

    const ML = 36, PW = 595 - 72;
    const n2       = (v) => Number(v).toFixed(2);
    const SRI_BLUE = '#003087';
    const HDR_BG   = '#1f3a6e';
    const SUB_BG   = '#2e5fa3';
    const ALT_BG   = '#f0f4fa';
    const ROW_H    = 14;

    // ── Cabecera ──────────────────────────────────────────────────────────────
    doc.rect(ML, 30, 86, 52).fillAndStroke(SRI_BLUE, SRI_BLUE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(5.5)
      .text('SERVICIO DE RENTAS INTERNAS', ML + 1, 36, { width: 84, align: 'center' });
    doc.fontSize(17).text('SRI', ML + 1, 45, { width: 84, align: 'center' });
    doc.fontSize(5).text('...le hace bien al país!', ML + 1, 72, { width: 84, align: 'center' });
    doc.fillColor(SRI_BLUE).font('Helvetica-Bold')
      .fontSize(10).text('TALÓN RESUMEN', ML + 92, 33, { width: PW - 92, align: 'center' })
      .fontSize(9).text('SERVICIO DE RENTAS INTERNAS', ML + 92, 46, { width: PW - 92, align: 'center' })
      .fontSize(9).text('ANEXO TRANSACCIONAL', ML + 92, 58, { width: PW - 92, align: 'center' });
    doc.fillColor('black');

    const eY = 88;
    doc.rect(ML, eY, PW, 14).fillAndStroke('#f8fafc', '#cbd5e1');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(7.5)
      .text(config.razonSocial || '—', ML + 4, eY + 3, { width: PW - 8, align: 'center' });
    doc.rect(ML, eY + 14, PW, 12).stroke('#cbd5e1');
    doc.font('Helvetica').fontSize(7)
      .text(`RUC: ${config.ruc || '—'}`, ML + 4, eY + 17)
      .text(`Período: ${periodoLabel}    Fecha de generación: ${new Date().toLocaleString('es-EC')}`,
        ML + PW / 3, eY + 17, { width: PW * 2 / 3, align: 'right' });

    let curY = eY + 32;
    doc.fontSize(7).font('Helvetica').fillColor('#1e293b')
      .text(
        `Certifico que la información contenida en el medio magnético del Anexo Transaccional para el período ${periodoLabel}, es fiel reflejo del siguiente reporte:`,
        ML, curY, { width: PW },
      );
    curY += 22;

    // ── Helpers ───────────────────────────────────────────────────────────────
    let rowAlt = false;

    const pgCheck = (needed = ROW_H * 3) => {
      if (curY + needed > 800) { doc.addPage(); curY = 30; rowAlt = false; }
    };

    const secHdr = (title) => {
      pgCheck(ROW_H * 5);
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(HDR_BG, HDR_BG);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5)
        .text(title, ML + 4, curY + 3, { width: PW - 8, align: 'center' });
      doc.fillColor('black');
      curY += ROW_H;
      rowAlt = false;
    };

    const subHdr = (title) => {
      pgCheck(ROW_H * 4);
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(SUB_BG, SUB_BG);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(7)
        .text(title, ML + 4, curY + 3, { width: PW - 8, align: 'center' });
      doc.fillColor('black');
      curY += ROW_H;
    };

    const colHdr = (cols) => {
      pgCheck();
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke('#dbeafe', '#93c5fd');
      let x = ML;
      cols.forEach((c, i) => {
        if (i > 0) doc.moveTo(x, curY).lineTo(x, curY + ROW_H).lineWidth(0.4).stroke('#93c5fd').lineWidth(1);
        doc.fillColor(SRI_BLUE).font('Helvetica-Bold').fontSize(6.5)
          .text(c.t, x + 2, curY + 3, { width: c.w - 4, align: c.a || 'center' });
        x += c.w;
      });
      curY += ROW_H;
    };

    const dataRow = (cols, values, bold = false) => {
      pgCheck();
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(rowAlt ? ALT_BG : '#ffffff', '#e2e8f0');
      let x = ML;
      values.forEach((v, i) => {
        const c = cols[i];
        if (i > 0) doc.moveTo(x, curY + 1).lineTo(x, curY + ROW_H - 1).lineWidth(0.3).stroke('#cbd5e1').lineWidth(1);
        doc.fillColor(bold ? SRI_BLUE : '#1e293b').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5)
          .text(String(v ?? ''), x + 2, curY + 3, { width: c.w - 4, align: c.a || 'left' });
        x += c.w;
      });
      doc.fillColor('black');
      rowAlt = !rowAlt;
      curY += ROW_H;
    };

    const totRow = (cols, values) => {
      pgCheck();
      curY += 1;
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(HDR_BG, HDR_BG);
      let x = ML;
      values.forEach((v, i) => {
        const c = cols[i];
        doc.fillColor('white').font('Helvetica-Bold').fontSize(7)
          .text(String(v ?? ''), x + 2, curY + 3, { width: c.w - 4, align: c.a || 'left' });
        x += c.w;
      });
      doc.fillColor('black');
      curY += ROW_H + 2;
      rowAlt = false;
    };

    // ── COMPRAS (por tipo de comprobante) ─────────────────────────────────────
    const tc = [
      { t: 'Cod.',            w: 28,  a: 'center' },
      { t: 'Transacción',     w: 130, a: 'left'   },
      { t: 'No. Registros',   w: 52,  a: 'right'  },
      { t: 'BI Tarifa 0%',    w: 78,  a: 'right'  },
      { t: 'BI Tarifa',       w: 78,  a: 'right'  },
      { t: 'BI No Obj. IVA',  w: 78,  a: 'right'  },
      { t: 'Valor IVA',       w: 79,  a: 'right'  },
    ];
    secHdr('COMPRAS');
    colHdr(tc);
    if (compras.length > 0)
      dataRow(tc, ['01', 'FACTURA', compras.length, n2(cFact.b0), n2(cFact.bt), '0.00', n2(cFact.iva)]);
    dataRow(tc, ['TOTAL', '', compras.length, n2(cFact.b0), n2(cFact.bt), '0.00', n2(cFact.iva)], true);
    curY += 4;

    // ── VENTAS (por tipo de comprobante) ──────────────────────────────────────
    secHdr('VENTAS');
    colHdr(tc);
    if (facturas.length > 0)
      dataRow(tc, ['01', 'FACTURA', vFact.n, n2(vFact.b0), n2(vFact.bt), '0.00', n2(vFact.iva)]);
    if (liquidaciones.length > 0)
      dataRow(tc, ['03', 'LIQUIDACIÓN DE COMPRA', vLiq.n, n2(vLiq.b0), n2(vLiq.bt), '0.00', n2(vLiq.iva)]);
    if (ncs.length > 0)
      dataRow(tc, ['04', 'NOTA DE CRÉDITO', vNcEm.n, '0.00', n2(vNcEm.bt), '0.00', n2(vNcEm.iva)]);
    dataRow(tc, ['TOTAL', '', vTotN, n2(vTotB0), n2(vTotBt), '0.00', n2(vTotIva)], true);
    curY += 4;

    // ── COMPROBANTES ANULADOS ─────────────────────────────────────────────────
    pgCheck(ROW_H * 2);
    doc.rect(ML, curY, PW, ROW_H).fillAndStroke(HDR_BG, HDR_BG);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5)
      .text('COMPROBANTES ANULADOS', ML + 4, curY + 3, { width: PW - 8, align: 'center' });
    doc.fillColor('black');
    curY += ROW_H;
    doc.rect(ML, curY, PW, ROW_H).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#1e293b').font('Helvetica').fontSize(7)
      .text('Total de Comprobantes Anulados en el período informado (no incluye los dados de baja)', ML + 4, curY + 3, { width: PW - 70 })
      .font('Helvetica-Bold').text(String(anuladosFacturas.length), ML + PW - 60, curY + 3, { width: 56, align: 'right' });
    doc.fillColor('black');
    curY += ROW_H + 4;

    // ── RESUMEN DE RETENCIONES — AGENTE DE RETENCIÓN ──────────────────────────
    secHdr('RESUMEN DE RETENCIONES - AGENTE DE RETENCIÓN');

    const irC = [
      { t: 'Cod.',                   w: 40,  a: 'center' },
      { t: 'Concepto de Retención',  w: 228, a: 'left'   },
      { t: 'No. Registros',          w: 52,  a: 'right'  },
      { t: 'B. Imponible',           w: 101, a: 'right'  },
      { t: 'Valor retenido',         w: 102, a: 'right'  },
    ];
    subHdr('RETENCIÓN EN LA FUENTE DE IMPUESTO A LA RENTA');
    colHdr(irC);
    if (retIrCodigos.length > 0) {
      retIrCodigos.forEach(([cod, v]) => dataRow(irC, [cod, v.concepto, v.n, n2(v.base), n2(v.valor)]));
    } else {
      dataRow(irC, ['', 'Sin retenciones IR emitidas en el período', '', '', '0.00']);
    }
    totRow(irC, ['TOTAL', '', totalRetIrN, n2(totalRetIrBase), n2(totalRetIr)]);

    const ivaC = [
      { t: 'Operación',             w: 90,  a: 'center' },
      { t: 'Concepto de Retención', w: 333, a: 'left'   },
      { t: 'Valor retenido',        w: 100, a: 'right'  },
    ];
    subHdr('RETENCIÓN EN LA FUENTE DE IVA');
    colHdr(ivaC);
    if (retIvaPcts.length > 0) {
      retIvaPcts.forEach(([pct, val]) => dataRow(ivaC, ['COMPRA', `Retención IVA ${pct}%`, n2(val)]));
    } else {
      dataRow(ivaC, ['COMPRA', 'Sin retenciones IVA emitidas en el período', '0.00']);
    }
    totRow(ivaC, ['TOTAL', '', n2(totalRetIvaEmit)]);
    curY += 4;

    // ── RETENCIONES QUE LE EFECTUARON ────────────────────────────────────────
    const recC = [
      { t: 'Operación',                           w: 90,  a: 'center' },
      { t: 'Tipo de Retención que le efectuaron',  w: 333, a: 'left'   },
      { t: 'Valor retenido',                      w: 100, a: 'right'  },
    ];
    secHdr('RESUMEN DE RETENCIONES QUE LE EFECTUARON EN EL PERIODO');
    colHdr(recC);
    dataRow(recC, ['VENTA', 'Valor de IVA que le han retenido',   n2(totalRetIvaRecib)]);
    dataRow(recC, ['VENTA', 'Valor de Renta que le han retenido', n2(totalRetIrRecib)]);
    totRow(recC, ['TOTAL', '', n2(totalRetIvaRecib + totalRetIrRecib)]);
    curY += 8;

    // ── Declaración y firmas ──────────────────────────────────────────────────
    pgCheck(70);
    doc.fontSize(7).font('Helvetica').fillColor('#1e293b')
      .text(
        'Declaro que los datos contenidos en este anexo son verdaderos, por lo que asumo la responsabilidad correspondiente, de acuerdo a lo establecido en el Art. 101 de la Codificación de la Ley de Régimen Tributario Interno.',
        ML, curY, { width: PW },
      );
    curY += 30;
    pgCheck(40);
    const fw = (PW - 40) / 2;
    doc.moveTo(ML, curY + 20).lineTo(ML + fw, curY + 20).stroke('#1e293b');
    doc.moveTo(ML + fw + 40, curY + 20).lineTo(ML + PW, curY + 20).stroke('#1e293b');
    doc.fontSize(7).font('Helvetica').fillColor('#1e293b')
      .text('Firma del Contador', ML, curY + 23, { width: fw, align: 'center' })
      .text('Firma del Representante', ML + fw + 40, curY + 23, { width: fw, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[ATS pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
