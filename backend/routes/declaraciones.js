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
        totalIva: true, importeTotal: true,
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
    compras.forEach((c) => {
      comprasSubtotal0  += d(c.subtotal0);
      comprasSubtotal5  += d(c.subtotal5);
      comprasSubtotal12 += d(c.subtotal12);
      comprasSubtotal15 += d(c.subtotal15);
      comprasSubtotalNoObjeto += d(c.subtotalNoObjeto);
      comprasSubtotalExento += d(c.subtotalExento);
      ivaCompras        += d(c.totalIva);
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

    // ── RETENCIONES DE IVA EMITIDAS A PROVEEDORES (agente de retención) ─────────
    // Distinto de lo anterior: esto es el IVA que la propia empresa retiene a
    // SUS proveedores al pagarles (tabla `retenciones`, comprobante que AELA
    // emite) — casilleros 721-731/799/801 del formulario real ("AGENTE DE
    // RETENCIÓN DEL IVA"). Se lee directo del detalle de impuestos (igual que
    // arriba con las recibidas) para poder desglosar por tramo de porcentaje
    // (10/20/30/50/70/100%) en vez de un solo total — AELA hoy solo ofrece
    // 30/70/100% al crear un comprobante (CODIGOS_RETENCION_IVA en sri.js),
    // pero el bucketing por porcentaje real deja soportados 10/20/50% también
    // si en el futuro se agregan esos códigos, sin tocar este cálculo de nuevo.
    const retencionesEmitidasRaw = await db.retenciones.findMany({
      where: { empresaId, fechaEmision: filtroFecha, anulada: false, estadoSri: { in: ['AUTORIZADO', 'FIRMADO_PENDIENTE_ENVIO', 'RECHAZADO'] } },
      select: { impuestos: true },
    });

    let retEmitidaIVA10 = 0, retEmitidaIVA20 = 0, retEmitidaIVA30 = 0, retEmitidaIVA50 = 0, retEmitidaIVA70 = 0, retEmitidaIVA100 = 0;
    retencionesEmitidasRaw.forEach((ret) => {
      const impuestos = typeof ret.impuestos === 'string' ? JSON.parse(ret.impuestos) : (ret.impuestos || []);
      impuestos.forEach((imp) => {
        if (String(imp.codigo) !== '2') return; // código 2 = IVA (1 = Renta)
        const valor = d(imp.valorRetenido);
        const pct = Math.round(d(imp.porcentajeRetener));
        if (pct === 10) retEmitidaIVA10 += valor;
        else if (pct === 20) retEmitidaIVA20 += valor;
        else if (pct === 30) retEmitidaIVA30 += valor;
        else if (pct === 50) retEmitidaIVA50 += valor;
        else if (pct === 70) retEmitidaIVA70 += valor;
        else retEmitidaIVA100 += valor; // 100% y cualquier otro no clasificado
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
    // vez por período en PUT /f104/credito-anterior y queda guardado — desde
    // 2026-08-19 separado en 2 casilleros reales, confirmado contra una
    // declaración real del SRI compartida por el usuario:
    //   605 = saldo por ADQUISICIONES E IMPORTACIONES (arrastra el 615 anterior)
    //   606 = saldo por RETENCIONES DE IVA QUE LE HAN SIDO EFECTUADAS (arrastra el 617 anterior)
    // Antes se guardaban sumados en un solo campo — no permitía saber en qué
    // casillero real ubicar cada uno al declarar.
    const creditoGuardado = await db.declaraciones_credito_iva.findUnique({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
    });
    const creditoPorAdquisicionesAnterior = creditoGuardado ? d(creditoGuardado.creditoPorAdquisiciones) : 0;
    const creditoPorRetencionesAnterior   = creditoGuardado ? d(creditoGuardado.creditoPorRetenciones)   : 0;

    // ── CÁLCULO FINAL ────────────────────────────────────────────────────────────
    // Replica la sección "RESUMEN IMPOSITIVO: AGENTE DE PERCEPCIÓN" del
    // formulario real (casilleros 601-620), verificada campo por campo contra
    // una declaración real del SRI del usuario (2026-08-19): 499 (=429, sin
    // arrastre de ventas a crédito — AELA no distingue contado/crédito) menos
    // 564 (crédito fiscal con factor de proporcionalidad — AELA asume factor
    // 1.0000 al no soportar ventas mixtas gravadas/exentas) da el 601 o 602.
    // El saldo a favor disponible se agrupa en 2 orígenes — "adquisiciones"
    // (605 arrastrado + 602 generado este mismo período, si lo hay) y
    // "retenciones" (606 arrastrado + 609 de este período) — y se consume
    // secuencialmente contra el 601 en ese orden (adquisiciones primero,
    // retenciones después), dejando el remanente de cada origen en 615/617
    // para el próximo mes. Verificado exacto contra el ejemplo real (605=0,
    // 606=1487.68, 609=62.07, 601=163.89 → 617=1385.86, 620=0.00).
    const ivaGenerado    = parseFloat(ivaVentasNeto.toFixed(2));
    const ivaCreditoFiscal = parseFloat((ivaCompras + liqIva - ncReciIva).toFixed(2));
    const ivaRetenidoClientes = parseFloat((retencionIVA30 + retencionIVA70 + retencionIVA100 + retencionIVAOtro).toFixed(2));
    const ivaRetenidoAProveedores = parseFloat((retEmitidaIVA10 + retEmitidaIVA20 + retEmitidaIVA30 + retEmitidaIVA50 + retEmitidaIVA70 + retEmitidaIVA100).toFixed(2));

    const impuestoCausado  = Math.max(0, parseFloat((ivaGenerado - ivaCreditoFiscal).toFixed(2))); // 601
    const creditoDelPeriodo = Math.max(0, parseFloat((ivaCreditoFiscal - ivaGenerado).toFixed(2))); // 602

    const creditoDisponibleAdquisiciones = parseFloat((creditoPorAdquisicionesAnterior + creditoDelPeriodo).toFixed(2));
    const creditoDisponibleRetenciones   = parseFloat((creditoPorRetencionesAnterior + ivaRetenidoClientes).toFixed(2));

    // Neto del período sin capar en 0 — positivo = queda algo por pagar,
    // negativo = el crédito disponible superó al impuesto causado (magnitud =
    // nuevo saldo a favor). Mismo valor que devolvía ivaACobrarPagar antes de
    // separar 605/606, ahora incluyendo también el 602 generado este período.
    const netoDelPeriodo = parseFloat((impuestoCausado - creditoDisponibleAdquisiciones - creditoDisponibleRetenciones).toFixed(2));

    let restante = impuestoCausado;
    const consumidoAdq = Math.min(creditoDisponibleAdquisiciones, restante); restante = parseFloat((restante - consumidoAdq).toFixed(2));
    const consumidoRet = Math.min(creditoDisponibleRetenciones, restante);   restante = parseFloat((restante - consumidoRet).toFixed(2));

    const saldoCreditoAdquisicionesProximoMes = parseFloat((creditoDisponibleAdquisiciones - consumidoAdq).toFixed(2)); // 615
    const saldoCreditoRetencionesProximoMes   = parseFloat((creditoDisponibleRetenciones - consumidoRet).toFixed(2));   // 617
    const subtotalAPagar = Math.max(0, parseFloat(restante.toFixed(2))); // 620/699

    const totalConsolidado = parseFloat((subtotalAPagar + ivaRetenidoAProveedores).toFixed(2)); // 859 (699+801)

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
      retencionesEmitidas: {
        iva10:  parseFloat(retEmitidaIVA10.toFixed(2)),
        iva20:  parseFloat(retEmitidaIVA20.toFixed(2)),
        iva30:  parseFloat(retEmitidaIVA30.toFixed(2)),
        iva50:  parseFloat(retEmitidaIVA50.toFixed(2)),
        iva70:  parseFloat(retEmitidaIVA70.toFixed(2)),
        iva100: parseFloat(retEmitidaIVA100.toFixed(2)),
        ivaRetenidoAProveedores: ivaRetenidoAProveedores,
      },
      resultado: {
        creditoPorAdquisicionesAnterior,
        creditoPorRetencionesAnterior,
        creditoTributarioGuardado: !!creditoGuardado,
        impuestoCausado,
        creditoDelPeriodo,
        saldoCreditoAdquisicionesProximoMes,
        saldoCreditoRetencionesProximoMes,
        subtotalAPagar,
        totalConsolidado,
        // Compatibilidad: mismo nombre/semántica que antes (lo que hay que
        // pagar o el crédito a favor de este período, sin contar 801).
        ivaACobrarPagar: netoDelPeriodo,
        estado: netoDelPeriodo > 0 ? 'A_PAGAR' : netoDelPeriodo < 0 ? 'CREDITO_TRIBUTARIO' : 'CERO',
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
// calcula contra el casillero oficial correspondiente. Confirmado 2026-08-19
// contra 3 fuentes oficiales: la guía + Excel de diseño del SRI, Y una
// declaración real del propio usuario descargada del portal del SRI (PDF con
// número de serial), que permitió verificar exactamente las fórmulas de
// 601-620 (secuencia de consumo 605→606→609) y confirmar que el factor de
// proporcionalidad (563) es 1.0000 cuando no hay ventas mixtas gravadas/
// exentas — antes se excluía todo ese bloque por prudencia, ahora se incluye.
// Deja en blanco / con nota los casilleros que el sistema aún no puede
// determinar solo (activos fijos por separado, exportaciones, importaciones
// DIM/DAU, tarifa turística variable, ventas a crédito 480-485, arrastre de NC).
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

    const r = f104.resultado;
    const re = f104.retencionesEmitidas;

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
    const textoAviso = 'Documento de apoyo para declarar en SRI en Línea — NO es el formulario oficial ni lo reemplaza. Verifique cada casillero contra el sistema del SRI antes de presentar la declaración. Los casilleros no soportados por AELA (activos fijos por separado, exportaciones, importaciones, tarifa turística variable, ventas/compras a crédito, notas de crédito por compensar) se detallan al final.';
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

    doc.fontSize(10).font('Helvetica-Bold').text('RESUMEN DE VENTAS Y OTRAS OPERACIONES');
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

    doc.fontSize(10).font('Helvetica-Bold').text('RESUMEN DE ADQUISICIONES Y PAGOS');
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

    doc.fontSize(10).font('Helvetica-Bold').text('FACTOR DE PROPORCIONALIDAD Y CRÉDITO TRIBUTARIO');
    doc.y = dibujarTablaPdf(doc, colResumen, [
      { cas: '563', desc: 'Factor de proporcionalidad (AELA asume 1.0000 — no soporta ventas mixtas gravadas/exentas)', valor: 1 },
      { cas: '564', desc: 'Crédito tributario aplicable en este período (529 x factor)', valor: c.ivaCreditoFiscal, _destacado: true },
      { cas: '565', desc: 'Valor de IVA no considerado como crédito tributario por factor de proporcionalidad', valor: 0 },
    ], doc.y);
    doc.moveDown(0.4);

    doc.fontSize(10).font('Helvetica-Bold').text('RESUMEN IMPOSITIVO: AGENTE DE PERCEPCIÓN DEL IVA');
    doc.y = dibujarTablaPdf(doc, colResumen, [
      { cas: '601', desc: 'Impuesto causado (si 429-564 es mayor que cero)', valor: r.impuestoCausado },
      { cas: '602', desc: 'Crédito tributario aplicable en este período (si 429-564 es menor que cero)', valor: r.creditoDelPeriodo },
      { cas: '605', desc: 'Saldo crédito tributario del mes anterior — por adquisiciones e importaciones', valor: r.creditoPorAdquisicionesAnterior },
      { cas: '606', desc: 'Saldo crédito tributario del mes anterior — por retenciones de IVA que le han sido efectuadas', valor: r.creditoPorRetencionesAnterior },
      { cas: '609', desc: 'Retenciones de IVA que le han sido efectuadas en este período', valor: f104.retenciones.totalRetenido },
      { cas: '615', desc: 'Saldo crédito tributario para el próximo mes — por adquisiciones e importaciones', valor: r.saldoCreditoAdquisicionesProximoMes },
      { cas: '617', desc: 'Saldo crédito tributario para el próximo mes — por retenciones de IVA que le han sido efectuadas', valor: r.saldoCreditoRetencionesProximoMes },
      { cas: '620/699', desc: 'SUBTOTAL / TOTAL A PAGAR POR PERCEPCIÓN', valor: r.subtotalAPagar, _destacado: true },
    ], doc.y);
    doc.fontSize(7).fillColor('#64748b')
      .text('605/606 se ingresan en Declaraciones, sección "Crédito tributario arrastrado" — cada uno arrastra el 615/617 de la declaración del período anterior. El orden de consumo contra el 601 es: primero 605+602, luego 606+609 (verificado contra una declaración real).')
      .fillColor('#000000');
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica-Bold').text('AGENTE DE RETENCIÓN DEL IVA (a proveedores)');
    doc.y = dibujarTablaPdf(doc, colResumen, [
      { cas: '721', desc: 'Retención del 10%', valor: re.iva10 },
      { cas: '723', desc: 'Retención del 20%', valor: re.iva20 },
      { cas: '725', desc: 'Retención del 30%', valor: re.iva30 },
      { cas: '727', desc: 'Retención del 50%', valor: re.iva50 },
      { cas: '729', desc: 'Retención del 70%', valor: re.iva70 },
      { cas: '731', desc: 'Retención del 100%', valor: re.iva100 },
      { cas: '799/801', desc: 'TOTAL IMPUESTO A PAGAR POR RETENCIÓN', valor: re.ivaRetenidoAProveedores, _destacado: true },
      { cas: '859', desc: 'TOTAL CONSOLIDADO DE IVA (699 + 801)', valor: r.totalConsolidado, _destacado: true },
    ], doc.y);
    doc.moveDown(0.5);

    if (doc.y > 600) doc.addPage();
    doc.fontSize(9).font('Helvetica-Bold').text('Casilleros no incluidos — requieren revisión y llenado manual');
    doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    [
      'Activos fijos por separado (402/412/422, 501/511/521): AELA no distingue compra/venta de activo fijo del resto.',
      'Exportaciones de bienes y servicios (407/408/417/418): no se registran en AELA.',
      'Importaciones de bienes, servicios y activos fijos (503/504/505 y DIM/DAU): revisar aduana manualmente.',
      'Tarifa turística variable (410/420/430, requiere casilla 203): no aplica salvo sector turismo.',
      'Ventas/compras a crédito (480/481/483/484/485 y 526/527): AELA no distingue cobro a contado vs a crédito, asume todo se declara en el mes de la venta.',
      'Notas de crédito por compensar en próximo mes (442/443/453/543/544/554): AELA neta todo en el período emitido.',
      'Compensaciones e IVA presuntivo (603/604/607/608/610-614/621/622/623), ISD devolución exportadores (700-702), pagos previos e imputación de sustitutivas (880-899).',
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
    // Casilleros 605 (adquisiciones) y 606 (retenciones) por separado desde
    // 2026-08-19 — antes era un solo valor combinado. Se acepta también el
    // campo viejo `creditoTributarioAnterior` como fallback → se guarda todo
    // en `creditoPorAdquisiciones` (mismo comportamiento visible que antes,
    // por si algún cliente viejo del API todavía lo manda así).
    const valorAdquisiciones = req.body.creditoPorAdquisiciones != null
      ? d(req.body.creditoPorAdquisiciones)
      : d(req.body.creditoTributarioAnterior);
    const valorRetenciones = d(req.body.creditoPorRetenciones);

    if (!anio || !mes || mes < 1 || mes > 12) {
      return res.status(400).json({ ok: false, mensaje: 'Período inválido' });
    }
    if (valorAdquisiciones < 0 || valorRetenciones < 0) {
      return res.status(400).json({ ok: false, mensaje: 'El crédito tributario no puede ser negativo' });
    }
    const valorCombinado = parseFloat((valorAdquisiciones + valorRetenciones).toFixed(2));

    await db.declaraciones_credito_iva.upsert({
      where: { empresaId_anio_mes: { empresaId, anio, mes } },
      update: {
        creditoPorAdquisiciones: valorAdquisiciones,
        creditoPorRetenciones: valorRetenciones,
        creditoTributarioAnterior: valorCombinado,
        usuarioId: req.usuario?.id || null,
      },
      create: {
        empresaId, anio, mes,
        creditoPorAdquisiciones: valorAdquisiciones,
        creditoPorRetenciones: valorRetenciones,
        creditoTributarioAnterior: valorCombinado,
        usuarioId: req.usuario?.id || null,
      },
    });

    res.json({ ok: true, data: { anio, mes, creditoPorAdquisiciones: valorAdquisiciones, creditoPorRetenciones: valorRetenciones } });
  } catch (err) {
    console.error('Error PUT /f104/credito-anterior:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── calcularF103 — cálculo completo del Formulario 103, reutilizado por el
// endpoint JSON (GET /f103) y por el generador de PDF (GET /f103/pdf) ─────────
async function calcularF103(db, empresaId, anio, mes) {
    const { desde, hasta } = rangoMes(anio, mes);
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

    return f103;
}

// ─── GET /f103 — Formulario 103 Retenciones en la Fuente mensual ───────────────
// Query: ?anio=2025&mes=3
router.get('/f103', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    const f103 = await calcularF103(db, empresaId, anio, mes);
    res.json({ ok: true, data: f103 });
  } catch (err) {
    console.error('Error F103:', err);
    res.status(500).json({ ok: false, mensaje: err.message });
  }
});

// ─── Mapeo de códigos de retención (los que usa AELA en el XML del comprobante,
// ver utils/sri.js CODIGOS_RETENCION_RENTA) contra el casillero oficial del
// Formulario 103 vigente — confirmado 2026-08-19 contra dos fuentes oficiales
// del SRI descargadas de sri.gob.ec/formularios-e-instructivos: el diseño
// Excel del formulario (hoja "Formulario RF desde ago 2026") y la "Guía del
// contribuyente Formulario 103" (19 páginas, resolución NAC-DGERCGC26-00000009
// de feb/2026). base = casillero de base imponible, retenido = casillero de
// valor retenido (null cuando el casillero real es 0%/no tiene par retenido,
// ej. "Pagos no sujetos a retención"). Casilleros de un solo dígito distinto
// al código no son error de tipeo — el SRI a veces agrupa varios códigos de
// comprobante bajo un casillero distinto de todos ellos (ej. 343A es 1%
// "Energía eléctrica" y cae en el casillero 343, NO en 344 como sugeriría el
// nombre — corregido contra la guía tras una primera lectura equivocada del
// Excel solo).
const CASILLEROS_F103 = {
  '303':   { base: '303',  retenido: '353'  },
  '303A':  { base: '3030', retenido: '3530' },
  '304':   { base: '304',  retenido: '354'  },
  '304A':  { base: '304',  retenido: '354'  },
  '304B':  { base: '304',  retenido: '354'  },
  '304C':  { base: '304',  retenido: '354'  },
  '304D':  { base: '304',  retenido: '354'  },
  '304E':  { base: '304',  retenido: '354'  },
  '307':   { base: '307',  retenido: '357'  },
  '308':   { base: '308',  retenido: '358'  },
  '310':   { base: '310',  retenido: '360'  },
  '311':   { base: '311',  retenido: '361'  },
  '312':   { base: '312',  retenido: '362'  },
  '312A':  { base: '3120', retenido: '3620' },
  '312C':  { base: '3121', retenido: '3621' },
  '314A':  { base: '314',  retenido: '364'  },
  '314B':  { base: '314',  retenido: '364'  },
  '314C':  { base: '314',  retenido: '364'  },
  '314D':  { base: '314',  retenido: '364'  },
  '319':   { base: '319',  retenido: '369'  },
  '320':   { base: '320',  retenido: '370'  },
  '322':   { base: '322',  retenido: '372'  },
  '323':   { base: '323',  retenido: '373'  },
  '323A':  { base: '323',  retenido: '373'  },
  '323B1': { base: '323',  retenido: '373'  },
  '323E':  { base: '323',  retenido: '373'  },
  '323E2': { base: '3230', retenido: null   },
  '323F':  { base: '323',  retenido: '373'  },
  '323G':  { base: '323',  retenido: '373'  },
  '323H':  { base: '323',  retenido: '373'  },
  '323I':  { base: '323',  retenido: '373'  },
  '323M':  { base: '323',  retenido: '373'  },
  '323N':  { base: '3230', retenido: null   },
  '323O':  { base: '3230', retenido: null   },
  '323P':  { base: '323',  retenido: '373'  },
  '323Q':  { base: '323',  retenido: '373'  },
  '323R':  { base: '3230', retenido: null   },
  '323S':  { base: '323',  retenido: '373'  },
  '323T':  { base: '3230', retenido: null   },
  '323U':  { base: '3230', retenido: null   },
  '324A':  { base: '324',  retenido: '374'  },
  '324B':  { base: '324',  retenido: '374'  },
  '324C':  { base: '324',  retenido: '374'  },
  '325':   { base: '325',  retenido: '375'  },
  '325A':  { base: '325',  retenido: '375'  },
  '3250':  { base: '3250', retenido: null   },
  '326':   { base: '326',  retenido: '376'  },
  '327':   { base: '327',  retenido: '377'  },
  '328':   { base: '328',  retenido: '378'  },
  '329':   { base: '329',  retenido: '379'  },
  '331':   { base: '331',  retenido: null   },
  '332':   { base: '332',  retenido: null   },
  '332B':  { base: '332',  retenido: null   },
  '332C':  { base: '332',  retenido: null   },
  '332D':  { base: '332',  retenido: null   },
  '332E':  { base: '3230', retenido: null   },
  '332F':  { base: '3230', retenido: null   },
  '332G':  { base: '332',  retenido: null   },
  '332H':  { base: '332',  retenido: null   },
  '332I':  { base: '332',  retenido: null   },
  '333':   { base: '333',  retenido: '383'  },
  '334':   { base: '334',  retenido: '384'  },
  '335':   { base: '335',  retenido: '385'  },
  '336':   { base: '336',  retenido: '386'  },
  '337':   { base: '337',  retenido: '387'  },
  '343':   { base: '343',  retenido: '393'  },
  '343A':  { base: '343',  retenido: '393'  },
  '343B':  { base: '3430', retenido: '3450' },
  '343C':  { base: '344',  retenido: '394'  },
  '3440':  { base: '3440', retenido: '3940' },
  '344A':  { base: '344',  retenido: '394'  },
  '344B':  { base: '344',  retenido: '394'  },
  '346B':  { base: '346',  retenido: '396'  },
  '346D':  { base: '3370', retenido: '3870' },
  '350':   { base: '350',  retenido: '400'  },
  '3482':  { base: '3140', retenido: '3640' },
};

// ─── GET /f103/pdf — Documento de apoyo para el llenado del Formulario 103 ─────
// NO es el formulario oficial ni lo reemplaza. Mapea el detalle por código de
// retención (que AELA ya calcula) contra el casillero oficial usando
// CASILLEROS_F103 de arriba. Query: ?anio=2025&mes=3
router.get('/f103/pdf', async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mes  = parseInt(req.query.mes)  || new Date().getMonth() + 1;
    const empresaId = req.empresa.id;
    const db = req.prisma || prisma;

    const f103 = await calcularF103(db, empresaId, anio, mes);
    const config = await db.configuracion_sri.findFirst({ where: { empresaId } });
    const money = (v) => `$${Number(v || 0).toFixed(2)}`;

    const doc = crearDocumentoPdf(res, `f103_${anio}_${String(mes).padStart(2, '0')}.pdf`);
    dibujarEncabezadoContable(doc, config, 'Formulario 103 — Retenciones en la Fuente del IR');

    doc.fontSize(9).font('Helvetica-Bold')
      .text(`Período: ${NOMBRES_MES[mes - 1]} ${anio}`, { align: 'center' });
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
      .text(`Generado: ${new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })}`, { align: 'center' })
      .fillColor('#000000');
    doc.moveDown(0.3);

    const ML = doc.page.margins.left;
    const Wtotal = doc.page.width - ML - doc.page.margins.right;
    const yAviso = doc.y;
    const textoAviso = 'Documento de apoyo para declarar en SRI en Línea — NO es el formulario oficial ni lo reemplaza. Verifique cada casillero contra el sistema del SRI antes de presentar la declaración. Solo cubre retenciones a residentes/establecimientos permanentes en Ecuador (no pagos al exterior, IRU banano ni pronósticos deportivos) — ver notas al final.';
    const altoAviso = doc.heightOfString(textoAviso, { width: Wtotal - 12 }) + 10;
    doc.rect(ML, yAviso, Wtotal, altoAviso).fillAndStroke('#fef3c7', '#f59e0b');
    doc.fillColor('#78350f').fontSize(7.5).font('Helvetica')
      .text(textoAviso, ML + 6, yAviso + 5, { width: Wtotal - 12 });
    doc.fillColor('#000000');
    doc.y = yAviso + altoAviso + 8;
    doc.x = ML;

    const columnas = [
      { header: 'Cas. Base',    key: 'casBase',     width: 55 },
      { header: 'Cas. Ret.',    key: 'casRetenido', width: 55 },
      { header: 'Descripción',  key: 'descripcion', width: 210 },
      { header: '%',            key: 'porcentaje',   width: 40,  align: 'right', formato: (v) => (v == null ? '—' : `${v}%`) },
      { header: 'Base Imp.',    key: 'baseImponible', width: 78, align: 'right', formato: money },
      { header: 'Val. Retenido', key: 'valorRetenido', width: 78, align: 'right', formato: money },
    ];

    const sinCasillero = [];
    const filas = f103.detallePorCodigo.map((r) => {
      const cas = CASILLEROS_F103[r.codigo];
      if (!cas) sinCasillero.push(r);
      return {
        casBase: cas ? cas.base : '(!)',
        casRetenido: cas ? (cas.retenido || '—') : '(!)',
        descripcion: `${r.descripcion} (código ${r.codigo})`,
        porcentaje: r.porcentaje,
        baseImponible: r.baseImponible,
        valorRetenido: r.valorRetenido,
      };
    });
    filas.push({
      casBase: '399', casRetenido: '499', descripcion: 'TOTAL DE RETENCIÓN DE IMPUESTO A LA RENTA', porcentaje: null,
      baseImponible: f103.detallePorCodigo.reduce((s, r) => s + r.baseImponible, 0), valorRetenido: f103.totalRetenido,
      _destacado: true,
    });

    doc.fontSize(10).font('Helvetica-Bold').text('DETALLE POR CÓDIGO DE RETENCIÓN');
    doc.y = dibujarTablaPdf(doc, columnas, filas, doc.y);
    doc.moveDown(0.3);

    if (sinCasillero.length > 0) {
      doc.fontSize(7.5).fillColor('#b45309').font('Helvetica-Bold')
        .text(`(!) ${sinCasillero.length} código(s) sin casillero confirmado (marcados arriba con "(!)") — verificar manualmente contra "SRI en Línea": ${sinCasillero.map((r) => r.codigo).join(', ')}.`, { width: Wtotal });
      doc.fillColor('#000000').font('Helvetica');
      doc.moveDown(0.4);
    }

    doc.fontSize(9).font('Helvetica-Bold').text(`${f103.cantidadComprobantes} comprobante(s) de retención en el período`);
    doc.font('Helvetica').fontSize(8)
      .text(`${f103.meta.comprobantesAutorizados} autorizado(s)${f103.meta.comprobantesPendientes > 0 ? `, ${f103.meta.comprobantesPendientes} pendiente(s) de autorización` : ''}.`);
    doc.moveDown(0.5);

    if (doc.y > 640) doc.addPage();
    doc.fontSize(9).font('Helvetica-Bold').text('Casilleros no incluidos — requieren revisión y llenado manual');
    doc.font('Helvetica').fontSize(7.5).fillColor('#334155');
    [
      'Relación de dependencia (302/352): AELA no emite el comprobante de retención tipo 07 para nómina (usa el Formulario 107 anual, no soportado hoy).',
      'Pagos a no residentes (402-433/497-498): retenciones a proveedores del exterior no se registran en AELA.',
      'IRU Banano exportador y Pronósticos deportivos (3400-3999, 3480-3498, 5100/5300): sectores especializados no soportados.',
      'Códigos 346 (genérico), 346A y 346C: existen en el catálogo interno de AELA pero la guía oficial no confirma su casillero exacto de forma inequívoca — si aparecen en el detalle de arriba, revisar el porcentaje/concepto contra "SRI en Línea" antes de transcribir.',
      'Código 3481 (Autorretenciones Sociedades Grandes Contribuyentes): la guía oficial lo marca vigente solo hasta junio 2021 — no debería usarse en comprobantes nuevos.',
      'Compensación por pago a cuenta sobre utilidades no distribuidas (500/501), pagos previos e imputación de sustitutivas (880-899), intereses/multas (903/904).',
    ].forEach((linea) => { doc.text(`• ${linea}`); doc.moveDown(0.15); });
    doc.fillColor('#000000');

    doc.end();
  } catch (err) {
    console.error('Error F103 PDF:', err);
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
