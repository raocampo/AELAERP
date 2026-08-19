// ====================================
// RUTAS: DECLARACIONES TRIBUTARIAS SRI
// backend/routes/declaraciones.js
//
// Formulario 104 — IVA mensual
// Formulario 103 — Retenciones en la Fuente mensual
// Formulario 101 — IR anual (resumen, no sustituto oficial)
//
// Fuentes de datos:
//   F104: facturas + notas_credito + facturas_compra + retenciones
//   F103: retenciones (comprobantes de retención emitidos)
// ====================================

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const PDFDocument = require('pdfkit');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { requiereModulo } = require('../middleware/modulos');
const { condicionComprasDeducibles, CUTOFF_APROBACION_CEDULA } = require('../utils/comprasFiscal');

router.use(proteger);
router.use(requiereModulo('tributarioHabilitado'));
router.use(autorizarPermiso('tributario.reportes'));

// Estados de factura que representan una venta real declarable — igual
// criterio que el Dashboard (routes/empresas.js): AUTORIZADO (SRI la
// aceptó) o HISTORICO (venta real importada de un período anterior, sin
// flujo de autorización SRI). Cualquier otro estado (PENDIENTE_FIRMA,
// ENVIADO, ERROR, RECHAZADO) nunca llegó a ser una venta válida y no debe
// contarse en un formulario de declaración tributaria.
const ESTADOS_FACTURA_VALIDOS = ['AUTORIZADO', 'HISTORICO'];

// ─── Helpers de rango de fechas ────────────────────────────────────────────────
function rangoMes(anio, mes) {
  const desde = new Date(anio, mes - 1, 1, 0, 0, 0);
  const hasta = new Date(anio, mes, 0, 23, 59, 59, 999);
  return { desde, hasta };
}

function rangoAnio(anio) {
  return {
    desde: new Date(anio, 0, 1, 0, 0, 0),
    hasta: new Date(anio, 11, 31, 23, 59, 59, 999),
  };
}

function d(v) { return parseFloat(v || 0); }

// ─── Helpers de PDF (copiados de routes/contabilidad.js — sin exportar allá) ───
function crearDocumentoPdf(res, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ size: 'A4', margin: 36 });
  doc.pipe(res);
  return doc;
}

function _resolverLogoDeclaraciones(logoUrl) {
  if (!logoUrl) return { logoData: null, tieneLogo: false };
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return { logoData: Buffer.from(b64, 'base64'), tieneLogo: true };
    } catch { return { logoData: null, tieneLogo: false }; }
  }
  const logoPath = path.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  const existe = fs.existsSync(logoPath);
  return { logoData: existe ? logoPath : null, tieneLogo: existe };
}

function dibujarEncabezadoContable(doc, config, titulo) {
  const ML = doc.page.margins.left;
  const W  = doc.page.width - ML - doc.page.margins.right;
  const { logoData, tieneLogo } = _resolverLogoDeclaraciones(config?.logoUrl);
  let y = doc.y;

  if (tieneLogo) {
    try { doc.image(logoData, ML, y, { fit: [70, 45] }); } catch { /* logo corrupto → omitir */ }
  }

  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
    .text((config?.razonSocial || 'Empresa').toUpperCase(), ML, y, { width: W, align: 'center' });
  doc.fontSize(8).font('Helvetica').fillColor('#475569')
    .text([config?.ruc, config?.dirMatriz, config?.telefono].filter(Boolean).join('  ·  '), { width: W, align: 'center' });
  doc.moveDown(0.4);

  doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
    .text(titulo, { width: W, align: 'center' });
  doc.font('Helvetica').fillColor('#000000');
  doc.moveDown(0.3);

  const lineY = doc.y;
  doc.moveTo(ML, lineY).lineTo(ML + W, lineY).lineWidth(1).stroke('#7C3AED');
  doc.moveDown(0.4);
}

// Tabla de casilleros: Casillero | Descripción | Valor(es). Mismo lenguaje
// visual que dibujarTablaPdf de contabilidad.js (alto de fila dinámico —
// PDFKit no envuelve texto largo solo, hay que medir con heightOfString
// antes de dibujar el rect() de fondo).
function dibujarTablaPdf(doc, columnas, filas, startY) {
  const ML = doc.page.margins.left;
  const LIMITE_Y = doc.page.height - doc.page.margins.bottom;
  const ROW_H_MIN = 16;
  const anchoTotal = columnas.reduce((s, c) => s + c.width, 0);
  let y = startY;

  const dibujarEncabezado = () => {
    doc.rect(ML, y, anchoTotal, ROW_H_MIN).fillAndStroke('#e2e8f0', '#94a3b8');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(8);
    let x = ML;
    columnas.forEach((c) => {
      doc.text(c.header, x + 3, y + 4, { width: c.width - 6, align: c.align || 'left' });
      x += c.width;
    });
    doc.font('Helvetica').fillColor('#000000');
    y += ROW_H_MIN;
  };

  dibujarEncabezado();
  doc.fontSize(8);

  filas.forEach((fila, i) => {
    const valores = columnas.map((c) => (c.formato ? c.formato(fila[c.key], fila) : String(fila[c.key] ?? '')));
    const altoFila = Math.max(ROW_H_MIN, ...columnas.map((c, idx) =>
      doc.heightOfString(valores[idx], { width: c.width - 6, align: c.align || 'left' }) + 8));

    if (y + altoFila > LIMITE_Y) {
      doc.addPage();
      y = doc.page.margins.top;
      dibujarEncabezado();
      doc.fontSize(8);
    }
    if (fila._destacado) { doc.rect(ML, y, anchoTotal, altoFila).fill('#ede9fe').fillColor('#000000'); }
    else if (i % 2 === 1) { doc.rect(ML, y, anchoTotal, altoFila).fill('#f8fafc').fillColor('#000000'); }
    let x = ML;
    columnas.forEach((c, idx) => {
      doc.font(fila._destacado ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(valores[idx], x + 3, y + 4, { width: c.width - 6, align: c.align || 'left' });
      x += c.width;
    });
    doc.font('Helvetica');
    y += altoFila;
  });

  doc.x = ML;
  doc.y = y + 6;
  return doc.y;
}

// ─── calcularF104 — cálculo completo del Formulario 104, reutilizado por el
// endpoint JSON (GET /f104) y por el generador de PDF (GET /f104/pdf) ─────────
async function calcularF104(db, empresaId, anio, mes) {
    const { desde, hasta } = rangoMes(anio, mes);
    const filtroFecha = { gte: desde, lte: hasta };

    // ── VENTAS ──────────────────────────────────────────────────────────────────
    const facturas = await db.facturas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, estadoSri: { in: ESTADOS_FACTURA_VALIDOS } },
      select: {
        subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
        subtotalNoObjetoIva: true,
        totalIva: true, importeTotal: true,
        notas_credito: {
          where: { estadoSri: 'AUTORIZADO' },
          select: {
            totalSinImpuestos: true, totalIva: true, importeTotal: true,
          },
        },
      },
    });

    let ventasSubtotal0  = 0;
    let ventasSubtotal5  = 0;
    let ventasSubtotal12 = 0;
    let ventasSubtotal15 = 0;
    // No Objeto + Exento de IVA combinados — igual que en el ATS
    // (routes/ats.js), el XSD del SRI para ventas no tiene un campo
    // separado para "exenta" como sí tiene compras; facturas.subtotalNoObjetoIva
    // ya guarda ambos juntos a propósito.
    let ventasSubtotalNoObjeto = 0;
    let ventasIva        = 0;
    let ncSubtotal       = 0;
    let ncIva            = 0;

    facturas.forEach((f) => {
      ventasSubtotal0  += d(f.subtotal0);
      ventasSubtotal5  += d(f.subtotal5);
      ventasSubtotal12 += d(f.subtotal12);
      ventasSubtotal15 += d(f.subtotal15);
      ventasSubtotalNoObjeto += d(f.subtotalNoObjetoIva);
      ventasIva        += d(f.totalIva);
      f.notas_credito?.forEach((nc) => {
        ncSubtotal += d(nc.totalSinImpuestos);
        ncIva      += d(nc.totalIva);
      });
    });

    // Ventas netas (descontando notas de crédito del período)
    const _totBaseVentas = ventasSubtotal0 + ventasSubtotal5 + ventasSubtotal12 + ventasSubtotal15 + 0.001;
    const ventasNetas0  = Math.max(0, parseFloat((ventasSubtotal0  - ncSubtotal * (ventasSubtotal0  / _totBaseVentas)).toFixed(2)));
    const ventasNetas5  = Math.max(0, parseFloat((ventasSubtotal5  - ncSubtotal * (ventasSubtotal5  / _totBaseVentas)).toFixed(2)));
    const ventasNetas12 = Math.max(0, parseFloat((ventasSubtotal12 - ncSubtotal * (ventasSubtotal12 / _totBaseVentas)).toFixed(2)));
    const ventasNetas15 = Math.max(0, parseFloat((ventasSubtotal15 - ncSubtotal * (ventasSubtotal15 / _totBaseVentas)).toFixed(2)));
    const ivaVentasNeto = parseFloat((ventasIva - ncIva).toFixed(2));

    // ── COMPRAS ─────────────────────────────────────────────────────────────────
    // Reglas de inclusión en el F104:
    //   1. Excluir si receptorEsRuc === false (facturadas a cédula personal, no al
    //      RUC) — salvo que el contador la haya revisado y marcado aprobadaPorContador,
    //      o que sea de antes del corte (contabilidad atrasada). Ver comprasFiscal.js.
    //   2. Excluir si esGastoPersonal === true (alimentación, salud, etc. — persona
    //      natural) — esto manda incluso si el punto 1 la incluiría.
    //   3. receptorEsRuc null (compras manuales/históricas sin XML) SÍ se incluye.
    const compras = await db.facturas_compra.findMany({
      where: {
        empresaId,
        fechaEmision:    filtroFecha,
        anulada:         false,
        esGastoPersonal: { not: true },
        OR: condicionComprasDeducibles(),
      },
      select: {
        subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true,
        subtotalNoObjeto: true, subtotalExento: true,
        totalIva: true, importeTotal: true, retencionIVA: true,
      },
    });

    // Contar cuántas facturas de gastos personales fueron excluidas (para info al usuario)
    const gastosPersonalesExcluidos = await db.facturas_compra.count({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, esGastoPersonal: true },
    });

    let comprasSubtotal0  = 0;
    let comprasSubtotal5  = 0;
    let comprasSubtotal12 = 0;
    let comprasSubtotal15 = 0;
    let comprasSubtotalNoObjeto = 0;
    let comprasSubtotalExento = 0;
    let ivaCompras        = 0;
    let retencionIvaCompras = 0;

    compras.forEach((c) => {
      comprasSubtotal0  += d(c.subtotal0);
      comprasSubtotal5  += d(c.subtotal5);
      comprasSubtotal12 += d(c.subtotal12);
      comprasSubtotal15 += d(c.subtotal15);
      comprasSubtotalNoObjeto += d(c.subtotalNoObjeto);
      comprasSubtotalExento += d(c.subtotalExento);
      ivaCompras        += d(c.totalIva);
      retencionIvaCompras += d(c.retencionIVA);
    });

    // ── LIQUIDACIONES DE COMPRA ─────────────────────────────────────────────────
    const liquidaciones = await db.liquidaciones_compra.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, estadoSri: 'AUTORIZADO' },
      select: { subtotal0: true, subtotal5: true, subtotal12: true, subtotal15: true, totalIva: true },
    });

    let liqSubtotal0 = 0, liqSubtotal5 = 0, liqSubtotal12 = 0, liqSubtotal15 = 0, liqIva = 0;
    liquidaciones.forEach((l) => {
      liqSubtotal0  += d(l.subtotal0);
      liqSubtotal5  += d(l.subtotal5);
      liqSubtotal12 += d(l.subtotal12);
      liqSubtotal15 += d(l.subtotal15);
      liqIva        += d(l.totalIva);
    });

    // Solo cuentan como "pendientes de revisión" las de después del corte —
    // las anteriores ya se incluyen automáticamente (contabilidad atrasada).
    const comprasExcluidasCedula = await db.facturas_compra.count({
      where: {
        empresaId, fechaEmision: filtroFecha, anulada: false,
        receptorEsRuc: false, aprobadaPorContador: false,
        NOT: { fechaEmision: { lt: CUTOFF_APROBACION_CEDULA } },
      },
    });

    // ── RETENCIONES DE IVA QUE LE HAN SIDO EFECTUADAS (recibidas de clientes) ───
    // Ojo: esto NO es lo mismo que las retenciones que la empresa EMITE a sus
    // proveedores (tabla `retenciones`, se declaran en el F103 como una
    // obligación aparte — dinero que hay que remitir al SRI, no un crédito
    // propio). Lo que sí reduce el IVA a pagar en el F104 es la retención que
    // los CLIENTES (agentes de retención) le practican a la empresa al pagarle
    // sus ventas — eso vive en `retenciones_recibidas` (casillero 605/699 del
    // formulario real).
    const retencionesRecibidas = await db.retenciones_recibidas.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false },
      select: { totalRetencionIva: true, detalles: true },
    });

    let retencionIVA30 = 0, retencionIVA70 = 0, retencionIVA100 = 0, retencionIVAOtro = 0;
    retencionesRecibidas.forEach((ret) => {
      const detalles = Array.isArray(ret.detalles) ? ret.detalles : [];
      detalles.forEach((det) => {
        // codigo: 1=Renta, 2/4/6=IVA (ver buzon.js parsearRetencionRecibida)
        if (!['2', '4', '6'].includes(String(det.codigo))) return;
        const valor = d(det.valorRetener);
        const pct = Math.round(d(det.porcentajeRetener));
        if (pct === 30) retencionIVA30 += valor;
        else if (pct === 70) retencionIVA70 += valor;
        else if (pct === 100) retencionIVA100 += valor;
        else retencionIVAOtro += valor;
      });
    });

    // ── NC RECIBIDAS DE PROVEEDORES ──────────────────────────────────────────────
    // Almacenadas en docs_recibidos_otros con tipoDocumento='04'. Solo tienen
    // importeTotal; el IVA se extrae del xmlAutorizado si está disponible.
    // Reducen el crédito fiscal de IVA (casillero 521/523 del F104 real).
    function extractIvaDeNcXml(xml) {
      if (!xml) return 0;
      let total = 0;
      const bloques = xml.match(/<totalImpuesto>[\s\S]*?<\/totalImpuesto>/g) || [];
      for (const b of bloques) {
        if (!/<codigo>2<\/codigo>/.test(b)) continue; // código 2 = IVA
        const m = b.match(/<valor>([\d.]+)<\/valor>/);
        if (m) total += parseFloat(m[1]) || 0;
      }
      return parseFloat(total.toFixed(2));
    }

    const ncReci = await db.docs_recibidos_otros.findMany({
      where: { empresaId, tipoDocumento: '04', fechaEmision: filtroFecha },
      select: { importeTotal: true, xmlAutorizado: true },
    });

    let ncReciIva = 0, ncReciSubtotal = 0;
    ncReci.forEach((nc) => {
      const iva = extractIvaDeNcXml(nc.xmlAutorizado);
      ncReciIva      += iva;
      ncReciSubtotal += Math.max(0, d(nc.importeTotal) - iva);
    });
    ncReciIva      = parseFloat(ncReciIva.toFixed(2));
    ncReciSubtotal = parseFloat(ncReciSubtotal.toFixed(2));

    // ── CRÉDITO TRIBUTARIO ARRASTRADO DEL MES ANTERIOR ──────────────────────────
    // No se calcula automáticamente encadenando meses (el saldo oficial ante el
    // SRI puede no coincidir con lo que este sistema calcularía solo, p.ej. si
    // la empresa empezó a usar AELA a mitad de año). El usuario lo ingresa una
    // vez por período en PUT /f104/credito-anterior y queda guardado.
    const creditoGuardado = await db.declaraciones_credito_iva.findUnique({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
    });
    const creditoTributarioAnterior = creditoGuardado ? d(creditoGuardado.creditoTributarioAnterior) : 0;

    // ── CÁLCULO FINAL ────────────────────────────────────────────────────────────
    const ivaGenerado    = parseFloat(ivaVentasNeto.toFixed(2));
    const ivaCreditoFiscal = parseFloat((ivaCompras + liqIva - ncReciIva).toFixed(2));
    const ivaRetenidoClientes = parseFloat((retencionIVA30 + retencionIVA70 + retencionIVA100 + retencionIVAOtro).toFixed(2));
    const ivaACobrarPagar = parseFloat((ivaGenerado - ivaCreditoFiscal - ivaRetenidoClientes - creditoTributarioAnterior).toFixed(2));

    const f104 = {
      periodo: { anio, mes },
      ventas: {
        subtotal0:      parseFloat(ventasSubtotal0.toFixed(2)),
        subtotal5:      parseFloat(ventasSubtotal5.toFixed(2)),
        subtotal12:     parseFloat(ventasSubtotal12.toFixed(2)),
        subtotal15:     parseFloat(ventasSubtotal15.toFixed(2)),
        subtotalNoObjeto: parseFloat(ventasSubtotalNoObjeto.toFixed(2)),
        ivaVentas:      parseFloat(ventasIva.toFixed(2)),
        notasCredito:   { subtotal: parseFloat(ncSubtotal.toFixed(2)), iva: parseFloat(ncIva.toFixed(2)) },
        subtotalNeto0:  ventasNetas0,
        subtotalNeto5:  ventasNetas5,
        subtotalNeto12: ventasNetas12,
        subtotalNeto15: ventasNetas15,
        ivaGenerado,
      },
      compras: {
        subtotal0:           parseFloat(comprasSubtotal0.toFixed(2)),
        subtotal5:           parseFloat(comprasSubtotal5.toFixed(2)),
        subtotal12:          parseFloat(comprasSubtotal12.toFixed(2)),
        subtotal15:          parseFloat(comprasSubtotal15.toFixed(2)),
        subtotalNoObjeto:    parseFloat(comprasSubtotalNoObjeto.toFixed(2)),
        subtotalExento:      parseFloat(comprasSubtotalExento.toFixed(2)),
        ivaCompras:          parseFloat(ivaCompras.toFixed(2)),
        liquidaciones:       { subtotal0: parseFloat(liqSubtotal0.toFixed(2)), subtotal5: parseFloat(liqSubtotal5.toFixed(2)), subtotal12: parseFloat(liqSubtotal12.toFixed(2)), subtotal15: parseFloat(liqSubtotal15.toFixed(2)), iva: parseFloat(liqIva.toFixed(2)) },
        ncRecibidas:         { subtotal: ncReciSubtotal, iva: ncReciIva, cantidad: ncReci.length },
        ivaCreditoFiscal,
      },
      retenciones: {
        iva30:   parseFloat(retencionIVA30.toFixed(2)),
        iva70:   parseFloat(retencionIVA70.toFixed(2)),
        iva100:  parseFloat(retencionIVA100.toFixed(2)),
        otro:    parseFloat(retencionIVAOtro.toFixed(2)),
        totalRetenido: ivaRetenidoClientes,
      },
      // IVA que la propia empresa retuvo a sus proveedores al pagarles (agente
      // de retención de IVA — casilleros 721-731/799/801 del formulario real).
      // AELA no desglosa por porcentaje (10/20/30/50/70/100%), solo el total.
      retencionesEmitidas: {
        ivaRetenidoAProveedores: parseFloat(retencionIvaCompras.toFixed(2)),
      },
      resultado: {
        creditoTributarioAnterior,
        creditoTributarioGuardado: !!creditoGuardado,
        ivaACobrarPagar,
        estado: ivaACobrarPagar > 0 ? 'A_PAGAR' : ivaACobrarPagar < 0 ? 'CREDITO_TRIBUTARIO' : 'CERO',
      },
      meta: {
        cantidadFacturas:    facturas.length,
        cantidadCompras:     compras.length,
        cantidadLiquidaciones: liquidaciones.length,
        cantidadRetencionesRecibidas: retencionesRecibidas.length,
        comprasExcluidasCedula,
        gastosPersonalesExcluidos,
        // Desglose para mostrar al usuario de dónde viene cada valor
        desglose: {
          facturasCompra0:    parseFloat(comprasSubtotal0.toFixed(2)),
          facturasCompra15:   parseFloat(comprasSubtotal15.toFixed(2)),
          liquidaciones0:     parseFloat(liqSubtotal0.toFixed(2)),
          liquidaciones15:    parseFloat(liqSubtotal15.toFixed(2)),
        },
      },
    };

    return f104;
}

// ─── GET /f104 — Formulario 104 IVA Mensual ────────────────────────────────────
// Query: ?anio=2025&mes=3
router.get('/f104', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    const f104 = await calcularF104(db, empresaId, anio, mes);
    res.json({ ok: true, data: f104 });
  } catch (err) {
    console.error('Error F104:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// ─── GET /f104/pdf — Documento de apoyo para el llenado del Formulario 104 ─────
// NO es el formulario oficial ni lo reemplaza — es una ayuda para que el
// contador arme la declaración en "SRI en Línea". Mapea los valores que AELA
// calcula contra el casillero oficial correspondiente (confirmado 2026-08-19
// contra el diseño oficial vigente post-reforma abril/2024: "Guía para el
// llenado del Formulario IVA.PDF" + "FORMULARIO IVA.xlsx" del SRI). Deja en
// blanco / con nota los casilleros que el sistema no puede determinar solo
// (activos fijos por separado, exportaciones, importaciones DIM/DAU, tarifa
// turística variable, factor de proporcionalidad, arrastre de NC, desglose de
// retención IVA por porcentaje, saldo de crédito tributario por origen).
// Query: ?anio=2025&mes=3
router.get('/f104/pdf', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    const f104 = await calcularF104(db, empresaId, anio, mes);
    const config = await db.configuracion_sri.findFirst({ where: { empresaId } });
    const money = (v) => `$${Number(v || 0).toFixed(2)}`;
    const round2 = (v) => parseFloat((v || 0).toFixed(2));

    // ── VENTAS: desglose por tarifa contra el casillero oficial ──────────────
    const v = f104.ventas;
    const ivaDif0Ventas = round2(v.subtotalNeto12 * 0.12 + v.subtotalNeto15 * 0.15);
    const iva5Ventas    = round2(v.subtotalNeto5 * 0.05);
    const baseTotalVentas = round2(v.subtotalNeto0 + v.subtotalNeto12 + v.subtotalNeto15 + v.subtotalNeto5);

    // ── COMPRAS: se suman facturas + liquidaciones de compra (el formulario
    // oficial no distingue tipo de documento, solo tarifa) ───────────────────
    const c = f104.compras;
    const compBase0    = round2(c.subtotal0 + c.liquidaciones.subtotal0);
    const compBase5    = round2(c.subtotal5 + c.liquidaciones.subtotal5);
    const compBase12   = round2(c.subtotal12 + c.liquidaciones.subtotal12);
    const compBase15   = round2(c.subtotal15 + c.liquidaciones.subtotal15);
    const ivaDif0Compras = round2(compBase12 * 0.12 + compBase15 * 0.15);
    const iva5Compras   = round2(compBase5 * 0.05);
    const baseTotalCompras = round2(compBase0 + compBase12 + compBase15 + compBase5);

    const subtotalAPagar = round2(Math.max(0, f104.resultado.ivaACobrarPagar));
    const saldoCreditoProxMes = round2(Math.max(0, -f104.resultado.ivaACobrarPagar));
    const ivaRetProveedores = f104.retencionesEmitidas.ivaRetenidoAProveedores;
    const totalAPagar = round2(subtotalAPagar + ivaRetProveedores);

    const doc = crearDocumentoPdf(res, `f104_${anio}_${String(mes).padStart(2, '0')}.pdf`);
    dibujarEncabezadoContable(doc, config, 'Formulario 104 — Declaración del IVA');

    doc.fontSize(9).font('Helvetica-Bold')
      .text(`Período: ${NOMBRES_MES[mes - 1]} ${anio}`, { align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
      .text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`, { align: 'center' })
      .fillColor('#000000');
    doc.moveDown(0.3);

    const ML = doc.page.margins.left;
    const Wtotal = doc.page.width - ML - doc.page.margins.right;
    const yAviso = doc.y;
    const textoAviso = 'Documento de apoyo para declarar en SRI en Línea — NO es el formulario oficial ni lo reemplaza. Verifique cada casillero contra el sistema del SRI antes de presentar la declaración. Los casilleros no soportados por AELA (activos fijos por separado, exportaciones, importaciones, tarifa turística variable, factor de proporcionalidad, notas de crédito por compensar, desglose de retención IVA por %) se detallan al final.';
    const altoAviso = doc.heightOfString(textoAviso, { width: Wtotal - 12 }) + 10;
    doc.rect(ML, yAviso, Wtotal, altoAviso).fillAndStroke('#fef3c7', '#f59e0b');
    doc.fillColor('#78350f').fontSize(7.5).font('Helvetica')
      .text(textoAviso, ML + 6, yAviso + 5, { width: Wtotal - 12 });
    doc.fillColor('#000000');
    doc.y = yAviso + altoAviso + 8;
    doc.x = ML;

    const colCasillero = [
      { header: 'Casillero', key: 'cas',   width: 88 },
      { header: 'Descripción', key: 'desc', width: 234 },
      { header: 'Base Imp.', key: 'base', width: 90, align: 'right', formato: (val) => (val === '' ? '' : money(val)) },
      { header: 'IVA', key: 'iva', width: 90, align: 'right', formato: (val) => (val === '' ? '' : money(val)) },
    ];

    doc.fontSize(10).font('Helvetica-Bold').text('VENTAS Y OTRAS OPERACIONES');
    doc.y = dibujarTablaPdf(doc, colCasillero, [
      { cas: '401/411/421', desc: 'Ventas locales gravadas tarifa general (12%/15%)', base: v.subtotalNeto12 + v.subtotalNeto15, iva: ivaDif0Ventas },
      { cas: '425/435/445', desc: 'Ventas locales gravadas tarifa 5% (materiales de construcción)', base: v.subtotalNeto5, iva: iva5Ventas },
      { cas: '403-406/413-416', desc: 'Ventas tarifa 0% (sistema no distingue si dan o no derecho a crédito)', base: v.subtotalNeto0, iva: 0 },
      { cas: '409/419/429', desc: 'TOTAL VENTAS Y OTRAS OPERACIONES', base: baseTotalVentas, iva: v.ivaGenerado, _destacado: true },
      { cas: '431/441', desc: 'Transferencias no objeto o exentas de IVA (informativo, fuera del total 429)', base: v.subtotalNoObjeto, iva: '' },
    ], doc.y);
    doc.fontSize(7).fillColor('#64748b')
      .text(`Notas de crédito del período netadas en las bases: ${money(v.notasCredito.subtotal)} (IVA ${money(v.notasCredito.iva)}).`)
      .fillColor('#000000');
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica-Bold').text('ADQUISICIONES Y PAGOS (COMPRAS)');
    doc.y = dibujarTablaPdf(doc, colCasillero, [
      { cas: '500/510/520', desc: 'Adquisiciones gravadas tarifa general (12%/15%), con derecho a crédito', base: compBase12 + compBase15, iva: ivaDif0Compras },
      { cas: '540/550/560', desc: 'Adquisiciones gravadas tarifa 5% (materiales de construcción)', base: compBase5, iva: iva5Compras },
      { cas: '506/507/516/517', desc: 'Adquisiciones tarifa 0%', base: compBase0, iva: 0 },
      { cas: '509/519/529', desc: 'TOTAL ADQUISICIONES Y PAGOS', base: baseTotalCompras, iva: c.ivaCreditoFiscal, _destacado: true },
      { cas: '531/541', desc: 'Adquisiciones no objeto de IVA', base: c.subtotalNoObjeto, iva: '' },
      { cas: '532/542', desc: 'Adquisiciones exentas del pago de IVA', base: c.subtotalExento, iva: '' },
    ], doc.y);
    doc.fontSize(7).fillColor('#64748b')
      .text(`Incluye ${f104.meta.cantidadLiquidaciones} liquidación(es) de compra del período. Notas de crédito de proveedores netadas en el crédito fiscal: ${money(c.ncRecibidas.subtotal)} (IVA ${money(c.ncRecibidas.iva)}, ${c.ncRecibidas.cantidad} documento(s)).`)
      .fillColor('#000000');
    doc.moveDown(0.5);

    const colResumen = [
      { header: 'Casillero', key: 'cas',   width: 62 },
      { header: 'Descripción', key: 'desc', width: 350 },
      { header: 'Valor', key: 'valor', width: 90, align: 'right', formato: money },
    ];

    doc.fontSize(10).font('Helvetica-Bold').text('LIQUIDACIÓN DEL IVA Y RESUMEN IMPOSITIVO');
    doc.y = dibujarTablaPdf(doc, colResumen, [
      { cas: '601/602', desc: 'Impuesto causado (429-529, antes de crédito/retenciones)', valor: round2(v.ivaGenerado - c.ivaCreditoFiscal) },
      { cas: '605', desc: 'Saldo crédito tributario del mes anterior (AELA no separa por origen)', valor: f104.resultado.creditoTributarioAnterior },
      { cas: '609', desc: 'Retenciones de IVA que le han sido efectuadas por clientes', valor: f104.retenciones.totalRetenido },
      { cas: '620/699', desc: 'SUBTOTAL A PAGAR POR PERCEPCIÓN', valor: subtotalAPagar, _destacado: true },
      { cas: '615', desc: 'Saldo crédito tributario para el próximo mes', valor: saldoCreditoProxMes },
      { cas: '799/801', desc: 'IVA retenido a proveedores (agente de retención — sin desglose por %)', valor: ivaRetProveedores },
      { cas: '859/902', desc: 'TOTAL IMPUESTO A PAGAR', valor: totalAPagar, _destacado: true },
    ], doc.y);
    doc.moveDown(0.3);

    doc.fontSize(7.5).font('Helvetica-Bold').text('Retenciones de IVA recibidas de clientes, por porcentaje (detalle del 609):');
    doc.font('Helvetica').fontSize(7.5)
      .text(`30%: ${money(f104.retenciones.iva30)}   ·   70%: ${money(f104.retenciones.iva70)}   ·   100%: ${money(f104.retenciones.iva100)}   ·   Otro: ${money(f104.retenciones.otro)}`);
    doc.moveDown(0.5);

    if (doc.y > 640) doc.addPage();
    doc.fontSize(9).font('Helvetica-Bold').text('Casilleros no incluidos — requieren revisión y llenado manual');
    doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    [
      'Activos fijos por separado (402/412/422, 501/511/521): AELA no distingue compra/venta de activo fijo del resto.',
      'Exportaciones de bienes y servicios (407/408/417/418): no se registran en AELA.',
      'Importaciones de bienes, servicios y activos fijos (503/504/505 y DIM/DAU): revisar aduana manualmente.',
      'Tarifa turística variable (410/420/430, requiere casilla 203): no aplica salvo sector turismo.',
      'Factor de proporcionalidad (563/564/565): solo aplica si hay ventas mixtas gravadas y no gravadas/exentas.',
      'Notas de crédito por compensar en próximo mes (442/443/453/543/544/554): AELA neta todo en el período emitido.',
      'Saldo de crédito tributario por origen (605 vs 606/607/608, 615 vs 617/618/619): AELA guarda un solo saldo combinado (ver PUT /f104/credito-anterior).',
      'Compensaciones e IVA presuntivo (603/604/607/608/621), ISD devolución exportadores (700-702), pagos previos e imputación de sustitutivas (880-899).',
    ].forEach((linea) => { doc.text(`• ${linea}`); doc.moveDown(0.15); });
    doc.fillColor('#000000');

    doc.end();
  } catch (err) {
    console.error('Error F104 PDF:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── PUT /f104/credito-anterior — guardar el crédito tributario arrastrado ─────
// Body: { anio, mes, creditoTributarioAnterior }
router.put('/f104/credito-anterior', async (req, res) => {
  try {
    const db = req.prisma || prisma;
    const empresaId = req.empresa.id;
    const anio = parseInt(req.body.anio);
    const mes  = parseInt(req.body.mes);
    const valor = d(req.body.creditoTributarioAnterior);

    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Período inválido' });
    }
    if (valor < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El crédito tributario no puede ser negativo' });
    }

    await db.declaraciones_credito_iva.upsert({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
      update: { creditoTributarioAnterior: valor, usuarioId: req.usuario?.id || null },
      create: { empresaId, anio, mes, creditoTributarioAnterior: valor, usuarioId: req.usuario?.id || null },
    });

    res.json({ ok: true, data: { anio, mes, creditoTributarioAnterior: valor } });
  } catch (err) {
    console.error('Error PUT /f104/credito-anterior:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /f103 — Formulario 103 Retenciones en la Fuente mensual ───────────────
// Query: ?anio=2025&mes=3
router.get('/f103', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const { desde, hasta } = rangoMes(anio, mes);
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;
    const filtroFecha = { gte: desde, lte: hasta };

    const retenciones = await db.retenciones.findMany({
      where: {
        empresaId,
        fechaEmision: filtroFecha,
        estadoSri: { in: ['AUTORIZADO', 'FIRMADO_PENDIENTE_ENVIO', 'RECHAZADO'] },
      },
      select: {
        id: true,
        claveAcceso: true,
        numeroRetencion: true,
        identificacionProveedor: true,
        razonSocialProveedor: true,
        impuestos: true,
        estadoSri: true,
        fechaEmision: true,
      },
    });

    // Agregar por código de retención
    const porCodigo = {};

    retenciones.forEach((ret) => {
      const impuestos = typeof ret.impuestos === 'string'
        ? JSON.parse(ret.impuestos) : (ret.impuestos || []);

      impuestos.forEach((imp) => {
        if (imp.tipo !== 'RENTA' && imp.tipo !== 'renta') return;
        const cod = imp.codigoRetencion;
        if (!porCodigo[cod]) {
          porCodigo[cod] = {
            codigo:           cod,
            descripcion:      imp.descripcion || `Retención ${cod}`,
            porcentaje:       parseFloat(imp.porcentaje || 0),
            baseImponible:    0,
            valorRetenido:    0,
            cantidad:         0,
          };
        }
        porCodigo[cod].baseImponible += d(imp.baseImponible);
        porCodigo[cod].valorRetenido += d(imp.valorRetenido);
        porCodigo[cod].cantidad++;
      });
    });

    const detalle = Object.values(porCodigo).sort((a, b) => a.codigo.localeCompare(b.codigo));
    const totalRetenido = parseFloat(detalle.reduce((acc, r) => acc + r.valorRetenido, 0).toFixed(2));

    // Tabla resumen de proveedores
    const porProveedor = {};
    retenciones.forEach((ret) => {
      const id = ret.identificacionProveedor;
      if (!porProveedor[id]) {
        porProveedor[id] = {
          identificacion: id,
          razonSocial:    ret.razonSocialProveedor,
          comprobantes:   0,
          totalRetenido:  0,
        };
      }
      porProveedor[id].comprobantes++;
      const impuestos = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      impuestos.forEach((imp) => {
        if (imp.tipo === 'RENTA' || imp.tipo === 'renta') {
          porProveedor[id].totalRetenido += d(imp.valorRetenido);
        }
      });
    });

    const f103 = {
      periodo: { anio, mes },
      detallePorCodigo: detalle,
      totalRetenido,
      cantidadComprobantes: retenciones.length,
      proveedores: Object.values(porProveedor).sort((a, b) => b.totalRetenido - a.totalRetenido),
      meta: {
        comprobantesAutorizados: retenciones.filter((r) => r.estadoSri === 'AUTORIZADO').length,
        comprobantesPendientes:  retenciones.filter((r) => r.estadoSri === 'FIRMADO_PENDIENTE_ENVIO').length,
      },
    };

    res.json({ ok: true, data: f103 });
  } catch (err) {
    console.error('Error F103:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /f101 — Resumen anual (datos para IR) ─────────────────────────────────
// Query: ?anio=2025
router.get('/f101', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { desde, hasta } = rangoAnio(anio);
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;
    const filtroFecha = { gte: desde, lte: hasta };

    const [facturas, compras, retenciones] = await Promise.all([
      db.facturas.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, anulada: false, estadoSri: { in: ESTADOS_FACTURA_VALIDOS } },
        _sum:   { importeTotal: true, totalIva: true },
        _count: { id: true },
      }),
      db.facturas_compra.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, anulada: false, OR: condicionComprasDeducibles() },
        _sum:   { importeTotal: true, totalIva: true },
        _count: { id: true },
      }),
      db.retenciones.aggregate({
        where: { empresaId, fechaEmision: filtroFecha, estadoSri: 'AUTORIZADO' },
        _count: { id: true },
      }),
    ]);

    res.json({
      ok: true,
      data: {
        anio,
        ingresos: {
          totalFacturado: d(facturas._sum.importeTotal),
          totalIvaVentas: d(facturas._sum.totalIva),
          cantidadFacturas: facturas._count.id,
        },
        gastos: {
          totalCompras: d(compras._sum.importeTotal),
          totalIvaCompras: d(compras._sum.totalIva),
          cantidadCompras: compras._count.id,
        },
        retenciones: {
          cantidadComprobantes: retenciones._count.id,
        },
        nota: 'Este resumen es orientativo. Consulte a un contador para el llenado oficial del F101.',
      },
    });
  } catch (err) {
    console.error('Error F101:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── GET /disponibles — Períodos con datos ─────────────────────────────────────
router.get('/disponibles', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    // Obtener meses con facturas
    const facturas = await db.facturas.groupBy({
      by: ['fechaEmision'],
      where: { empresaId, anulada: false, estadoSri: { in: ESTADOS_FACTURA_VALIDOS } },
      _count: { id: true },
    });

    const periodos = new Set();
    facturas.forEach((f) => {
      const d = new Date(f.fechaEmision);
      periodos.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });

    res.json({
      ok: true,
      data: Array.from(periodos).sort().reverse(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

module.exports = router;
