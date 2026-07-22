// ====================================
// RUTAS: ATS — ANEXO TRANSACCIONAL SIMPLIFICADO
// backend/routes/ats.js
// ====================================

const express = require('express');
const router  = express.Router();
const path    = require('path');
const prisma  = require('../config/prisma');
const PDFDocument = require('pdfkit');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { soloFull } = require('../middleware/edition');
const { requiereModulo } = require('../middleware/modulos');
const { CODIGOS_RETENCION_RENTA, parsearNotaCreditoRecibidaXml } = require('../utils/sri');

const LOGO_SRI = path.join(__dirname, '../assets/LogoSRI.png');

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
    const config = await prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } });

    const periodoWhere = { fechaEmision: { gte: desde, lte: hasta } };
    const [facturas, liquidaciones, retenciones, compras, ncs, anuladosFacturas, retencionesRecibidas, notasVenta, ncsRecibidas] = await Promise.all([
      // Ventas: facturas emitidas autorizadas
      prisma.facturas.findMany({
        where: { empresaId, estadoSri: 'AUTORIZADO', ...periodoWhere },
        select: {
          id: true, numeroFactura: true, fechaEmision: true,
          tipoIdentificacionComprador: true, identificacionComprador: true,
          razonSocialComprador: true,
          subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true, importeTotal: true,
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
          subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true, importeTotal: true,
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
      // Ventas: notas de venta (RIMPE Negocio Popular) — sin IVA, código ATS 02.
      // Solo se consultan si la empresa está configurada como Negocio Popular.
      config?.negocioPopular
        ? prisma.notas_venta.findMany({
            where: { empresaId, anulada: false, ...periodoWhere },
            select: {
              id: true, numeroNota: true, fechaEmision: true,
              tipoIdentificacion: true, identificacion: true, razonSocial: true,
              subtotal: true, totalDescuento: true, total: true,
            },
            orderBy: { secuencial: 'asc' },
          })
        : Promise.resolve([]),
      // Notas de crédito RECIBIDAS de proveedores (tipo SRI 04, vía Buzón SRI) —
      // reducen el crédito fiscal de IVA y deben reportarse en <detalleCompras>.
      prisma.docs_recibidos_otros.findMany({
        where: { empresaId, tipoDocumento: '04', ...periodoWhere },
        select: {
          id: true, fechaEmision: true, razonSocialEmisor: true, rucEmisor: true,
          claveAcceso: true, importeTotal: true, xmlAutorizado: true,
        },
        orderBy: { fechaEmision: 'asc' },
      }),
    ]);

    const sumar = (arr, campo) => arr.reduce((s, r) => s + r2(r[campo]), 0);
    // No enviar xmlAutorizado (crudo, pesado) al frontend — solo el desglose
    // ya parseado que necesita para mostrar la tabla.
    const ncsRecibidasVista = ncsRecibidas.map(({ xmlAutorizado, ...nc }) => {
      const p = parsearNotaCreditoRecibidaXml(xmlAutorizado);
      return { ...nc, iva: p.iva, baseImponible: p.base0 + p.base5 + p.base12 + p.base15 + p.baseNoObjeto };
    });
    const totalNcRecibidasIva = ncsRecibidasVista.reduce((s, nc) => s + nc.iva, 0);

    const totales = {
      totalVentasFacturas:       sumar(facturas, 'importeTotal'),
      totalVentasLiquidaciones:  sumar(liquidaciones, 'importeTotal'),
      totalVentasNotasVenta:     sumar(notasVenta, 'total'),
      totalCompras:              sumar(compras, 'importeTotal'),
      totalRetenciones:          sumar(retenciones, 'totalRetenido'),
      docFacturas:               facturas.length,
      docLiquidaciones:          liquidaciones.length,
      docNotasVenta:             notasVenta.length,
      docCompras:                compras.length,
      docRetenciones:            retenciones.length,
      docNCs:                    ncs.length,
      docAnulados:               anuladosFacturas.length,
      totalRetIvaRecibida:       sumar(retencionesRecibidas, 'totalRetencionIva'),
      totalRetIrRecibida:        sumar(retencionesRecibidas, 'totalRetencionRenta'),
      docRetencionesRecibidas:   retencionesRecibidas.length,
      totalNcRecibidas:          sumar(ncsRecibidas, 'importeTotal'),
      totalNcRecibidasIva:       parseFloat(totalNcRecibidasIva.toFixed(2)),
      docNcRecibidas:            ncsRecibidas.length,
    };

    res.json({
      ok: true,
      data: {
        periodo: { mes, anio, label: `${MESES[mes]} ${anio}` },
        facturas, liquidaciones, retenciones, compras, ncs, notasVenta,
        anulados: anuladosFacturas,
        retencionesRecibidas,
        ncsRecibidas: ncsRecibidasVista,
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

    const [facturas, liquidaciones, compras, ncs, anuladosFacturas, notasVenta, ncsRecibidas] = await Promise.all([
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
      // Notas de venta (RIMPE Negocio Popular) — código ATS 02, sin desglose de IVA.
      config?.negocioPopular
        ? prisma.notas_venta.findMany({
            where: { empresaId, anulada: false, ...periodoWhere },
            orderBy: { secuencial: 'asc' },
          })
        : Promise.resolve([]),
      // Notas de crédito RECIBIDAS de proveedores (tipo SRI 04) — se reportan
      // como su propia entrada en <detalleCompras> (tipoComprobante 04).
      prisma.docs_recibidos_otros.findMany({
        where: { empresaId, tipoDocumento: '04', ...periodoWhere },
        orderBy: { fechaEmision: 'asc' },
      }),
    ]);

    // ── totalVentas ───────────────────────────────────────────────────────────
    const totalVentas = [
      ...facturas.map(f => r2(f.importeTotal)),
      ...liquidaciones.map(l => r2(l.importeTotal)),
      ...ncs.map(n => r2(n.importeTotal)),
      ...notasVenta.map(n => r2(n.total)),
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
      e.baseImpGrav   += r2((row.subtotal5 || 0) + (row.subtotal12 || 0) + (row.subtotal15 || 0));
      e.montoIva      += r2(row.totalIva   || 0);
    };

    facturas.forEach(f => acumularVenta(f.tipoIdentificacionComprador, f.identificacionComprador, '01', f));
    liquidaciones.forEach(l => acumularVenta(l.tipoIdentificacionProveedor, l.identificacionProveedor, '03', l));
    // Notas de venta RIMPE: sin desglose de IVA (diseño del sistema — ver
    // FormNotaVenta.jsx), se reportan como base imponible tarifa 0%.
    notasVenta.forEach(n => acumularVenta(n.tipoIdentificacion, n.identificacion, '02', { subtotal0: n.total, totalIva: 0 }));
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
      // Nota: valores SIEMPRE positivos — monedaType del XSD del SRI exige
      // minInclusive 0.0. El signo/efecto de la NC lo determina el SRI a
      // partir de tipoComprobante='04', no un valor negativo en el campo.
      e.baseImpGrav += r2(n.totalSinImpuestos || 0);
      e.montoIva    += r2(n.totalIva || 0);
    });

    let ventasXML = '';
    ventasMap.forEach(v => {
      ventasXML += `
    <detalleVentas>
      <tpIdCliente>${v.tpIdCliente}</tpIdCliente>
      <idCliente>${v.idCliente}</idCliente>
      <parteRelVtas>NO</parteRelVtas>
      <tipoCliente>01</tipoCliente>
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

      const baseGravada = r2((compra.subtotal5 || 0) + (compra.subtotal12 || 0) + (compra.subtotal15 || 0));
      const base0 = r2(compra.subtotal0 || 0);
      const baseNoObjeto = r2(compra.subtotalNoObjeto || 0);
      const baseExenta = r2(compra.subtotalExento || 0);
      const esNotaVenta = compra.tipoComprobante === 'NOTA_VENTA';
      // Nota de Venta (proveedor RIMPE Negocio Popular): sin derecho a crédito
      // tributario de IVA — codSustento 02 (Costo o Gasto), no 01.
      const codSustento = esNotaVenta ? '02' : (compra.tipoGasto === 'ACTIVO_FIJO' ? '03' : '01');

      comprasXML += `
    <detalleCompras>
      <codSustento>${codSustento}</codSustento>
      <tpIdProv>${tpId}</tpIdProv>
      <idProv>${compra.identificacionProveedor}</idProv>
      <tipoComprobante>${esNotaVenta ? '02' : '01'}</tipoComprobante>
      <parteRel>NO</parteRel>
      <fechaRegistro>${fmtFecha(compra.createdAt || compra.fechaEmision)}</fechaRegistro>
      <establecimiento>${estab}</establecimiento>
      <puntoEmision>${pto}</puntoEmision>
      <secuencial>${sec}</secuencial>
      <fechaEmision>${fmtFecha(compra.fechaEmision)}</fechaEmision>
      <autorizacion>${auth}</autorizacion>
      <baseNoGraIva>${baseNoObjeto.toFixed(2)}</baseNoGraIva>
      <baseImponible>${base0.toFixed(2)}</baseImponible>
      <baseImpGrav>${baseGravada.toFixed(2)}</baseImpGrav>
      <baseImpExe>${baseExenta.toFixed(2)}</baseImpExe>
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

    // ── <compras> — notas de crédito RECIBIDAS de proveedores (tipo 04) ──────
    // Cada NC es su propia entrada en detalleCompras, con valores SIEMPRE
    // positivos (monedaType del XSD exige minInclusive 0.0) y referenciando el
    // documento original vía docModificado/estabModificado/ptoEmiModificado/
    // secModificado — confirmado contra el XSD oficial del SRI (ats.xsd,
    // detalleComprasType). autModificado se omite: el XML de la NC recibida
    // solo trae el establecimiento-punto-secuencial del original
    // (numDocModificado), no su clave de acceso de 49 dígitos — el campo es
    // opcional (minOccurs=0) en el XSD.
    ncsRecibidas.forEach((nc) => {
      const p = parsearNotaCreditoRecibidaXml(nc.xmlAutorizado);
      const modif = parseNumero(p.numDocModificado);
      comprasXML += `
    <detalleCompras>
      <codSustento>01</codSustento>
      <tpIdProv>04</tpIdProv>
      <idProv>${nc.rucEmisor}</idProv>
      <tipoComprobante>04</tipoComprobante>
      <parteRel>NO</parteRel>
      <fechaRegistro>${fmtFecha(nc.createdAt || nc.fechaEmision)}</fechaRegistro>
      <establecimiento>${p.estab}</establecimiento>
      <puntoEmision>${p.ptoEmi}</puntoEmision>
      <secuencial>${p.secuencial}</secuencial>
      <fechaEmision>${fmtFecha(nc.fechaEmision)}</fechaEmision>
      <autorizacion>${p.claveAcceso || nc.claveAcceso || ''}</autorizacion>
      <baseNoGraIva>${p.baseNoObjeto.toFixed(2)}</baseNoGraIva>
      <baseImponible>${p.base0.toFixed(2)}</baseImponible>
      <baseImpGrav>${p.baseGravada.toFixed(2)}</baseImpGrav>
      <baseImpExe>${p.baseExenta.toFixed(2)}</baseImpExe>
      <montoIce>0.00</montoIce>
      <montoIva>${p.iva.toFixed(2)}</montoIva>
      <valRetBien10>0.00</valRetBien10>
      <valRetServ20>0.00</valRetServ20>
      <valorRetBienes>0.00</valorRetBienes>
      <valRetServ50>0.00</valRetServ50>
      <valorRetServicios>0.00</valorRetServicios>
      <valRetServ100>0.00</valRetServ100>
      <totbasesImpReemb>0.00</totbasesImpReemb>
      <docModificado>${p.codDocModificado}</docModificado>
      <estabModificado>${modif.estab}</estabModificado>
      <ptoEmiModificado>${modif.pto}</ptoEmiModificado>
      <secModificado>${modif.sec}</secModificado>
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

    // Elemento raíz correcto según el XSD oficial del SRI (ats.xsd): declara
    // globalmente <xsd:element name="iva" type="ivaType" /> — NO "<ats>".
    // Confirmado validando este XML contra el XSD real antes de este fix.
    const xmlATS = `<?xml version="1.0" encoding="UTF-8"?>
<iva>
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
</iva>`;

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

    const [facturas, liquidaciones, compras, ncs, retenciones, anuladosFacturas, retencionesRecibidas, notasVenta, ncsRecibidas] = await Promise.all([
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
      // Notas de venta (RIMPE Negocio Popular) — solo si la empresa está
      // configurada como tal en Configuración SRI.
      config?.negocioPopular
        ? prisma.notas_venta.findMany({ where: { empresaId, anulada: false, ...periodoWhere } })
        : Promise.resolve([]),
      // Notas de crédito RECIBIDAS de proveedores (tipo SRI 04).
      prisma.docs_recibidos_otros.findMany({ where: { empresaId, tipoDocumento: '04', ...periodoWhere } }),
    ]);

    // ── Totales por tipo de comprobante (separando 5%, 12% y 15%) ────────────
    const vFact = { n: facturas.length,      b0: 0, bt5: 0, bt12: 0, bt15: 0, iva5: 0, iva12: 0, iva15: 0 };
    const vLiq  = { n: liquidaciones.length, b0: 0, bt5: 0, bt12: 0, bt15: 0, iva5: 0, iva12: 0, iva15: 0 };
    const vNcEm = { n: ncs.length,           b0: 0, bt5: 0, bt12: 0, bt15: 0, iva5: 0, iva12: 0, iva15: 0 };
    // Notas de venta RIMPE: sin desglose de IVA (diseño del sistema), se
    // reportan íntegramente como base 0%.
    const vNV   = { n: notasVenta.length,    b0: r2(notasVenta.reduce((s, n) => s + r2(n.total), 0)) };
    facturas.forEach(f => {
      vFact.b0    += r2(f.subtotal0);
      vFact.bt5   += r2(f.subtotal5 || 0);
      vFact.bt12  += r2(f.subtotal12 || 0);
      vFact.bt15  += r2(f.subtotal15);
      vFact.iva5  += r2((f.subtotal5 || 0) * 0.05);
      vFact.iva12 += r2((f.subtotal12 || 0) * 0.12);
      vFact.iva15 += r2(f.subtotal15 * 0.15);
    });
    liquidaciones.forEach(l => {
      vLiq.b0    += r2(l.subtotal0);
      vLiq.bt5   += r2(l.subtotal5 || 0);
      vLiq.bt12  += r2(l.subtotal12 || 0);
      vLiq.bt15  += r2(l.subtotal15);
      vLiq.iva5  += r2((l.subtotal5 || 0) * 0.05);
      vLiq.iva12 += r2((l.subtotal12 || 0) * 0.12);
      vLiq.iva15 += r2(l.subtotal15 * 0.15);
    });
    ncs.forEach(n => { vNcEm.bt15 -= r2(n.totalSinImpuestos); vNcEm.iva15 -= r2(n.totalIva); });
    const vTotN    = vFact.n + vLiq.n + vNcEm.n + vNV.n;
    const vTotB0   = vFact.b0 + vLiq.b0 + vNV.b0;
    const vTotBt5  = vFact.bt5 + vLiq.bt5;
    const vTotBt12 = vFact.bt12 + vLiq.bt12;
    const vTotBt15 = vFact.bt15 + vLiq.bt15 + vNcEm.bt15;
    const vTotIva5  = vFact.iva5 + vLiq.iva5;
    const vTotIva12 = vFact.iva12 + vLiq.iva12;
    const vTotIva15 = vFact.iva15 + vLiq.iva15 + vNcEm.iva15;

    // Compras: separar Factura (01) de Nota de Venta (02, proveedor RIMPE
    // Negocio Popular — sin crédito tributario de IVA).
    const comprasFactura   = compras.filter(c => c.tipoComprobante !== 'NOTA_VENTA');
    const comprasNotaVenta = compras.filter(c => c.tipoComprobante === 'NOTA_VENTA');
    // "No Obj." del talón combina No objeto + Exenta (dos casilleros legales
    // distintos, ver subtotalExento) por espacio de columna en el PDF — el XML
    // real (/exportar) sí las reporta por separado en baseNoGraIva/baseImpExe.
    const sumarCompras = (arr) => arr.reduce((acc, c) => {
      acc.n++;
      acc.b0    += r2(c.subtotal0);
      acc.bt5   += r2(c.subtotal5 || 0);
      acc.bt12  += r2(c.subtotal12 || 0);
      acc.bt15  += r2(c.subtotal15);
      acc.noObj += r2(c.subtotalNoObjeto || 0) + r2(c.subtotalExento || 0);
      acc.iva5  += r2((c.subtotal5 || 0) * 0.05);
      acc.iva12 += r2((c.subtotal12 || 0) * 0.12);
      acc.iva15 += r2(c.subtotal15 * 0.15);
      return acc;
    }, { n: 0, b0: 0, bt5: 0, bt12: 0, bt15: 0, noObj: 0, iva5: 0, iva12: 0, iva15: 0 });
    const cFact = sumarCompras(comprasFactura);
    const cNV   = sumarCompras(comprasNotaVenta);

    // Notas de crédito RECIBIDAS de proveedores — fila propia '04 NOTA DE
    // CRÉDITO', restada del total de COMPRAS (misma convención ya usada para
    // notas de crédito EMITIDAS en la sección VENTAS más abajo). El XML del
    // ATS (/exportar) sí reporta esta NC con valores positivos, como exige el
    // XSD del SRI — esta resta es solo para que el TOTAL del talón refleje el
    // neto real a declarar.
    // Nota: acumulados en NEGATIVO a propósito (misma convención que vNcEm más
    // abajo) para que la fila se muestre como resta y el TOTAL se calcule
    // simplemente sumando todas las filas de la sección.
    const cNcRec = ncsRecibidas.reduce((acc, nc) => {
      const p = parsearNotaCreditoRecibidaXml(nc.xmlAutorizado);
      acc.n++;
      acc.b0    -= p.base0;
      acc.bt5   -= p.base5;
      acc.bt12  -= p.base12;
      acc.bt15  -= p.base15;
      acc.noObj -= (p.baseNoObjeto + p.baseExenta);
      acc.iva5  -= p.base5 * 0.05;
      acc.iva12 -= p.base12 * 0.12;
      acc.iva15 -= p.base15 * 0.15;
      return acc;
    }, { n: 0, b0: 0, bt5: 0, bt12: 0, bt15: 0, noObj: 0, iva5: 0, iva12: 0, iva15: 0 });

    const cTotN    = cFact.n + cNV.n + cNcRec.n;
    const cTotB0   = cFact.b0 + cNV.b0 + cNcRec.b0;
    const cTotBt5  = cFact.bt5 + cNV.bt5 + cNcRec.bt5;
    const cTotBt12 = cFact.bt12 + cNV.bt12 + cNcRec.bt12;
    const cTotBt15 = cFact.bt15 + cNV.bt15 + cNcRec.bt15;
    const cTotNoObj = cFact.noObj + cNV.noObj + cNcRec.noObj;
    const cTotIva5  = cFact.iva5 + cNV.iva5 + cNcRec.iva5;
    const cTotIva12 = cFact.iva12 + cNV.iva12 + cNcRec.iva12;
    const cTotIva15 = cFact.iva15 + cNV.iva15 + cNcRec.iva15;

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
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      autoFirstPage: true,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="talonATS_${anio}${mesPad}.pdf"`);
    doc.pipe(res);

    // ── Constantes de diseño ─────────────────────────────────────────────────
    const ML       = 40;
    const PW       = 515;   // 595 − 80 (márgenes l+r)
    const PAGE_MAX = 802;   // 842 − 40 (margen inferior)
    const SRI_BLUE = '#003087';
    const HDR_BG   = '#1f3a6e';
    const SUB_BG   = '#2e5fa3';
    const ALT_BG   = '#eef2fb';
    const ROW_H    = 18;    // filas de datos
    const COL_H    = 24;    // fila de encabezados de columna
    const SEC_H    = 22;    // altura de sección principal
    const SUB_H    = 20;    // altura de sub-sección
    const n2 = (v) => Number(v || 0).toFixed(2);

    // ── Cabecera — Logo + Título ──────────────────────────────────────────────
    const MT       = 40;
    const LOGO_W   = 110;
    const LOGO_H   = 78;
    const TITLE_X  = ML + LOGO_W + 16;
    const TITLE_W  = PW - LOGO_W - 16;

    try {
      doc.image(LOGO_SRI, ML, MT, { width: LOGO_W, height: LOGO_H, fit: [LOGO_W, LOGO_H] });
    } catch (_) {
      // Fallback si el logo no existe en el servidor
      doc.rect(ML, MT, LOGO_W, LOGO_H - 16).fillAndStroke(SRI_BLUE, SRI_BLUE);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(28)
        .text('SRI', ML, MT + 12, { width: LOGO_W, align: 'center' });
      doc.fillColor(SRI_BLUE).font('Helvetica-Oblique').fontSize(7)
        .text('...le hace bien al país!', ML, MT + LOGO_H - 14, { width: LOGO_W, align: 'center' });
      doc.fillColor('black');
    }

    doc.fillColor(SRI_BLUE).font('Helvetica-Bold')
      .fontSize(14).text('TALÓN RESUMEN', TITLE_X, MT + 6, { width: TITLE_W, align: 'center' })
      .fontSize(11).text('SERVICIO DE RENTAS INTERNAS', TITLE_X, MT + 28, { width: TITLE_W, align: 'center' })
      .fontSize(10).text('ANEXO TRANSACCIONAL', TITLE_X, MT + 47, { width: TITLE_W, align: 'center' });
    doc.fillColor('black');

    // Bloque datos empresa
    let curY = MT + LOGO_H + 14;
    doc.rect(ML, curY, PW, 20).fillAndStroke('#f1f5f9', '#cbd5e1');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10)
      .text(config.razonSocial || '—', ML + 6, curY + 5, { width: PW - 12, align: 'center' });
    curY += 20;
    doc.rect(ML, curY, PW, 18).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#334155').font('Helvetica').fontSize(8.5)
      .text(`RUC: ${config.ruc || '—'}`, ML + 8, curY + 4)
      .text(`Período: ${periodoLabel}`, ML, curY + 4, { width: PW, align: 'center' })
      .text(`Fecha de generación: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`,
        ML + 8, curY + 4, { width: PW - 16, align: 'right' });
    curY += 18;
    doc.fillColor('black');
    curY += 16;

    // Párrafo de certificación
    doc.fontSize(9).font('Helvetica').fillColor('#334155')
      .text(
        `Certifico que la información contenida en el medio magnético del Anexo Transaccional para el período ${periodoLabel}, es fiel reflejo del siguiente reporte:`,
        ML, curY, { width: PW },
      );
    curY += 30;

    // ── Helpers ───────────────────────────────────────────────────────────────
    let rowAlt = false;

    const pgCheck = (needed = ROW_H * 4) => {
      if (curY + needed > PAGE_MAX) { doc.addPage(); curY = 40; rowAlt = false; }
    };

    const secHdr = (title) => {
      pgCheck(SEC_H + ROW_H * 6);
      doc.rect(ML, curY, PW, SEC_H).fillAndStroke(HDR_BG, HDR_BG);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(9.5)
        .text(title, ML + 6, curY + 6, { width: PW - 12, align: 'center' });
      doc.fillColor('black');
      curY += SEC_H;
      rowAlt = false;
    };

    const subHdr = (title) => {
      pgCheck(SUB_H + ROW_H * 4);
      doc.rect(ML, curY, PW, SUB_H).fillAndStroke(SUB_BG, SUB_BG);
      doc.fillColor('white').font('Helvetica-Bold').fontSize(8.5)
        .text(title, ML + 6, curY + 5, { width: PW - 12, align: 'center' });
      doc.fillColor('black');
      curY += SUB_H;
    };

    const colHdr = (cols) => {
      pgCheck();
      doc.rect(ML, curY, PW, COL_H).fillAndStroke('#dbeafe', '#93c5fd');
      let x = ML;
      cols.forEach((c, i) => {
        if (i > 0) doc.moveTo(x, curY + 2).lineTo(x, curY + COL_H - 2).lineWidth(0.5).stroke('#93c5fd').lineWidth(1);
        doc.fillColor(SRI_BLUE).font('Helvetica-Bold').fontSize(7)
          .text(c.t, x + 3, curY + 8, { width: c.w - 6, align: c.a || 'center', lineBreak: false });
        x += c.w;
      });
      curY += COL_H;
    };

    const dataRow = (cols, values, bold = false) => {
      pgCheck();
      doc.rect(ML, curY, PW, ROW_H).fillAndStroke(rowAlt ? ALT_BG : '#ffffff', '#e2e8f0');
      let x = ML;
      values.forEach((v, i) => {
        const c = cols[i];
        if (i > 0) doc.moveTo(x, curY + 1).lineTo(x, curY + ROW_H - 1).lineWidth(0.3).stroke('#cbd5e1').lineWidth(1);
        doc.fillColor(bold ? HDR_BG : '#1e293b').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
          .text(String(v ?? ''), x + 3, curY + 5, { width: c.w - 6, align: c.a || 'left', lineBreak: false });
        x += c.w;
      });
      doc.fillColor('black');
      rowAlt = !rowAlt;
      curY += ROW_H;
    };

    const totRow = (cols, values) => {
      pgCheck();
      curY += 2;
      doc.rect(ML, curY, PW, ROW_H + 2).fillAndStroke(HDR_BG, HDR_BG);
      let x = ML;
      values.forEach((v, i) => {
        const c = cols[i];
        doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5)
          .text(String(v ?? ''), x + 3, curY + 5, { width: c.w - 6, align: c.a || 'left', lineBreak: false });
        x += c.w;
      });
      doc.fillColor('black');
      curY += ROW_H + 2 + 4;
      rowAlt = false;
    };

    // ── COMPRAS / VENTAS ─────────────────────────────────────────────────────
    // Columnas: total PW=515
    // 36+95+38+46+44+46+44+35+35+42+54 = 515
    // Cod ampliada a 36 para que "TOTAL" no se corte; IVA 15% a 54 para números grandes
    const tc = [
      { t: 'Cod.',       w: 36,  a: 'center' },
      { t: 'Transacción', w: 95,  a: 'left'   },
      { t: 'No. Reg.',   w: 38,  a: 'right'  },
      { t: 'BI 0%',      w: 46,  a: 'right'  },
      { t: 'BI T.5%',    w: 44,  a: 'right'  },
      { t: 'BI T.12%',   w: 46,  a: 'right'  },
      { t: 'BI T.15%',   w: 44,  a: 'right'  },
      { t: 'No Obj.',    w: 35,  a: 'right'  },
      { t: 'IVA 5%',     w: 35,  a: 'right'  },
      { t: 'IVA 12%',    w: 42,  a: 'right'  },
      { t: 'IVA 15%',    w: 54,  a: 'right'  },
    ];

    secHdr('COMPRAS');
    colHdr(tc);
    if (cFact.n > 0)
      dataRow(tc, ['01', 'FACTURA', cFact.n, n2(cFact.b0), n2(cFact.bt5), n2(cFact.bt12), n2(cFact.bt15), n2(cFact.noObj), n2(cFact.iva5), n2(cFact.iva12), n2(cFact.iva15)]);
    if (cNV.n > 0)
      dataRow(tc, ['02', 'NOTA DE VENTA', cNV.n, n2(cNV.b0), n2(cNV.bt5), n2(cNV.bt12), n2(cNV.bt15), n2(cNV.noObj), n2(cNV.iva5), n2(cNV.iva12), n2(cNV.iva15)]);
    if (cNcRec.n > 0)
      dataRow(tc, ['04', 'NOTA DE CRÉDITO', cNcRec.n, n2(cNcRec.b0), n2(cNcRec.bt5), n2(cNcRec.bt12), n2(cNcRec.bt15), n2(cNcRec.noObj), n2(cNcRec.iva5), n2(cNcRec.iva12), n2(cNcRec.iva15)]);
    totRow(tc,   ['TOTAL', '', cTotN, n2(cTotB0), n2(cTotBt5), n2(cTotBt12), n2(cTotBt15), n2(cTotNoObj), n2(cTotIva5), n2(cTotIva12), n2(cTotIva15)]);
    curY += 10;

    secHdr('VENTAS');
    colHdr(tc);
    if (facturas.length > 0)
      dataRow(tc, ['01', 'FACTURA', vFact.n, n2(vFact.b0), n2(vFact.bt5), n2(vFact.bt12), n2(vFact.bt15), '0.00', n2(vFact.iva5), n2(vFact.iva12), n2(vFact.iva15)]);
    if (liquidaciones.length > 0)
      dataRow(tc, ['03', 'LIQUIDACIÓN DE COMPRA', vLiq.n, n2(vLiq.b0), n2(vLiq.bt5), n2(vLiq.bt12), n2(vLiq.bt15), '0.00', n2(vLiq.iva5), n2(vLiq.iva12), n2(vLiq.iva15)]);
    if (vNV.n > 0)
      dataRow(tc, ['02', 'NOTA DE VENTA', vNV.n, n2(vNV.b0), '0.00', '0.00', '0.00', '0.00', '0.00', '0.00', '0.00']);
    if (ncs.length > 0)
      dataRow(tc, ['04', 'NOTA DE CRÉDITO', vNcEm.n, '0.00', n2(vNcEm.bt5), '0.00', n2(vNcEm.bt15), '0.00', n2(vNcEm.iva5), '0.00', n2(vNcEm.iva15)]);
    totRow(tc,   ['TOTAL', '', vTotN, n2(vTotB0), n2(vTotBt5), n2(vTotBt12), n2(vTotBt15), '0.00', n2(vTotIva5), n2(vTotIva12), n2(vTotIva15)]);
    curY += 10;

    // ── COMPROBANTES ANULADOS ─────────────────────────────────────────────────
    pgCheck(SEC_H + ROW_H + 12);
    doc.rect(ML, curY, PW, SEC_H).fillAndStroke(HDR_BG, HDR_BG);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(9.5)
      .text('COMPROBANTES ANULADOS', ML + 6, curY + 6, { width: PW - 12, align: 'center' });
    doc.fillColor('black');
    curY += SEC_H;
    doc.rect(ML, curY, PW, ROW_H + 2).fillAndStroke('#f8fafc', '#e2e8f0');
    doc.fillColor('#1e293b').font('Helvetica').fontSize(8.5)
      .text('Total de Comprobantes Anulados en el período informado (no incluye los dados de baja)',
        ML + 8, curY + 5, { width: PW - 90 });
    doc.font('Helvetica-Bold').fontSize(9)
      .text(String(anuladosFacturas.length), ML + PW - 80, curY + 5, { width: 72, align: 'right' });
    doc.fillColor('black');
    curY += ROW_H + 2 + 14;

    // ── RESUMEN DE RETENCIONES — AGENTE DE RETENCIÓN ──────────────────────────
    secHdr('RESUMEN DE RETENCIONES - AGENTE DE RETENCIÓN');

    // 40+244+58+87+86 = 515
    const irC = [
      { t: 'Cod.',                  w: 40,  a: 'center' },
      { t: 'Concepto de Retención', w: 244, a: 'left'   },
      { t: 'No. Registros',         w: 58,  a: 'right'  },
      { t: 'B. Imponible',          w: 87,  a: 'right'  },
      { t: 'Valor retenido',        w: 86,  a: 'right'  },
    ];
    subHdr('RETENCIÓN EN LA FUENTE DE IMPUESTO A LA RENTA');
    colHdr(irC);
    if (retIrCodigos.length > 0) {
      retIrCodigos.forEach(([cod, v]) => dataRow(irC, [cod, v.concepto, v.n, n2(v.base), n2(v.valor)]));
    } else {
      dataRow(irC, ['', 'Sin retenciones IR emitidas en el período', '', '', '0.00']);
    }
    totRow(irC, ['TOTAL', '', totalRetIrN, n2(totalRetIrBase), n2(totalRetIr)]);

    // 90+305+120 = 515
    const ivaC = [
      { t: 'Operación',             w: 90,  a: 'center' },
      { t: 'Concepto de Retención', w: 305, a: 'left'   },
      { t: 'Valor retenido',        w: 120, a: 'right'  },
    ];
    subHdr('RETENCIÓN EN LA FUENTE DE IVA');
    colHdr(ivaC);
    if (retIvaPcts.length > 0) {
      retIvaPcts.forEach(([pct, val]) => dataRow(ivaC, ['COMPRA', `Retención IVA ${pct}%`, n2(val)]));
    } else {
      dataRow(ivaC, ['COMPRA', 'Sin retenciones IVA emitidas en el período', '0.00']);
    }
    totRow(ivaC, ['TOTAL', '', n2(totalRetIvaEmit)]);
    curY += 12;

    // ── RETENCIONES QUE LE EFECTUARON ────────────────────────────────────────
    const recC = [
      { t: 'Operación',                          w: 90,  a: 'center' },
      { t: 'Tipo de Retención que le efectuaron', w: 305, a: 'left'   },
      { t: 'Valor retenido',                     w: 120, a: 'right'  },
    ];
    secHdr('RESUMEN DE RETENCIONES QUE LE EFECTUARON EN EL PERIODO');
    colHdr(recC);
    dataRow(recC, ['VENTA', 'Valor de IVA que le han retenido',   n2(totalRetIvaRecib)]);
    dataRow(recC, ['VENTA', 'Valor de Renta que le han retenido', n2(totalRetIrRecib)]);
    totRow(recC, ['TOTAL', '', n2(totalRetIvaRecib + totalRetIrRecib)]);
    curY += 20;

    // ── Declaración y firmas ──────────────────────────────────────────────────
    pgCheck(90);
    doc.fontSize(9).font('Helvetica').fillColor('#334155')
      .text(
        'Declaro que los datos contenidos en este anexo son verdaderos, por lo que asumo la responsabilidad correspondiente, de acuerdo a lo establecido en el Art. 101 de la Codificación de la Ley de Régimen Tributario Interno.',
        ML, curY, { width: PW, align: 'justify' },
      );
    curY += 40;
    pgCheck(50);
    const fw = (PW - 60) / 2;
    doc.lineWidth(0.8)
      .moveTo(ML + 10, curY + 28).lineTo(ML + 10 + fw, curY + 28).stroke('#0f172a')
      .moveTo(ML + 10 + fw + 60, curY + 28).lineTo(ML + PW - 10, curY + 28).stroke('#0f172a');
    doc.lineWidth(1);
    doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
      .text('Firma del Contador', ML + 10, curY + 32, { width: fw, align: 'center' })
      .text('Firma del Representante Legal', ML + 10 + fw + 60, curY + 32, { width: fw, align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[ATS pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
