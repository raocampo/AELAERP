// ====================================
// RUTAS: ATS — ANEXO TRANSACCIONAL SIMPLIFICADO
// backend/routes/ats.js
// ====================================

const express = require('express');
const router  = express.Router();
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');

router.use(proteger);
router.use(soloFull);
router.use(requiereModulo('atsHabilitado'));
router.use(autorizarPermiso('tributario.reportes'));

// ─── Helper: nombre del mes en español ───────────────────────────────────────
const MESES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ─── Helper: rango de fechas de un período ────────────────────────────────────
function rangoPeriodo(mes, anio) {
  const desde = new Date(anio, mes - 1, 1);
  const hasta = new Date(anio, mes, 0, 23, 59, 59, 999); // último día del mes
  return { desde, hasta };
}

// ─── Helper: formatear fecha DD/MM/YYYY ──────────────────────────────────────
function fmtFecha(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

// ─── Helper: obtener config SRI activa ───────────────────────────────────────
async function getConfigSRI(empresaId) {
  const config = await prisma.configuracion_sri.findFirst({
    where: { empresaId, activo: true },
  });
  if (!config) throw new Error('No hay configuración SRI configurada.');
  return config;
}

// ─── GET /preview — Resumen JSON del período ──────────────────────────────────
router.get('/preview', async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoPeriodo(mes, anio);

    const where = { estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } };

    const [facturas, liquidaciones, retenciones] = await Promise.all([
      prisma.facturas.findMany({
        where,
        select: {
          id: true, numeroFactura: true, fechaEmision: true,
          tipoIdentificacionComprador: true, identificacionComprador: true,
          razonSocialComprador: true,
          subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
          estadoSri: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      prisma.liquidaciones_compra.findMany({
        where,
        select: {
          id: true, numeroLiquidacion: true, fechaEmision: true,
          tipoIdentificacionProveedor: true, identificacionProveedor: true,
          razonSocialProveedor: true,
          subtotal0: true, subtotal15: true, totalIva: true, importeTotal: true,
          estadoSri: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
      prisma.retenciones.findMany({
        where,
        select: {
          id: true, numeroRetencion: true, fechaEmision: true,
          tipoIdentificacionProveedor: true, identificacionProveedor: true,
          razonSocialProveedor: true,
          totalRetenido: true, estadoSri: true, impuestos: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
    ]);

    const sumar = (arr, campo) => arr.reduce((s, r) => s + parseFloat(r[campo] || 0), 0);

    const totales = {
      totalVentasFacturas:      sumar(facturas, 'importeTotal'),
      totalVentasLiquidaciones: sumar(liquidaciones, 'importeTotal'),
      totalRetenciones:         sumar(retenciones, 'totalRetenido'),
      totalDocumentos:          facturas.length + liquidaciones.length + retenciones.length,
    };

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes]} ${anio}` },
        facturas,
        liquidaciones,
        retenciones,
        totales,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /exportar — Descarga el XML ATS del período ─────────────────────────
router.get('/exportar', async (req, res) => {
  try {
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoPeriodo(mes, anio);

    const config = await getConfigSRI(req.empresa.id);
    const where  = { estadoSri: 'AUTORIZADO', fechaEmision: { gte: desde, lte: hasta } };

    const [facturas, liquidaciones, retenciones] = await Promise.all([
      prisma.facturas.findMany({ where, orderBy: { secuencial: 'asc' } }),
      prisma.liquidaciones_compra.findMany({ where, orderBy: { secuencial: 'asc' } }),
      prisma.retenciones.findMany({ where, orderBy: { secuencial: 'asc' } }),
    ]);

    // ── Calcular totalVentas ─────────────────────────────────────────────────
    const totalVentas = [
      ...facturas.map(f => parseFloat(f.importeTotal || 0)),
      ...liquidaciones.map(l => parseFloat(l.importeTotal || 0)),
    ].reduce((s, v) => s + v, 0);

    // ── Agrupar ventas (facturas) por cliente y tipo comprobante ─────────────
    // Mapa: `${tpId}|${id}|${tipoCbte}` → acumuladores
    const ventasMap = new Map();

    const acumularVenta = (tpId, idCliente, tipoCbte, row) => {
      const key = `${tpId}|${idCliente}|${tipoCbte}`;
      if (!ventasMap.has(key)) {
        ventasMap.set(key, {
          tpIdCliente: tpId, idCliente, tipoComprobante: tipoCbte,
          count: 0, baseNoGraIva: 0, baseImponible: 0, baseImpGrav: 0,
          montoIva: 0,
        });
      }
      const e = ventasMap.get(key);
      e.count++;
      e.baseImponible += parseFloat(row.subtotal0  || 0);
      e.baseImpGrav   += parseFloat(row.subtotal15 || 0);
      e.montoIva      += parseFloat(row.totalIva   || 0);
    };

    facturas.forEach(f => acumularVenta(
      f.tipoIdentificacionComprador, f.identificacionComprador, '01', f
    ));
    liquidaciones.forEach(l => acumularVenta(
      l.tipoIdentificacionProveedor, l.identificacionProveedor, '03', l
    ));

    // ── Construir XML ────────────────────────────────────────────────────────
    const mesPad = String(mes).padStart(2, '0');

    // Sección <ventas>
    let ventasXML = '';
    ventasMap.forEach(v => {
      ventasXML += `
    <detalleVentas>
      <tpIdCliente>${v.tpIdCliente}</tpIdCliente>
      <idCliente>${v.idCliente}</idCliente>
      <parteRel>NO</parteRel>
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

    // Sección <compras> (una entrada por retención)
    let comprasXML = '';
    retenciones.forEach(ret => {
      const impuestos = typeof ret.impuestos === 'string'
        ? JSON.parse(ret.impuestos)
        : (ret.impuestos || []);

      const impRenta = impuestos.filter(i => String(i.codigo) === '1');
      const impIva   = impuestos.filter(i => String(i.codigo) === '2');

      const baseIR  = impRenta.reduce((s, i) => s + parseFloat(i.baseImponible || 0), 0);
      const baseIVA = impIva.reduce((s, i) => s + parseFloat(i.baseImponible || 0), 0);
      const totIva  = impIva.reduce((s, i) => s + parseFloat(i.valorRetenido || 0), 0);

      // Detalles AIR (retenciones IR)
      let airXML = '';
      impRenta.forEach(i => {
        airXML += `
        <detalleAir>
          <codRetAir>${i.codigoPorcentaje}</codRetAir>
          <baseImpAir>${parseFloat(i.baseImponible || 0).toFixed(2)}</baseImpAir>
          <porcentajeAir>${parseFloat(i.porcentajeRetener || 0).toFixed(2)}</porcentajeAir>
          <valRetAir>${parseFloat(i.valorRetenido || 0).toFixed(2)}</valRetAir>
        </detalleAir>`;
      });

      // periodoFiscal: MM/YYYY → MMYYYY
      const periodoATS = (ret.periodoFiscal || `${mesPad}/${anio}`).replace('/', '');
      const secPad = String(ret.secuencial).padStart(9, '0');
      const estab  = String(config.establecimiento || '001').padStart(3, '0');
      const ptoEmi = String(config.puntoEmision   || '001').padStart(3, '0');

      comprasXML += `
    <detalleCompras>
      <codSustento>${ret.tipoDocSustento || '01'}</codSustento>
      <tpIdProv>${ret.tipoIdentificacionProveedor}</tpIdProv>
      <idProv>${ret.identificacionProveedor}</idProv>
      <periodoFiscal>${periodoATS}</periodoFiscal>
      <fechaRegistro>${fmtFecha(ret.fechaEmision)}</fechaRegistro>
      <establecimiento>${estab}</establecimiento>
      <puntoEmision>${ptoEmi}</puntoEmision>
      <secuencial>${secPad}</secuencial>
      <fechaEmisionDoc>${fmtFecha(ret.fechaEmision)}</fechaEmisionDoc>
      <autorizacion>${ret.numeroAutorizacion || ''}</autorizacion>
      <baseNoGraIva>0.00</baseNoGraIva>
      <baseImponible>${baseIR.toFixed(2)}</baseImponible>
      <baseImpGrav>${baseIVA.toFixed(2)}</baseImpGrav>
      <montoIce>0.00</montoIce>
      <montoIva>${totIva.toFixed(2)}</montoIva>
      <valRetBien10>0.00</valRetBien10>
      <valRetServ20>0.00</valRetServ20>
      <valorRetBienes>0.00</valorRetBienes>
      <valRetServ50>0.00</valRetServ50>
      <valorRetServicios>0.00</valorRetServicios>
      <valRetServ100>0.00</valRetServ100>
      <totbasesImpReemb>0.00</totbasesImpReemb>
      <air>${airXML}
      </air>
    </detalleCompras>`;
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
</ats>`;

    const filename = `ats_${config.ruc}_${anio}${mesPad}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xmlATS);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
