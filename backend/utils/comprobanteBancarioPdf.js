/**
 * PDF de comprobantes de Bancos (ingreso / egreso / nota de crédito / débito /
 * ajuste). Mismo diseño que el Recibo de Cobro de CxC (routes/cxc.js
 * _generarReciboCobroPdf): encabezado con logo y datos de la empresa, título,
 * número, filas etiqueta/valor, caja de monto y línea de firmas. Lo usan tanto
 * los movimientos del Libro de Bancos como los "comprobantes_bancarios".
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const { registrarFuentesPdf } = require('./pdfFonts');

const NEGRO = '#1e293b';
const GRIS = '#64748b';
const LINEA = '#e2e8f0';

// Color y textos según la categoría del comprobante.
const ESTILOS = {
  INGRESO: { titulo: 'COMPROBANTE DE INGRESO', color: '#22C55E', fondo: '#f0fdf4', borde: '#bbf7d0', etiquetaMonto: 'MONTO RECIBIDO', firmas: ['Elaborado por', 'Recibí conforme'] },
  EGRESO: { titulo: 'COMPROBANTE DE EGRESO', color: '#EF4444', fondo: '#fef2f2', borde: '#fecaca', etiquetaMonto: 'MONTO PAGADO', firmas: ['Elaborado por', 'Aprobado por', 'Recibí conforme'] },
  CREDITO: { titulo: 'NOTA DE CRÉDITO BANCARIA', color: '#22C55E', fondo: '#f0fdf4', borde: '#bbf7d0', etiquetaMonto: 'VALOR ACREDITADO', firmas: ['Elaborado por', 'Aprobado por'] },
  DEBITO: { titulo: 'NOTA DE DÉBITO BANCARIA', color: '#EF4444', fondo: '#fef2f2', borde: '#fecaca', etiquetaMonto: 'VALOR DEBITADO', firmas: ['Elaborado por', 'Aprobado por'] },
  AJUSTE: { titulo: 'AJUSTE BANCARIO', color: '#3B82F6', fondo: '#eff6ff', borde: '#bfdbfe', etiquetaMonto: 'VALOR DEL AJUSTE', firmas: ['Elaborado por', 'Aprobado por'] },
};

// Categoría de comprobante a partir del tipo de movimiento bancario.
const CATEGORIA_POR_TIPO_MOVIMIENTO = {
  DEPOSITO: 'INGRESO', TRANSFERENCIA_IN: 'INGRESO',
  RETIRO: 'EGRESO', TRANSFERENCIA_OUT: 'EGRESO', CHEQUE: 'EGRESO',
  NOTA_CREDITO: 'CREDITO', NOTA_DEBITO: 'DEBITO', AJUSTE: 'AJUSTE',
};
// ...y a partir del tipo de la tabla comprobantes_bancarios (INGRESO/PAGO/CREDITO/DEBITO).
const CATEGORIA_POR_TIPO_COMPROBANTE = { INGRESO: 'INGRESO', PAGO: 'EGRESO', CREDITO: 'CREDITO', DEBITO: 'DEBITO' };

function resolverLogo(logoUrl) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('data:')) {
    try { return Buffer.from(logoUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64'); } catch { return null; }
  }
  const logoPath = path.join(__dirname, '..', logoUrl.replace(/^\//, ''));
  return fs.existsSync(logoPath) ? logoPath : null;
}

// Las fechas "solo-fecha" se guardan como medianoche UTC exacta y se muestran
// en UTC para no correr el día; un timestamp real (movimientos generados por
// el sistema con hora) se muestra en hora Ecuador (ver utils/fechas.js).
const fmtFecha = (d) => {
  if (!d) return '—';
  const fecha = new Date(d);
  const soloFecha = fecha.getUTCHours() === 0 && fecha.getUTCMinutes() === 0 && fecha.getUTCSeconds() === 0;
  return fecha.toLocaleDateString('es-EC', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: soloFecha ? 'UTC' : 'America/Guayaquil',
  });
};
const fmtMoney = (v) => `$${Number(v || 0).toFixed(2)}`;

/**
 * @param {object} datos
 *   categoria  INGRESO|EGRESO|CREDITO|DEBITO|AJUSTE
 *   numero, fecha, anulado(bool), monto, observaciones
 *   filas      [[etiqueta, valor, negrita?], ...] — se omiten las de valor vacío
 *   tablas     [{ titulo, columnas:[{ titulo, ancho, alinear }], filas:[[..]] }]
 * @param {object} cfg  configuracion_sri de la empresa (razonSocial, ruc, dirMatriz, telefono, logoUrl)
 */
function generarComprobanteBancarioPdf(datos, cfg, outputPath) {
  return new Promise((resolve, reject) => {
    const estilo = ESTILOS[datos.categoria] || ESTILOS.AJUSTE;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 48, right: 48 }, autoFirstPage: true });
    registrarFuentesPdf(doc);
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const empresa = cfg || {};
    const ML = 48;
    const W = doc.page.width - ML * 2;
    const logo = resolverLogo(empresa.logoUrl);
    const anchoTexto = W - (logo ? 130 : 0);
    let y = 40;

    if (logo) {
      try { doc.image(logo, ML, y, { fit: [120, 55] }); } catch { /* logo inválido */ }
    }
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
      .text((empresa.razonSocial || '').toUpperCase(), ML + (logo ? 130 : 0), y, { width: anchoTexto });
    doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`RUC: ${empresa.ruc || ''}`, { width: anchoTexto });
    if (empresa.dirMatriz) doc.text(empresa.dirMatriz, { width: anchoTexto });
    if (empresa.telefono) doc.text(`Telf.: ${empresa.telefono}`, { width: anchoTexto });
    y = Math.max(doc.y, y + 55) + 16;

    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke(LINEA);
    y += 20;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(NEGRO).text(estilo.titulo, ML, y, { width: W, align: 'center' });
    y += 22;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(estilo.color).text(`No. ${datos.numero || '—'}`, ML, y, { width: W, align: 'center' });
    y += 20;
    if (datos.anulado) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#EF4444').text('*** ANULADO ***', ML, y, { width: W, align: 'center' });
      y += 18;
    }
    y += 6;

    const asegurarEspacio = (alto) => {
      if (y + alto > doc.page.height - 60) { doc.addPage(); y = 40; }
    };

    for (const [label, valor, negrita] of [['Fecha:', fmtFecha(datos.fecha)], ...(datos.filas || [])]) {
      if (valor === null || valor === undefined || valor === '') continue;
      asegurarEspacio(20);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text(label, ML, y, { width: 140 });
      doc.fontSize(9).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor(NEGRO).text(String(valor), ML + 140, y, { width: W - 140 });
      y = Math.max(y + 16, doc.y + 4);
    }

    for (const tabla of datos.tablas || []) {
      if (!tabla.filas?.length) continue;
      y += 8;
      asegurarEspacio(50);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO).text(tabla.titulo, ML, y, { width: W });
      y = doc.y + 4;
      const fijo = tabla.columnas.reduce((s, c) => s + (c.ancho || 0), 0);
      const flexibles = tabla.columnas.filter((c) => !c.ancho).length || 1;
      const anchos = tabla.columnas.map((c) => c.ancho || (W - fijo) / flexibles);
      const dibujarFila = (celdas, encabezado) => {
        const alto = Math.max(...celdas.map((t, i) => doc.fontSize(8).font(encabezado ? 'Helvetica-Bold' : 'Helvetica')
          .heightOfString(String(t ?? ''), { width: anchos[i] - 6 }))) + 6;
        asegurarEspacio(alto);
        if (encabezado) doc.rect(ML, y, W, alto).fill('#f1f5f9');
        let x = ML;
        celdas.forEach((t, i) => {
          doc.fontSize(8).font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fillColor(NEGRO)
            .text(String(t ?? ''), x + 3, y + 3, { width: anchos[i] - 6, align: tabla.columnas[i].alinear || 'left' });
          x += anchos[i];
        });
        y += alto;
        doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.5).stroke(LINEA);
      };
      dibujarFila(tabla.columnas.map((c) => c.titulo), true);
      tabla.filas.forEach((f) => dibujarFila(f, false));
    }

    y += 16;
    asegurarEspacio(70);
    doc.roundedRect(ML, y, W, 44, 6).fillAndStroke(estilo.fondo, estilo.borde);
    doc.fontSize(10).font('Helvetica-Bold').fillColor(GRIS).text(estilo.etiquetaMonto, ML + 16, y + 10);
    doc.fontSize(16).font('Helvetica-Bold').fillColor(estilo.color).text(fmtMoney(datos.monto), ML, y + 8, { width: W - 16, align: 'right' });
    y += 60;

    if (datos.observaciones) {
      asegurarEspacio(40);
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`Observaciones: ${datos.observaciones}`, ML, y, { width: W });
      y = doc.y + 16;
    }

    // Firmas: al pie de la página en que quedó el contenido.
    asegurarEspacio(60);
    y = Math.max(y + 20, doc.page.height - 130);
    const firmas = estilo.firmas;
    const anchoFirma = W / firmas.length;
    firmas.forEach((texto, i) => {
      const x = ML + anchoFirma * i;
      doc.moveTo(x + 12, y).lineTo(x + anchoFirma - 12, y).lineWidth(0.75).stroke('#94a3b8');
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(texto, x, y + 6, { width: anchoFirma, align: 'center' });
    });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

// Genera el PDF en un temporal y lo envía inline (mismo patrón del recibo de CxC).
async function enviarComprobanteBancarioPdf(res, datos, cfg, nombreArchivo) {
  const outPath = path.join(os.tmpdir(), `banco-comprobante-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`);
  try {
    await generarComprobanteBancarioPdf(datos, cfg, outPath);
  } catch (error) {
    try { fs.unlinkSync(outPath); } catch { /* noop */ }
    throw error;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombreArchivo}.pdf"`);
  const lectura = fs.createReadStream(outPath);
  lectura.pipe(res);
  lectura.on('end', () => { try { fs.unlinkSync(outPath); } catch { /* noop */ } });
  lectura.on('error', () => {
    try { fs.unlinkSync(outPath); } catch { /* noop */ }
    if (!res.headersSent) res.status(500).end(); else res.end();
  });
}

module.exports = {
  generarComprobanteBancarioPdf,
  enviarComprobanteBancarioPdf,
  CATEGORIA_POR_TIPO_MOVIMIENTO,
  CATEGORIA_POR_TIPO_COMPROBANTE,
  fmtMoney,
};
