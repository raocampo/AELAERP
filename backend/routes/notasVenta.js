// ====================================
// RUTAS: NOTAS DE VENTA — AELA
// Para RIMPE Negocio Popular (no XML electrónico)
// backend/routes/notasVenta.js
// ====================================

const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const os          = require('os');
const router      = express.Router();
const PDFDocument = require('pdfkit');
const bwipjs      = require('bwip-js');
const prisma  = require('../config/prisma');
const { proteger, autorizarPermiso } = require('../middleware/auth');
const { checkLimiteNotasVenta } = require('../middleware/edition');
const { registrarAuditoria }   = require('../utils/auditoria');
const { registrarMovimientoCaja } = require('../utils/caja');
const { aplicarMovimientosVentaDesdeDetalles } = require('../utils/inventario');
const { enviarDocumentoFiscal } = require('../utils/email');

router.use(proteger);
router.use(autorizarPermiso('notasVenta.gestionar'));

const DIR_NOTAS = path.join(__dirname, '..', 'uploads', 'notas_venta');
if (!fs.existsSync(DIR_NOTAS)) fs.mkdirSync(DIR_NOTAS, { recursive: true });

// ─── Helper configuración SRI ────────────────────────────────────────────────
async function getConfigSRI(empresaId) {
  return await prisma.configuracion_sri.findFirst({ where: { empresaId, activo: true } });
}

// ─── Helper: RIDE A4 de Nota de Venta (formato SRI RIMPE) ────────────────────
async function generarRIDENotaVenta(nota, configSri, outputPath) {
  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 20, left: 28, right: 28 }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const ML    = 28;
    const PW    = doc.page.width;
    const PH    = doc.page.height;
    const W     = PW - ML * 2;

    const AZUL   = '#1B3A6B';
    const GRIS   = '#555555';
    const NEGRO  = '#000000';
    const BLANCO = '#FFFFFF';
    const BG_ALT = '#F5F8FC';

    const config   = configSri || {};
    const detalles = typeof nota.detalles === 'string' ? JSON.parse(nota.detalles) : (nota.detalles || []);

    const logoPath  = config.logoUrl
      ? path.join(__dirname, '..', config.logoUrl.replace(/^\//, ''))
      : null;
    const tienelogo = logoPath && fs.existsSync(logoPath);

    const fmtM = (v) => `$${Number(v || 0).toFixed(2)}`;
    const fmtF = (v) => v ? new Date(v).toLocaleDateString('es-EC') : '';

    // ── HEADER ────────────────────────────────────────────────────────────────
    let y = 20;
    const LP   = Math.floor(W * 0.44);
    const GAP  = 8;
    const RP_X = ML + LP + GAP;
    const RP_W = W - LP - GAP;

    // Panel izquierdo
    let yL = y;

    if (tienelogo) {
      try { doc.image(logoPath, ML, yL, { fit: [LP - 4, 65] }); yL += 70; } catch (_) {}
    }

    // Nombre comercial o razón social como título principal
    const nombrePrincipal = (config.nombreComercial || config.razonSocial || nota.razonSocialEmisor || '').toUpperCase();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor(NEGRO)
       .text(nombrePrincipal, ML, yL, { width: LP - 4 });
    yL = doc.y + 2;

    if (config.nombreComercial && config.razonSocial) {
      doc.fontSize(7).font('Helvetica').fillColor(GRIS)
         .text(config.razonSocial, ML, yL, { width: LP - 4 });
      yL = doc.y + 2;
    }

    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Dir. Matriz: ${config.dirMatriz || ''}`, ML, yL, { width: LP - 4 });
    yL = doc.y + 2;

    if (config.dirEstablecimiento) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Dir. Sucursal: ${config.dirEstablecimiento}`, ML, yL, { width: LP - 4 });
      yL = doc.y + 2;
    }

    if (config.contribuyenteEspecial) {
      doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
         .text(`Contrib. Especial Nro: ${config.contribuyenteEspecial}`, ML, yL, { width: LP - 4, lineBreak: false });
      yL += 10;
    }

    doc.fontSize(6.5).font('Helvetica').fillColor(GRIS)
       .text(`Obligado a llevar contabilidad: ${config.obligadoContabilidad ? 'SI' : 'NO'}`, ML, yL, { width: LP - 4, lineBreak: false });
    yL += 10;

    // Etiqueta RIMPE obligatoria (Anexo 22 SRI v2.26)
    const rimpeLabel = config.negocioPopular
      ? 'CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE'
      : 'CONTRIBUYENTE RÉGIMEN RIMPE';
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(AZUL)
       .text(rimpeLabel, ML, yL, { width: LP - 4, lineBreak: false });
    yL += 10;

    // Panel derecho — recuadro con borde
    let yR = y;
    doc.rect(RP_X, yR, RP_W, 118).lineWidth(0.7).stroke('#888888');

    // RUC
    yR += 4;
    doc.fontSize(7).font('Helvetica-Bold').fillColor(GRIS)
       .text('R.U.C.:', RP_X + 4, yR, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(`  ${config.ruc || nota.rucEmisor || ''}`, RP_X + 36, yR, { lineBreak: false });
    yR += 13;

    // Tipo de documento
    doc.fontSize(14).font('Helvetica-Bold').fillColor(NEGRO)
       .text('NOTA DE VENTA', RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 20;

    // Número
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
       .text(`No. ${nota.numeroNota || ''}`, RP_X, yR, { width: RP_W, align: 'center', lineBreak: false });
    yR += 14;

    doc.moveTo(RP_X, yR).lineTo(RP_X + RP_W, yR).lineWidth(0.4).stroke('#CCCCCC');
    yR += 5;

    // Fecha de emisión
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRIS)
       .text('FECHA DE EMISIÓN:', RP_X + 4, yR, { lineBreak: false });
    doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
       .text(`  ${fmtF(nota.fechaEmision)}`, RP_X + 90, yR, { lineBreak: false });
    yR += 10;

    // Caja aviso RIMPE (no tiene clave de acceso)
    const avisoY = yR;
    const avisoH = 30;
    doc.rect(RP_X + 4, avisoY, RP_W - 8, avisoH).fill('#FFF8E1').stroke('#FFA000');
    doc.fontSize(6).font('Helvetica-Bold').fillColor('#B45309')
       .text(
         'ESTE DOCUMENTO NO ES VÁLIDO PARA\nCRÉDITO TRIBUTARIO DE IVA',
         RP_X + 6, avisoY + 5,
         { width: RP_W - 12, align: 'center' }
       );
    yR = avisoY + avisoH + 4;

    y = Math.max(yL, yR) + 8;

    // ── DATOS DEL COMPRADOR ───────────────────────────────────────────────────
    const COMP_H = 42;
    doc.rect(ML, y, W, COMP_H).lineWidth(0.5).stroke('#AAAAAA');
    doc.moveTo(ML, y + 20).lineTo(ML + W, y + 20).lineWidth(0.3).stroke('#CCCCCC');

    const COL_ID_W = W * 0.55;
    doc.moveTo(ML + COL_ID_W, y + 20).lineTo(ML + COL_ID_W, y + COMP_H).lineWidth(0.3).stroke('#CCCCCC');

    // Fila 1: Razón Social
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('RAZÓN SOCIAL / NOMBRES Y APELLIDOS:', ML + 3, y + 3, { lineBreak: false });
    doc.fontSize(8).font('Helvetica').fillColor(NEGRO)
       .text(nota.razonSocial || 'CONSUMIDOR FINAL', ML + 3, y + 12, { width: W - 6, lineBreak: false });

    // Fila 2: Identificación | Fecha
    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('IDENTIFICACIÓN:', ML + 3, y + 24, { lineBreak: false });
    doc.fontSize(7.5).font('Helvetica').fillColor(NEGRO)
       .text(nota.identificacion || '9999999999999', ML + 3, y + 33, { width: COL_ID_W - 6, lineBreak: false });

    doc.fontSize(6).font('Helvetica-Bold').fillColor(GRIS)
       .text('DIRECCIÓN:', ML + COL_ID_W + 3, y + 24, { lineBreak: false });
    doc.fontSize(7).font('Helvetica').fillColor(NEGRO)
       .text(nota.direccion || '', ML + COL_ID_W + 3, y + 33, { width: W * 0.45 - 6, lineBreak: false });

    y += COMP_H + 4;

    // ── TABLA DE DETALLES ────────────────────────────────────────────────────
    const COLS = [
      { h: 'Cód.',          w: 52,  al: 'left'  },
      { h: 'Cantidad',      w: 42,  al: 'right' },
      { h: 'Descripción',   w: 0,   al: 'left'  },
      { h: 'P. Unitario',   w: 58,  al: 'right' },
      { h: 'Descuento',     w: 48,  al: 'right' },
      { h: 'Total',         w: 60,  al: 'right' },
    ];
    const fixedW = COLS.filter(c => c.w > 0).reduce((s, c) => s + c.w, 0);
    COLS.find(c => c.w === 0).w = W - fixedW;

    const TH_H = 22;
    doc.rect(ML, y, W, TH_H).fill(AZUL);
    let cx = ML;
    COLS.forEach(col => {
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text(col.h, cx + 2, y + 6, { width: col.w - 4, align: col.al, lineBreak: false });
      cx += col.w;
    });
    y += TH_H;

    detalles.forEach((det, idx) => {
      const cant  = parseFloat(det.cantidad)      || 0;
      const prec  = parseFloat(det.precioUnitario) || 0;
      const desc  = parseFloat(det.descuento)     || 0;
      const tot   = cant * prec - desc;
      const ROW_H = 13;

      if (y > PH - 120) { doc.addPage(); y = 30; }

      doc.rect(ML, y, W, ROW_H).fill(idx % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(ML, y, W, ROW_H).lineWidth(0.2).stroke('#DDDDDD');

      cx = ML;
      const vals = [
        { v: det.codigoPrincipal || '',    al: 'left'  },
        { v: cant.toFixed(2),              al: 'right' },
        { v: det.descripcion || '',        al: 'left'  },
        { v: fmtM(prec),                   al: 'right' },
        { v: desc > 0 ? fmtM(desc) : '—', al: 'right' },
        { v: fmtM(tot),                    al: 'right' },
      ];
      vals.forEach((v, vi) => {
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(v.v, cx + 2, y + 3, { width: COLS[vi].w - 4, align: v.al, lineBreak: false });
        cx += COLS[vi].w;
      });
      y += ROW_H;
    });

    y += 6;

    // ── FOOTER: INFO ADICIONAL + TOTALES ─────────────────────────────────────
    const FP_W  = Math.floor(W * 0.52);
    const TOT_X = ML + FP_W + 4;
    const TOT_W = W - FP_W - 4;
    let   yL2   = y;

    // Información adicional
    const camposIA = [];
    if (nota.telefono)      camposIA.push({ n: 'Teléfono',   v: nota.telefono });
    if (nota.email)         camposIA.push({ n: 'Email',      v: nota.email });
    if (nota.observaciones) camposIA.push({ n: 'Observación', v: nota.observaciones });

    if (camposIA.length > 0) {
      doc.fontSize(7).font('Helvetica-Bold').fillColor(AZUL)
         .text('INFORMACIÓN ADICIONAL', ML, yL2, { lineBreak: false });
      yL2 += 11;
      const IA_H    = 12;
      const LABEL_W = FP_W * 0.30;
      const VAL_W   = FP_W - LABEL_W;
      doc.rect(ML, yL2, FP_W, IA_H).fill(AZUL);
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Campo', ML + 3, yL2 + 3, { width: LABEL_W - 6, lineBreak: false });
      doc.fontSize(6).font('Helvetica-Bold').fillColor(BLANCO)
         .text('Valor', ML + LABEL_W + 3, yL2 + 3, { width: VAL_W - 6, lineBreak: false });
      yL2 += IA_H;
      camposIA.forEach((c, i) => {
        doc.rect(ML, yL2, FP_W, IA_H).fill(i % 2 === 0 ? BLANCO : BG_ALT);
        doc.rect(ML, yL2, FP_W, IA_H).lineWidth(0.2).stroke('#DDDDDD');
        doc.fontSize(6.5).font('Helvetica-Bold').fillColor(GRIS)
           .text(c.n, ML + 3, yL2 + 2, { width: LABEL_W - 6, lineBreak: false });
        doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
           .text(c.v, ML + LABEL_W + 3, yL2 + 2, { width: VAL_W - 6, lineBreak: false });
        yL2 += IA_H;
      });
      yL2 += 4;
    }

    // Forma de pago
    doc.fontSize(7).font('Helvetica-Bold').fillColor(AZUL)
       .text('Forma de pago', ML, yL2, { lineBreak: false });
    yL2 += 11;
    const PG_H  = 13;
    const PG_WS = [FP_W * 0.65, FP_W * 0.35];
    doc.rect(ML, yL2, FP_W, PG_H).fill(AZUL);
    let px = ML;
    ['Forma de pago', 'Valor'].forEach((lbl, i) => {
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(BLANCO)
         .text(lbl, px + 3, yL2 + 3, { width: PG_WS[i] - 6, align: i === 0 ? 'left' : 'right', lineBreak: false });
      px += PG_WS[i];
    });
    yL2 += PG_H;
    doc.rect(ML, yL2, FP_W, PG_H).fill(BLANCO);
    doc.rect(ML, yL2, FP_W, PG_H).lineWidth(0.2).stroke('#DDDDDD');
    px = ML;
    [nota.formaPago || 'Efectivo', fmtM(nota.total)].forEach((pv, i) => {
      doc.fontSize(6.5).font('Helvetica').fillColor(NEGRO)
         .text(pv, px + 3, yL2 + 3, { width: PG_WS[i] - 6, align: i === 0 ? 'left' : 'right', lineBreak: false });
      px += PG_WS[i];
    });
    yL2 += PG_H;

    // Caja de totales
    const subtotal  = parseFloat(nota.subtotal       || 0);
    const totDesc   = parseFloat(nota.totalDescuento || 0);
    const total     = parseFloat(nota.total          || 0);

    const TOT_ROWS = [
      { l: 'SUBTOTAL SIN IMPUESTOS', v: subtotal, bold: false },
      { l: 'DESCUENTO',              v: totDesc,  bold: false },
      { l: 'VALOR TOTAL',            v: total,    bold: true  },
    ];
    const TR_H      = 14;
    const TOT_BOX_H = TOT_ROWS.length * TR_H + 4;
    doc.rect(TOT_X, y, TOT_W, TOT_BOX_H).lineWidth(0.5).stroke('#AAAAAA');

    let yT = y + 2;
    TOT_ROWS.forEach((row, ri) => {
      if (ri > 0) doc.moveTo(TOT_X, yT).lineTo(TOT_X + TOT_W, yT).lineWidth(0.2).stroke('#DDDDDD');
      const fn = row.bold ? 'Helvetica-Bold' : 'Helvetica';
      const fc = row.bold ? AZUL : NEGRO;
      const bg = row.bold ? '#EEF3FB' : (ri % 2 === 0 ? BLANCO : BG_ALT);
      doc.rect(TOT_X, yT, TOT_W, TR_H).fill(bg);
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(row.l, TOT_X + 3, yT + 4, { width: TOT_W * 0.65 - 3, align: 'left', lineBreak: false });
      doc.fontSize(6.5).font(fn).fillColor(fc)
         .text(fmtM(row.v), TOT_X + TOT_W * 0.65, yT + 4, { width: TOT_W * 0.35 - 3, align: 'right', lineBreak: false });
      yT += TR_H;
    });

    // ── Pie de página ────────────────────────────────────────────────────────
    const bottomY = Math.max(yL2, yT) + 12;
    doc.fontSize(6).font('Helvetica-Bold').fillColor(AZUL)
       .text(rimpeLabel, ML, bottomY, { width: W, align: 'center', lineBreak: false });
    doc.fontSize(5.5).font('Helvetica').fillColor(GRIS)
       .text(
         'Este documento no es comprobante electrónico ni válido para crédito tributario de IVA — Régimen RIMPE',
         ML, bottomY + 9, { width: W, align: 'center' }
       );

    // Marca de agua ANULADA
    if (nota.anulada) {
      doc.save();
      doc.fontSize(60).font('Helvetica-Bold').fillColor('#FF0000').opacity(0.18)
         .text('ANULADA', 80, PH / 2 - 80, { width: W, align: 'center', rotate: -35 });
      doc.restore();
    }

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error',  reject);
  });
}

// ─── Helper: Recibo POS 80mm de Nota de Venta ────────────────────────────────
async function generarReciboNotaVenta(nota, configSri, outputPath) {
  return new Promise((resolve, reject) => {
    const POS_W = 204;
    const ML    = 6;
    const W     = POS_W - ML * 2;

    const doc    = new PDFDocument({ size: [POS_W, 900], margins: { top: 8, bottom: 8, left: ML, right: ML }, autoFirstPage: true });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const config   = configSri || {};
    const detalles = typeof nota.detalles === 'string' ? JSON.parse(nota.detalles) : (nota.detalles || []);

    let y = 8;

    const linea = () => {
      y += 3;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.5).stroke('#AAAAAA');
      y += 5;
    };

    // Encabezado empresa
    const nombrePOS = (config.nombreComercial || config.razonSocial || nota.razonSocialEmisor || '').toUpperCase();
    doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#000000')
       .text(nombrePOS, ML, y, { width: W, align: 'center' });
    y += 12;

    if (config.nombreComercial && config.razonSocial) {
      doc.fontSize(7).font('Helvetica').fillColor('#333333')
         .text(config.razonSocial, ML, y, { width: W, align: 'center' });
      y += 10;
    }

    doc.fontSize(7).font('Helvetica').fillColor('#333333')
       .text(`RUC: ${config.ruc || nota.rucEmisor || ''}`, ML, y, { width: W, align: 'center' });
    y += 10;

    if (config.dirMatriz) {
      doc.fontSize(6.5).font('Helvetica').fillColor('#555555')
         .text(config.dirMatriz, ML, y, { width: W, align: 'center' });
      y += 10;
    }

    linea();

    // Tipo y número
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
       .text('NOTA DE VENTA', ML, y, { width: W, align: 'center' });
    y += 12;
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
       .text(`No. ${nota.numeroNota || ''}`, ML, y, { width: W, align: 'center' });
    y += 10;
    const fEm = nota.fechaEmision ? new Date(nota.fechaEmision).toLocaleDateString('es-EC') : '';
    doc.fontSize(6.5).font('Helvetica').fillColor('#555555')
       .text(`Fecha: ${fEm}`, ML, y, { width: W, align: 'center' });
    y += 10;

    linea();

    // Cliente
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000').text('CLIENTE:', ML, y);
    y += 10;
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
       .text(nota.razonSocial || 'CONSUMIDOR FINAL', ML, y, { width: W });
    y += 9;
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
       .text(`CI/RUC: ${nota.identificacion || '9999999999999'}`, ML, y, { width: W });
    y += 10;

    linea();

    // Tabla de ítems
    const C0 = W * 0.48;
    const C1 = W * 0.14;
    const C2 = W * 0.18;
    const C3 = W * 0.20;

    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000')
       .text('Descripción', ML, y, { width: C0, lineBreak: false });
    doc.text('Cant', ML + C0, y, { width: C1, align: 'right', lineBreak: false });
    doc.text('P.U.',  ML + C0 + C1, y, { width: C2, align: 'right', lineBreak: false });
    doc.text('Total', ML + C0 + C1 + C2, y, { width: C3, align: 'right', lineBreak: false });
    y += 9;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.3).stroke('#AAAAAA');
    y += 4;

    detalles.forEach(det => {
      const cant  = parseFloat(det.cantidad)       || 0;
      const prec  = parseFloat(det.precioUnitario) || 0;
      const desc  = parseFloat(det.descuento)      || 0;
      const tot   = (cant * prec - desc).toFixed(2);
      const descH = doc.heightOfString(det.descripcion || '', { width: C0 });
      const rowH  = Math.max(descH, 9) + 2;

      doc.fontSize(6.5).font('Helvetica').fillColor('#000000')
         .text(det.descripcion || '', ML, y, { width: C0 });
      doc.text(cant.toFixed(2), ML + C0,           y, { width: C1, align: 'right', lineBreak: false });
      doc.text(prec.toFixed(2), ML + C0 + C1,      y, { width: C2, align: 'right', lineBreak: false });
      doc.text(tot,             ML + C0 + C1 + C2, y, { width: C3, align: 'right', lineBreak: false });
      y += rowH;
    });

    linea();

    // Totales
    const subtotal = parseFloat(nota.subtotal       || 0);
    const totDesc  = parseFloat(nota.totalDescuento || 0);
    const total    = parseFloat(nota.total          || 0);

    const fila = (label, val, bold = false) => {
      const fn = bold ? 'Helvetica-Bold' : 'Helvetica';
      const sz = bold ? 8 : 6.5;
      doc.fontSize(sz).font(fn).fillColor('#000000')
         .text(label, ML, y, { width: W * 0.65, lineBreak: false });
      doc.text(`$${val.toFixed(2)}`, ML + W * 0.65, y, { width: W * 0.35, align: 'right', lineBreak: false });
      y += bold ? 12 : 9;
    };

    if (subtotal > 0) fila('Subtotal:', subtotal);
    if (totDesc  > 0) fila('Descuento:', totDesc);
    fila('TOTAL:', total, true);

    linea();

    // Forma de pago
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor('#000000')
       .text('FORMA DE PAGO:', ML, y);
    y += 10;
    doc.fontSize(6.5).font('Helvetica').fillColor('#333333')
       .text(`${nota.formaPago || 'Efectivo'}:`, ML, y, { width: W * 0.65, lineBreak: false });
    doc.text(`$${total.toFixed(2)}`, ML + W * 0.65, y, { width: W * 0.35, align: 'right', lineBreak: false });
    y += 9;

    linea();

    // Pie RIMPE
    doc.fontSize(6).font('Helvetica-Bold').fillColor('#000000')
       .text('CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE', ML, y, { width: W, align: 'center' });
    y += 9;
    doc.fontSize(5.5).font('Helvetica').fillColor('#888888')
       .text('Documento no válido para crédito tributario de IVA', ML, y, { width: W, align: 'center' });
    y += 9;

    linea();

    doc.fontSize(7).font('Helvetica-Bold').fillColor('#000000')
       .text('¡Gracias por su preferencia!', ML, y, { width: W, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error',  reject);
  });
}

// ─── GET /api/notas-venta ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { fechaDesde, fechaHasta, busqueda, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = { empresaId: req.empresa.id };

    if (fechaDesde || fechaHasta) {
      where.fechaEmision = {};
      if (fechaDesde) where.fechaEmision.gte = new Date(fechaDesde);
      if (fechaHasta) where.fechaEmision.lte = new Date(fechaHasta + 'T23:59:59');
    }
    if (busqueda) {
      where.OR = [
        { numeroNota: { contains: busqueda, mode: 'insensitive' } },
        { razonSocial: { contains: busqueda, mode: 'insensitive' } },
        { identificacion: { contains: busqueda, mode: 'insensitive' } },
      ];
    }

    const [notas, total] = await Promise.all([
      prisma.notas_venta.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, numeroNota: true, fechaEmision: true,
          razonSocial: true, identificacion: true,
          total: true, anulada: true, pdfUrl: true, createdAt: true,
        },
      }),
      prisma.notas_venta.count({ where }),
    ]);

    // Estadísticas del año para mostrar en UI
    const inicioAño = new Date(new Date().getFullYear(), 0, 1);
    const usadasAño = await prisma.notas_venta.count({
      where: { empresaId: req.empresa.id, anulada: false, fechaEmision: { gte: inicioAño } },
    });

    res.json({
      success: true, data: notas, total,
      limiteAnual: req.empresa.factAnualesMax,
      usadasAño,
    });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/notas-venta/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const nota = await prisma.notas_venta.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nota) return res.status(404).json({ success: false, mensaje: 'Nota de venta no encontrada' });
    res.json({ success: true, data: nota });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── POST /api/notas-venta ────────────────────────────────────────────────────
router.post('/', checkLimiteNotasVenta, async (req, res) => {
  try {
    const config = await getConfigSRI(req.empresa.id);
    if (!config) {
      return res.status(400).json({ success: false, mensaje: 'Configure primero los datos del SRI (RUC, razón social, etc.)' });
    }

    const {
      tipoIdentificacion, identificacion, razonSocial, direccion, email, telefono,
      detalles, formaPago, fechaEmision, observaciones, clienteId,
    } = req.body;

    if (!tipoIdentificacion || !identificacion || !razonSocial) {
      return res.status(400).json({ success: false, mensaje: 'Faltan datos del destinatario' });
    }
    if (!detalles || detalles.length === 0) {
      return res.status(400).json({ success: false, mensaje: 'Debe incluir al menos un detalle' });
    }

    // Calcular totales
    let subtotal = 0, totalDescuento = 0;
    detalles.forEach(d => {
      const cant  = parseFloat(d.cantidad)       || 1;
      const precio = parseFloat(d.precioUnitario) || 0;
      const desc   = parseFloat(d.descuento)      || 0;
      subtotal       += cant * precio;
      totalDescuento += desc;
    });
    const total = parseFloat((subtotal - totalDescuento).toFixed(2));
    subtotal = parseFloat(subtotal.toFixed(2));
    totalDescuento = parseFloat(totalDescuento.toFixed(2));

    // Siguiente secuencial para esta empresa (respeta secuencial inicial configurado)
    const ultimo = await prisma.notas_venta.findFirst({
      where: { empresaId: req.empresa.id },
      orderBy: { secuencial: 'desc' },
    });
    const maxEnBD_nv = ultimo?.secuencial || 0;
    const { siguienteSecuencial: nextSec_nv } = require('../utils/secuenciales');
    const secuencial = await nextSec_nv(
      prisma, req.empresa.id, config.establecimiento, config.puntoEmision,
      maxEnBD_nv, 'secInicialNotaVenta'
    );
    const numeroNota = `${config.establecimiento}-${config.puntoEmision}-${String(secuencial).padStart(9, '0')}`;

    const fechaDoc = fechaEmision ? new Date(fechaEmision) : new Date();
    const nota = await prisma.$transaction(async (tx) => {
      const creada = await tx.notas_venta.create({
        data: {
          empresaId: req.empresa.id,
          numeroNota,
          secuencial,
          rucEmisor: config.ruc,
          razonSocialEmisor: config.razonSocial,
          tipoIdentificacion,
          identificacion: identificacion.trim(),
          razonSocial: razonSocial.trim().toUpperCase(),
          direccion: direccion?.trim() || null,
          email: email?.trim().toLowerCase() || null,
          telefono: telefono?.trim() || null,
          clienteId: clienteId ? parseInt(clienteId, 10) : null,
          subtotal,
          totalDescuento,
          total,
          detalles,
          formaPago: formaPago || 'Efectivo',
          fechaEmision: fechaDoc,
          observaciones: observaciones || null,
          emisorId: req.usuario.id,
        },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles,
        tipoDocumento: 'NOTA_VENTA',
        referencia: numeroNota,
        metadata: { notaVentaId: creada.id },
      });

      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha: fechaDoc,
        tipo: 'VENTA_NOTA',
        monto: total,
        descripcion: `Venta por nota ${numeroNota}`,
        referencia: numeroNota,
        categoria: formaPago || 'Efectivo',
        origenId: creada.id,
        metadata: { notaVentaId: creada.id },
      });

      return creada;
    });

    await registrarAuditoria({
      usuarioId: req.usuario.id, accion: 'CREATE',
      tabla: 'notas_venta', registroId: nota.id,
      datosNuevos: { numeroNota, total },
      req,
    });

    res.status(201).json({ success: true, data: nota, mensaje: 'Nota de venta creada correctamente' });

    // Enviar PDF al cliente en background si tiene email
    if (nota.email) {
      const outPath = path.join(os.tmpdir(), `nv-email-${nota.id}-${Date.now()}.pdf`);
      generarRIDENotaVenta(nota, config, outPath)
        .then(() => enviarDocumentoFiscal({
          tipo:                  'NOTA_VENTA',
          numero:                nota.numeroNota,
          email:                 nota.email,
          pdfPath:               outPath,
          razonSocialEmisor:     config.razonSocial || nota.razonSocialEmisor,
          nombreComercialEmisor: config.nombreComercial,
          logoUrl:               config.logoUrl,
          razonSocialComprador:  nota.razonSocial,
          fecha:                 nota.fechaEmision,
          total:                 nota.total,
        }))
        .then(() => { try { fs.unlinkSync(outPath); } catch (_) {} })
        .catch(err => console.error('[email] NV:', err.message));
    }
  } catch (err) {
    console.error('Error crear nota de venta:', err);
    if (/Stock insuficiente|Producto no encontrado/.test(err.message || '')) {
      return res.status(400).json({ success: false, mensaje: err.message });
    }
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

// ─── GET /api/notas-venta/:id/pdf  (RIDE A4 estilo SRI) ─────────────────────
router.get('/:id/pdf', async (req, res) => {
  try {
    const nota = await prisma.notas_venta.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nota) return res.status(404).json({ success: false, mensaje: 'Nota de venta no encontrada' });

    const config = await getConfigSRI(req.empresa.id) || {};
    const outPath = path.join(os.tmpdir(), `nv-${nota.id}-${Date.now()}.pdf`);
    await generarRIDENotaVenta(nota, config, outPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="NV-${nota.numeroNota}.pdf"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(outPath); } catch (_) {} });
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  } catch (err) {
    console.error('Error generar PDF nota de venta:', err);
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'Error al generar el PDF' });
  }
});

// ─── GET /api/notas-venta/:id/recibo  (recibo POS 80mm) ─────────────────────
router.get('/:id/recibo', async (req, res) => {
  try {
    const nota = await prisma.notas_venta.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nota) return res.status(404).json({ success: false, mensaje: 'Nota de venta no encontrada' });

    const config = await getConfigSRI(req.empresa.id) || {};
    const outPath = path.join(os.tmpdir(), `nv-recibo-${nota.id}-${Date.now()}.pdf`);
    await generarReciboNotaVenta(nota, config, outPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Recibo-NV-${nota.numeroNota}.pdf"`);
    const stream = fs.createReadStream(outPath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(outPath); } catch (_) {} });
    stream.on('error', () => { if (!res.headersSent) res.status(500).end(); });
  } catch (err) {
    console.error('Error generar recibo nota de venta:', err);
    if (!res.headersSent) res.status(500).json({ success: false, mensaje: 'Error al generar el recibo' });
  }
});

// ─── PUT /api/notas-venta/:id/anular ─────────────────────────────────────────
router.put('/:id/anular', async (req, res) => {
  try {
    const { motivo } = req.body;
    const nota = await prisma.notas_venta.findFirst({
      where: { id: parseInt(req.params.id), empresaId: req.empresa.id },
    });
    if (!nota) return res.status(404).json({ success: false, mensaje: 'No encontrada' });
    if (nota.anulada) return res.status(400).json({ success: false, mensaje: 'Ya está anulada' });

    const actualizada = await prisma.$transaction(async (tx) => {
      const anulada = await tx.notas_venta.update({
        where: { id: nota.id },
        data: { anulada: true, motivoAnulacion: motivo || 'Anulada por el usuario' },
      });

      await aplicarMovimientosVentaDesdeDetalles({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        detalles: nota.detalles || [],
        tipoDocumento: 'NOTA_VENTA',
        referencia: nota.numeroNota,
        metadata: { notaVentaId: nota.id, anulado: true },
        revertir: true,
      });

      await registrarMovimientoCaja({
        tx,
        empresaId: req.empresa.id,
        usuarioId: req.usuario.id,
        fecha: new Date(),
        tipo: 'ANULACION_NOTA',
        monto: Number(nota.total || 0),
        descripcion: `Anulación de nota ${nota.numeroNota}`,
        referencia: nota.numeroNota,
        origenId: nota.id,
        metadata: { notaVentaId: nota.id },
      });

      return anulada;
    });

    res.json({ success: true, data: actualizada });
  } catch (err) {
    res.status(500).json({ success: false, mensaje: err.message });
  }
});

module.exports = router;
