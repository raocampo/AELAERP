// ====================================
// RUTAS: PROFORMAS (Cotizaciones / Presupuestos)
// backend/routes/proformas.js
// ====================================

const express     = require('express');
const router      = express.Router();
const fs          = require('fs');
const os          = require('os');
const nodePath    = require('path');
const PDFDocument = require('pdfkit');
const { proteger, permitir } = require('../middleware/auth');
const { normalizarRol }      = require('../utils/roles');
const prisma                 = require('../config/prisma');
const { enviarConFallback }  = require('../utils/email');

// ─── Helper: resolver logo (igual que sri.js) ─────────────────────────────────
function _resolverLogo(logoUrl) {
  if (!logoUrl) return { logoData: null, tienelogo: false };
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return { logoData: Buffer.from(b64, 'base64'), tienelogo: true };
    } catch { return { logoData: null, tienelogo: false }; }
  }
  const logoPath = nodePath.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  const existe   = fs.existsSync(logoPath);
  return { logoData: existe ? logoPath : null, tienelogo: existe };
}

// ─── Helper: generar PDF de proforma con PDFKit (misma técnica que RIDE) ──────
function _generarPdfProforma(p, configSri, outputPath) {
  return new Promise((resolve, reject) => {
    const cfg = configSri || {};
    const detalles = Array.isArray(p.detalles) ? p.detalles
      : (typeof p.detalles === 'string' ? JSON.parse(p.detalles) : []);

    const fmtFecha = (d) => {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const doc    = new PDFDocument({ size: 'A4', margins: { top: 24, bottom: 24, left: 32, right: 32 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML    = 32;
    const PW    = doc.page.width;
    const PH    = doc.page.height;
    const W     = PW - ML * 2;

    const MORADO = '#6d28d9';
    const GRIS   = '#555555';
    const NEGRO  = '#000000';
    const BLANCO = '#FFFFFF';
    const BG_ALT = '#f5f3ff';

    const { logoData, tienelogo }   = _resolverLogo(cfg.logoUrl);
    const { logoData: firmaData,  tienelogo: tieneFirma  } = _resolverLogo(cfg.firmaUrl);
    const { logoData: selloData,  tienelogo: tieneSello  } = _resolverLogo(cfg.selloUrl);

    // ── HEADER ────────────────────────────────────────────────────────────────
    let y = 24;
    const LP   = Math.floor(W * 0.46);
    const GAP  = 10;
    const RP_X = ML + LP + GAP;
    const RP_W = W - LP - GAP;

    // Panel izquierdo: logo (ancho completo) + RUC grande + emisor
    let yL = y;
    if (tienelogo) {
      try { doc.image(logoData, ML, yL, { fit: [LP, 70], align: 'left' }); yL += 76; }
      catch { /* logo inválido */ }
    }
    // RUC destacado arriba de la razón social
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS)
       .text('R.U.C.: ', ML, yL, { continued: true, lineBreak: false });
    doc.fontSize(9).font('Helvetica-Bold').fillColor(MORADO)
       .text(cfg.ruc || '', { lineBreak: false });
    yL += 14;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text((cfg.razonSocial || '').toUpperCase(), ML, yL, { width: LP, lineBreak: false });
    yL += 13;
    if (cfg.nombreComercial) {
      doc.fontSize(7.5).font('Helvetica').fillColor(GRIS)
         .text(cfg.nombreComercial, ML, yL, { width: LP, lineBreak: false });
      yL += 11;
    }
    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Dir.: ${cfg.dirMatriz || cfg.dirEstablecimiento || ''}`, ML, yL, { width: LP });
    yL = doc.y + 2;
    if (cfg.telefono) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Telf.: ${cfg.telefono}`, ML, yL, { width: LP, lineBreak: false });
      yL += 10;
    }
    if (cfg.emailNotificaciones || cfg.email) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(cfg.emailNotificaciones || cfg.email, ML, yL, { width: LP, lineBreak: false });
      yL += 10;
    }
    if (cfg.contribuyenteRimpe) {
      const rimpeLabel = cfg.negocioPopular
        ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
        : 'CONTRIBUYENTE RÉGIMEN RIMPE';
      doc.fontSize(6).font('Helvetica-Bold').fillColor(MORADO)
         .text(rimpeLabel, ML, yL, { width: LP, lineBreak: false });
      yL += 10;
    }

    // Panel derecho: PROFORMA + número + recuadro de fechas
    let yR = y;
    doc.fontSize(16).font('Helvetica-Bold').fillColor(MORADO)
       .text('PROFORMA', RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 22;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text(`No. ${p.numero || ''}`, RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 14;

    doc.moveTo(RP_X, yR).lineTo(RP_X + RP_W, yR).lineWidth(0.4).stroke('#CCCCCC');
    yR += 6;

    // Recuadro con fechas (4 campos en 2×2)
    const BOX_H = 54;
    doc.rect(RP_X, yR, RP_W, BOX_H).lineWidth(0.7).stroke('#AAAAAA');
    const colW  = RP_W / 2 - 4;
    const datosRight = [
      { l: 'FECHA DE EMISIÓN', v: fmtFecha(p.createdat || p.createdAt) },
      { l: 'VÁLIDA DESDE',     v: fmtFecha(p.vigenciadesde || p.vigenciaDesde) },
      { l: 'VÁLIDA HASTA',     v: fmtFecha(p.vigenciahasta || p.vigenciaHasta), bold: true },
      { l: 'ESTADO',           v: (p.estado || 'BORRADOR') },
    ];
    let yDat = yR + 5;
    datosRight.forEach((d, i) => {
      const col = i % 2 === 0 ? 0 : 1;
      const xd  = RP_X + 4 + col * (colW + 8);
      if (i === 2) { yDat += 14; }
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(GRIS)
         .text(d.l + ':', xd, yDat, { width: colW, lineBreak: false });
      doc.fontSize(7).font(d.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(d.bold ? MORADO : NEGRO)
         .text(d.v, xd, yDat + 7, { width: colW, lineBreak: false });
      if (i === 1) yDat += 14;
    });
    yR += BOX_H + 4;

    y = Math.max(yL, yR) + 8;

    // ── DATOS DEL CLIENTE ────────────────────────────────────────────────────
    const esConsumidorFinal = p.tipoIdentificacion === '07' || p.tipoidentificacion === '07';
    const idCliente         = esConsumidorFinal ? '9999999999999' : (p.identificacion || p.identificacion || '—');

    const COMP_H = p.direccion ? 54 : 40;
    doc.rect(ML, y, W, COMP_H).lineWidth(0.5).stroke('#AAAAAA');
    doc.moveTo(ML, y + 20).lineTo(ML + W, y + 20).lineWidth(0.3).stroke('#CCCCCC');

    const COL_ID_W = W * 0.55;
    doc.moveTo(ML + COL_ID_W, y + 20).lineTo(ML + COL_ID_W, y + COMP_H)
       .lineWidth(0.3).stroke('#CCCCCC');

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RAZÓN SOCIAL / NOMBRES Y APELLIDOS:', ML + 3, y + 3, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(NEGRO)
       .text(p.razonSocial || p.razonsocial || 'CONSUMIDOR FINAL', ML + 3, y + 12, { width: W - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RUC / IDENTIFICACIÓN:', ML + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(idCliente, ML + 3, y + 32, { width: COL_ID_W - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('TELÉFONO:', ML + COL_ID_W + 3, y + 23, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(p.telefono || '—', ML + COL_ID_W + 3, y + 32, { lineBreak: false });

    if (p.direccion) {
      doc.moveTo(ML, y + 40).lineTo(ML + W, y + 40).lineWidth(0.3).stroke('#CCCCCC');
      doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
         .text('DIRECCIÓN:', ML + 3, y + 43, { lineBreak: false });
      doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
         .text(p.direccion, ML + 72, y + 43, { width: W - 76, lineBreak: false });
    }
    y += COMP_H + 6;

    // ── TABLA DE DETALLES ────────────────────────────────────────────────────
    const COLS = [
      { h: 'Cód.',         w: 48,  al: 'left'  },
      { h: 'Cantidad',     w: 38,  al: 'right' },
      { h: 'Descripción',  w: 0,   al: 'left'  },
      { h: 'P. Unitario',  w: 54,  al: 'right' },
      { h: 'Descuento',    w: 46,  al: 'right' },
      { h: '% IVA',        w: 30,  al: 'right' },
      { h: 'Total',        w: 54,  al: 'right' },
    ];
    const fixedW = COLS.filter(c => c.w > 0).reduce((s, c) => s + c.w, 0);
    COLS.find(c => c.w === 0).w = W - fixedW;

    const TH_H = 18;
    doc.rect(ML, y, W, TH_H).fill(MORADO);
    let cx = ML;
    COLS.forEach(col => {
      doc.fontSize(5.5).font('Helvetica-Bold').fillColor(BLANCO)
         .text(col.h, cx + 2, y + 5, { width: col.w - 4, align: col.al, lineBreak: false });
      cx += col.w;
    });
    y += TH_H;

    detalles.forEach((det, idx) => {
      const cant   = parseFloat(det.cantidad)       || 0;
      const prec   = parseFloat(det.precioUnitario) || 0;
      const desc   = parseFloat(det.descuento)      || 0;
      const ivaPct = parseInt(det.ivaPorcentaje)    || 0;
      const tot    = cant * prec - desc;
      const ROW_H  = 14;

      if (y > PH - 160) { doc.addPage(); y = 32; }

      doc.rect(ML, y, W, ROW_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(ML, y, W, ROW_H).lineWidth(0.2).stroke('#DDDDDD');

      const vals = [
        { v: det.codigo || det.codigoPrincipal || '',  al: 'left'  },
        { v: cant.toFixed(2),                          al: 'right' },
        { v: det.descripcion || '',                    al: 'left'  },
        { v: prec.toFixed(2),                          al: 'right' },
        { v: desc > 0 ? desc.toFixed(2) : '—',        al: 'right' },
        { v: `${ivaPct}%`,                             al: 'right' },
        { v: tot.toFixed(2),                           al: 'right' },
      ];
      cx = ML;
      vals.forEach((v, vi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(v.v, cx + 2, y + 4, { width: COLS[vi].w - 4, align: v.al, lineBreak: false });
        cx += COLS[vi].w;
      });
      y += ROW_H;
    });

    // ── FOOTER: info izq + totales der ───────────────────────────────────────
    y += 10;
    const FP_W  = Math.floor(W * 0.50);
    const TOT_X = ML + FP_W + 4;
    const TOT_W = W - FP_W - 4;
    let yLeft = y;

    // Información adicional
    const camposIA = [];
    if (p.vigenciadesde || p.vigenciaDesde)
      camposIA.push({ n: 'Válida desde', v: fmtFecha(p.vigenciadesde || p.vigenciaDesde) });
    if (p.vigenciahasta || p.vigenciaHasta)
      camposIA.push({ n: 'Válida hasta', v: fmtFecha(p.vigenciahasta || p.vigenciaHasta) });
    if (p.formapago || p.formaPago)
      camposIA.push({ n: 'Forma de pago', v: p.formapago || p.formaPago });
    if (p.email) camposIA.push({ n: 'Correo', v: p.email });
    if (p.observaciones) camposIA.push({ n: 'Observaciones', v: p.observaciones });

    if (camposIA.length > 0) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(MORADO)
         .text('INFORMACIÓN ADICIONAL', ML, yLeft, { lineBreak: false });
      yLeft += 11;

      const IA_H    = 12;
      const LABEL_W = FP_W * 0.36;
      const VAL_W   = FP_W - LABEL_W;

      doc.rect(ML, yLeft, FP_W, IA_H).fill(MORADO);
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Campo', ML + 3, yLeft + 3, { width: LABEL_W - 6, lineBreak: false });
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Valor', ML + LABEL_W + 3, yLeft + 3, { width: VAL_W - 6, lineBreak: false });
      yLeft += IA_H;

      camposIA.forEach((campo, idx) => {
        doc.rect(ML, yLeft, FP_W, IA_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
        doc.rect(ML, yLeft, FP_W, IA_H).lineWidth(0.2).stroke('#DDDDDD');
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRIS)
           .text(campo.n, ML + 3, yLeft + 2, { width: LABEL_W - 6, lineBreak: false });
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(campo.v, ML + LABEL_W + 3, yLeft + 2, { width: VAL_W - 6, lineBreak: false });
        yLeft += IA_H;
      });
    }

    // Caja de totales
    const st0   = parseFloat(p.subtotal0  || 0);
    const st5   = parseFloat(p.subtotal5  || 0);
    const st15  = parseFloat(p.subtotal15 || 0);
    const descT = parseFloat(p.totalDescuento || 0);
    const iva   = parseFloat(p.totalIva   || 0);
    const total = parseFloat(p.importetotal || p.importeTotal || 0);

    const TOT_ROWS = [
      ...(st0  > 0 ? [{ l: 'SUBTOTAL 0%',     v: st0  }] : []),
      ...(st5  > 0 ? [{ l: 'SUBTOTAL 5%',     v: st5  }] : []),
      ...(st15 > 0 ? [{ l: 'SUBTOTAL 15%',    v: st15 }] : []),
      ...(descT > 0 ? [{ l: 'TOTAL DESCUENTO', v: descT }] : []),
      { l: 'IVA',         v: iva   },
      { l: 'VALOR TOTAL', v: total, bold: true },
    ];

    const TR_H      = 13;
    const TOT_BOX_H = TOT_ROWS.length * TR_H + 4;
    doc.rect(TOT_X, y, TOT_W, TOT_BOX_H).lineWidth(0.5).stroke('#AAAAAA');

    let yT = y + 2;
    TOT_ROWS.forEach((row, ri) => {
      if (ri > 0) doc.moveTo(TOT_X, yT).lineTo(TOT_X + TOT_W, yT).lineWidth(0.2).stroke('#DDDDDD');
      const fn = row.bold ? 'Helvetica-Bold' : 'Helvetica';
      const fc = row.bold ? MORADO : NEGRO;
      const bg = row.bold ? '#ede9fe' : (ri % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(TOT_X, yT, TOT_W, TR_H).fill(bg);
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(row.l, TOT_X + 3, yT + 3, { width: TOT_W * 0.62 - 3, align: 'left', lineBreak: false });
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(`$${row.v.toFixed(2)}`, TOT_X + TOT_W * 0.62, yT + 3, { width: TOT_W * 0.38 - 3, align: 'right', lineBreak: false });
      yT += TR_H;
    });

    // ── FIRMA Y SELLO ─────────────────────────────────────────────────────────
    const afterFooter = Math.max(yLeft, yT) + 16;
    const IMG_W = Math.floor(W * 0.28);
    const IMG_H = 55;
    const SEP_W = (W - IMG_W * 2) / 3;

    const xFirma = ML + SEP_W;
    const xSello = ML + SEP_W * 2 + IMG_W;

    if (tieneFirma || tieneSello) {
      let yImg = afterFooter;

      if (tieneFirma) {
        try { doc.image(firmaData, xFirma, yImg, { fit: [IMG_W, IMG_H], align: 'center' }); }
        catch { /* imagen inválida */ }
      }
      if (tieneSello) {
        try { doc.image(selloData, xSello, yImg, { fit: [IMG_W, IMG_H], align: 'center' }); }
        catch { /* imagen inválida */ }
      }

      const yLine = yImg + IMG_H + 4;
      doc.moveTo(xFirma, yLine).lineTo(xFirma + IMG_W, yLine).lineWidth(0.5).stroke('#AAAAAA');
      doc.fontSize(6).font('Helvetica').fillColor(GRIS)
         .text('Firma Autorizada', xFirma, yLine + 3, { width: IMG_W, align: 'center', lineBreak: false });

      doc.moveTo(xSello, yLine).lineTo(xSello + IMG_W, yLine).lineWidth(0.5).stroke('#AAAAAA');
      doc.fontSize(6).font('Helvetica').fillColor(GRIS)
         .text('Sello Empresarial', xSello, yLine + 3, { width: IMG_W, align: 'center', lineBreak: false });
    }

    // ── PIE DE PÁGINA ─────────────────────────────────────────────────────────
    const bottomBase = (tieneFirma || tieneSello) ? afterFooter + IMG_H + 18 : afterFooter;
    const bottomY    = bottomBase + 6;
    doc.moveTo(ML, bottomY).lineTo(ML + W, bottomY).lineWidth(0.4).stroke('#CCCCCC');
    doc.fontSize(6).font('Helvetica').fillColor('#888888')
       .text(
         'Este documento es una cotización / presupuesto y no tiene validez tributaria. ' +
         'Para emitir un comprobante válido, convierta esta proforma a Factura.',
         ML, bottomY + 5, { width: W, align: 'center' }
       );

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// Todas las rutas requieren autenticación
router.use(proteger);

// Fallback: en modo monoempresa (sin tenant resuelto) req.prisma es undefined;
// usar el proxy global que apunta a DATABASE_URL
router.use((req, _res, next) => { if (!req.prisma) req.prisma = prisma; next(); });

// ─── Helper: siguiente secuencial ────────────────────────────────────────────
async function siguienteSecuencial(prisma, empresaId) {
  const last = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(MAX("secuencial"), 0) + 1 AS next FROM proformas WHERE "empresaId" = $1`,
    empresaId
  );
  return parseInt(last[0]?.next || 1, 10);
}

function formatNumero(sec) {
  return `PRF-001-${String(sec).padStart(9, '0')}`;
}

function calcularTotales(detalles) {
  let sub0 = 0, sub5 = 0, sub15 = 0, totalDesc = 0, totalIva = 0;
  for (const d of detalles) {
    const cant   = parseFloat(d.cantidad)       || 0;
    const precio = parseFloat(d.precioUnitario) || 0;
    const desc   = parseFloat(d.descuento)      || 0;
    const iva    = parseInt(d.ivaPorcentaje)    || 0;
    const sub    = cant * precio - desc;
    totalDesc += desc;
    if (iva === 0 || iva === 6 || iva === 7) sub0  += sub;
    if (iva === 5)  sub5  += sub;
    if (iva === 15) sub15 += sub;
    if (iva === 5)  totalIva += sub * 0.05;
    if (iva === 15) totalIva += sub * 0.15;
  }
  return {
    subtotal0:      parseFloat(sub0.toFixed(2)),
    subtotal5:      parseFloat(sub5.toFixed(2)),
    subtotal15:     parseFloat(sub15.toFixed(2)),
    totalDescuento: parseFloat(totalDesc.toFixed(2)),
    totalIva:       parseFloat(totalIva.toFixed(2)),
    importeTotal:   parseFloat((sub0 + sub5 + sub15 + totalIva).toFixed(2)),
  };
}

// ─── GET / — listar proformas con filtros ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { estado, q, desde, hasta, page = 1, limit = 25 } = req.query;
    const empresaId = req.empresa.id;
    const offset    = (parseInt(page) - 1) * parseInt(limit);

    let where = `WHERE p."empresaId" = $1`;
    const params = [empresaId];
    let i = 2;

    if (estado) { where += ` AND p.estado = $${i++}`; params.push(estado); }
    if (q)      { where += ` AND (p."razonSocial" ILIKE $${i} OR p.numero ILIKE $${i})`; params.push(`%${q}%`); i++; }
    if (desde)  { where += ` AND p."createdAt" >= $${i++}`; params.push(desde); }
    if (hasta)  { where += ` AND p."createdAt" <= $${i++}`; params.push(hasta); }

    const countSql = `SELECT COUNT(*) FROM proformas p ${where}`;
    const dataSql  = `
      SELECT p.id, p.numero, p."razonSocial", p."identificacion",
             p."importeTotal", p.estado, p."vigenciaHasta", p."createdAt", p."facturaId"
      FROM proformas p ${where}
      ORDER BY p."createdAt" DESC
      LIMIT $${i} OFFSET $${i+1}
    `;
    params.push(parseInt(limit), offset);

    const [countRes, dataRes] = await Promise.all([
      req.prisma.$queryRawUnsafe(countSql, ...params.slice(0, i - 1)),
      req.prisma.$queryRawUnsafe(dataSql,  ...params),
    ]);

    res.json({
      ok: true,
      data:  dataRes,
      total: parseInt(countRes[0]?.count || 0),
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('[proformas] GET /', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al listar proformas' });
  }
});

// ─── POST / — crear proforma ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      tipoIdentificacion = '07',
      identificacion     = '9999999999999',
      razonSocial,
      direccion, email, telefono, clienteId,
      detalles = [],
      observaciones,
      vigenciaDesde, vigenciaHasta,
      formaPago,
    } = req.body;

    if (!razonSocial?.trim()) return res.status(400).json({ ok: false, mensaje: 'Razón social requerida' });
    if (!detalles.length)     return res.status(400).json({ ok: false, mensaje: 'Debe incluir al menos un detalle' });

    const empresaId = req.empresa.id;
    const totales   = calcularTotales(detalles);
    const sec       = await siguienteSecuencial(req.prisma, empresaId);
    const numero    = formatNumero(sec);

    const [row] = await req.prisma.$queryRawUnsafe(`
      INSERT INTO proformas (
        "empresaId", "numero", "secuencial",
        "tipoIdentificacion", "identificacion", "razonSocial",
        "direccion", "email", "telefono", "clienteId",
        "subtotal0", "subtotal5", "subtotal15",
        "totalDescuento", "totalIva", "importeTotal",
        "detalles", "observaciones",
        "vigenciaDesde", "vigenciaHasta",
        "estado", "creadoPor", "formaPago"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::timestamp,$20::timestamp,$21,$22,$23
      ) RETURNING *
    `,
      empresaId, numero, sec,
      tipoIdentificacion, identificacion, razonSocial.trim(),
      direccion || null, email || null, telefono || null, clienteId || null,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      vigenciaDesde || null, vigenciaHasta || null,
      'BORRADOR', req.usuario.id, formaPago || null,
    );

    res.status(201).json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] POST /', err.message, err.stack);
    res.status(500).json({ ok: false, mensaje: err.message || 'Error al crear proforma' });
  }
});

// ─── GET /:id — detalle ────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const [row] = await req.prisma.$queryRawUnsafe(
      `SELECT * FROM proformas WHERE id = $1 AND "empresaId" = $2`,
      parseInt(req.params.id), req.empresa.id
    );
    if (!row) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al obtener proforma' });
  }
});

// ─── PUT /:id — editar (solo BORRADOR o ENVIADA) ──────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const empresaId = req.empresa.id;
    const id        = parseInt(req.params.id);

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual)                                                  return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (!['BORRADOR', 'ENVIADA'].includes(actual.estado))        return res.status(400).json({ ok: false, mensaje: `No se puede editar una proforma en estado ${actual.estado}` });

    const {
      tipoIdentificacion, identificacion, razonSocial,
      direccion, email, telefono, clienteId,
      detalles = [], observaciones, vigenciaDesde, vigenciaHasta,
      formaPago,
    } = req.body;

    if (!razonSocial?.trim()) return res.status(400).json({ ok: false, mensaje: 'Razón social requerida' });
    if (!detalles.length)     return res.status(400).json({ ok: false, mensaje: 'Debe incluir al menos un detalle' });

    const totales = calcularTotales(detalles);

    const [row] = await req.prisma.$queryRawUnsafe(`
      UPDATE proformas SET
        "tipoIdentificacion" = $3, "identificacion" = $4, "razonSocial" = $5,
        "direccion" = $6, "email" = $7, "telefono" = $8, "clienteId" = $9,
        "subtotal0" = $10, "subtotal5" = $11, "subtotal15" = $12,
        "totalDescuento" = $13, "totalIva" = $14, "importeTotal" = $15,
        "detalles" = $16::jsonb, "observaciones" = $17,
        "vigenciaDesde" = $18::timestamp, "vigenciaHasta" = $19::timestamp,
        "formaPago" = $20, "updatedAt" = NOW()
      WHERE id = $1 AND "empresaId" = $2
      RETURNING *
    `,
      id, empresaId,
      tipoIdentificacion, identificacion, razonSocial.trim(),
      direccion || null, email || null, telefono || null, clienteId || null,
      totales.subtotal0, totales.subtotal5, totales.subtotal15,
      totales.totalDescuento, totales.totalIva, totales.importeTotal,
      JSON.stringify(detalles), observaciones || null,
      vigenciaDesde || null, vigenciaHasta || null,
      formaPago || null,
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[proformas] PUT /:id', err.message, err.stack);
    res.status(500).json({ ok: false, mensaje: err.message || 'Error al actualizar proforma' });
  }
});

// ─── POST /:id/estado — cambiar estado (enviar, aceptar, rechazar) ────────────
router.post('/:id/estado', async (req, res) => {
  try {
    const { nuevoEstado } = req.body;
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    const TRANSICIONES = {
      BORRADOR: ['ENVIADA'],
      ENVIADA:  ['ACEPTADA', 'RECHAZADA'],
    };

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const permitidos = TRANSICIONES[actual.estado] || [];
    if (!permitidos.includes(nuevoEstado)) {
      return res.status(400).json({ ok: false, mensaje: `No se puede cambiar de ${actual.estado} a ${nuevoEstado}` });
    }

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = $3, "updatedAt" = NOW() WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId, nuevoEstado
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al cambiar estado' });
  }
});

// ─── POST /:id/marcar-convertida — marcar como CONVERTIDA con facturaId ───────
router.post('/:id/marcar-convertida', async (req, res) => {
  try {
    const { facturaId } = req.body;
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    if (!['admin', 'supervisor', 'facturador'].includes(rol)) {
      return res.status(403).json({ ok: false, mensaje: 'Sin permiso para convertir proformas' });
    }

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (['CONVERTIDA', 'ANULADA'].includes(actual.estado)) {
      return res.status(400).json({ ok: false, mensaje: `La proforma ya está en estado ${actual.estado}` });
    }

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = 'CONVERTIDA', "facturaId" = $3, "updatedAt" = NOW()
       WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId, facturaId || null
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al marcar proforma como convertida' });
  }
});

// ─── POST /:id/enviar-email — enviar proforma por correo al cliente ───────────
router.post('/:id/enviar-email', async (req, res) => {
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const { emailDestino } = req.body; // opcional: sobreescribe el email del cliente

    const [p] = await req.prisma.$queryRawUnsafe(
      `SELECT p.*, e."razonSocial" AS "razonSocialEmisor", e."nombreComercial" AS "nombreComercialEmisor"
       FROM proformas p
       LEFT JOIN empresas e ON e.id = p."empresaId"
       WHERE p.id = $1 AND p."empresaId" = $2`,
      id, empresaId
    );
    if (!p) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const configSri = await req.prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } }) || {};

    const destino = emailDestino || p.email;
    if (!destino) return res.status(400).json({ ok: false, mensaje: 'El cliente no tiene email registrado. Ingresa un correo manualmente.' });

    // Construir tabla de detalles en HTML
    const detalles = typeof p.detalles === 'string' ? JSON.parse(p.detalles) : (p.detalles || []);
    const filasDetalle = detalles.map(d => {
      const cant   = parseFloat(d.cantidad       || 1);
      const precio = parseFloat(d.precioUnitario || 0);
      const desc   = parseFloat(d.descuento      || 0);
      const total  = (cant * precio - desc).toFixed(2);
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0">${d.descripcion || ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:center">${cant}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right">$${parseFloat(precio).toFixed(2)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:600">$${total}</td>
      </tr>`;
    }).join('');

    const vigencia = p.vigenciaHasta
      ? new Date(p.vigenciaHasta).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : null;
    const emisorLabel = p.nombreComercialEmisor || p.razonSocialEmisor || 'AELA ERP';

    const html = `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#7C3AED,#6d28d9);padding:36px 40px 28px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">${emisorLabel}</h1>
            <p style="color:rgba(255,255,255,.7);margin:6px 0 0;font-size:13px">AELA ERP · by CorpSimtelec</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px 28px;">
            <p style="color:#64748b;margin:0 0 4px;font-size:14px">Estimado/a cliente,</p>
            <h2 style="color:#1e293b;margin:0 0 6px;font-size:20px;font-weight:700">
              Proforma <span style="color:#7C3AED">${p.numero}</span>
            </h2>
            <p style="color:#475569;margin:0 0 28px;font-size:14px;line-height:1.6">
              Le enviamos la cotización/presupuesto detallada a continuación.<br/>
              ${vigencia ? `Esta proforma tiene validez hasta el <strong>${vigencia}</strong>.` : ''}
            </p>
            <!-- Datos cliente -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:24px;">
              <tr><td style="padding:16px 20px;">
                <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;color:#94a3b8">Cliente</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#1e293b">${p.razonSocial || ''}</p>
                ${p.identificacion && p.tipoIdentificacion !== '07' ? `<p style="margin:4px 0 0;font-size:13px;color:#64748b">${p.identificacion}</p>` : ''}
              </td></tr>
            </table>
            <!-- Tabla de detalles -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th style="padding:10px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Descripción</th>
                  <th style="padding:10px 12px;text-align:center;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Cant.</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">P. Unit.</th>
                  <th style="padding:10px 12px;text-align:right;font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;border-bottom:1px solid #e2e8f0">Total</th>
                </tr>
              </thead>
              <tbody>${filasDetalle}</tbody>
            </table>
            <!-- Total -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
              <tr><td style="text-align:right;padding:4px 0;color:#64748b;font-size:13px">IVA incluido</td></tr>
              <tr><td style="text-align:right;padding:8px 0;">
                <span style="font-size:22px;font-weight:800;color:#7C3AED">TOTAL: $${parseFloat(p.importeTotal || 0).toFixed(2)}</span>
              </td></tr>
            </table>
            ${p.observaciones ? `<p style="color:#475569;font-size:13px;background:#f8fafc;padding:12px 16px;border-radius:8px;border-left:3px solid #7C3AED;margin-bottom:24px">${p.observaciones}</p>` : ''}
            <p style="color:#94a3b8;font-size:13px;margin:0">Si tiene consultas sobre esta proforma, contáctenos por los medios indicados abajo.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;">
            <p style="color:#94a3b8;font-size:13px;margin:0 0 6px">¿Necesitas ayuda? Estamos disponibles <strong>24/7</strong>.</p>
            <p style="margin:0;font-size:13px">
              <a href="https://wa.me/5930978893520" style="color:#16a34a;font-weight:600;text-decoration:none">WhatsApp</a>
              &nbsp;·&nbsp;
              <a href="mailto:info@corpsimtelec.com" style="color:#7C3AED;font-weight:600;text-decoration:none">info@corpsimtelec.com</a>
            </p>
            <p style="color:#cbd5e1;font-size:12px;margin:14px 0 0">AELA ERP © ${new Date().getFullYear()} CorpSimtelec · Ecuador</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

    // Generar PDF con PDFKit y adjuntar al email
    let pdfTmpPath = null;
    const attachments = [];
    try {
      pdfTmpPath = nodePath.join(os.tmpdir(), `prf-${id}-${Date.now()}.pdf`);
      await _generarPdfProforma(p, configSri, pdfTmpPath);
      attachments.push({ filename: `${(p.numero || 'proforma').replace(/\//g, '-')}.pdf`, path: pdfTmpPath });
    } catch (pdfErr) {
      console.warn('[proformas] email: PDF no generado, se envía sin adjunto:', pdfErr.message);
    }

    try {
      await enviarConFallback({
        from:    process.env.SMTP_FROM || `${emisorLabel} <info@corpsimtelec.com>`,
        to:      destino,
        subject: `Proforma ${p.numero} — ${emisorLabel}`,
        html,
        attachments,
      });
    } finally {
      if (pdfTmpPath && fs.existsSync(pdfTmpPath)) fs.unlinkSync(pdfTmpPath);
    }

    res.json({ ok: true, mensaje: `Proforma enviada a ${destino}${attachments.length ? ' con PDF adjunto' : ''}` });
  } catch (err) {
    console.error('[proformas] POST /:id/enviar-email', err.message);
    const esEmailFail = /sin método|resend|smtp/i.test(err.message);
    res.status(esEmailFail ? 503 : 500).json({ ok: false, mensaje: esEmailFail ? 'No hay configuración de email activa en el servidor.' : 'Error al enviar email' });
  }
});

// ─── POST /:id/anular ─────────────────────────────────────────────────────────
router.post('/:id/anular', async (req, res) => {
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;
    const rol       = normalizarRol(req.usuario.rol);

    if (!['admin', 'supervisor'].includes(rol)) {
      return res.status(403).json({ ok: false, mensaje: 'Solo admin o supervisor puede anular proformas' });
    }

    const [actual] = await req.prisma.$queryRawUnsafe(
      `SELECT estado FROM proformas WHERE id = $1 AND "empresaId" = $2`, id, empresaId
    );
    if (!actual) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });
    if (actual.estado === 'ANULADA') return res.status(400).json({ ok: false, mensaje: 'Ya está anulada' });

    const [row] = await req.prisma.$queryRawUnsafe(
      `UPDATE proformas SET estado = 'ANULADA', "updatedAt" = NOW()
       WHERE id = $1 AND "empresaId" = $2 RETURNING *`,
      id, empresaId
    );

    res.json({ ok: true, data: row });
  } catch (err) {
    res.status(500).json({ ok: false, mensaje: 'Error al anular proforma' });
  }
});

// ─── GET /:id/pdf — descargar proforma como PDF ───────────────────────────────
router.get('/:id/pdf', async (req, res) => {
  let tmpPath = null;
  try {
    const id        = parseInt(req.params.id);
    const empresaId = req.empresa.id;

    const [p] = await req.prisma.$queryRawUnsafe(
      `SELECT p.* FROM proformas p WHERE p.id = $1 AND p."empresaId" = $2`,
      id, empresaId
    );
    if (!p) return res.status(404).json({ ok: false, mensaje: 'Proforma no encontrada' });

    const configSri = await req.prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } }) || {};

    const nombre = `${(p.numero || 'proforma').replace(/\//g, '-')}.pdf`;
    tmpPath = nodePath.join(os.tmpdir(), `prf-dl-${id}-${Date.now()}.pdf`);

    await _generarPdfProforma(p, configSri, tmpPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    fs.createReadStream(tmpPath).pipe(res).on('finish', () => {
      fs.unlink(tmpPath, () => {});
    });
  } catch (err) {
    if (tmpPath) fs.unlink(tmpPath, () => {});
    console.error('[proformas] GET /:id/pdf', err.message);
    res.status(500).json({ ok: false, mensaje: 'Error al generar PDF: ' + err.message });
  }
});

module.exports = router;
