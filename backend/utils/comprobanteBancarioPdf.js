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
    // Media hoja A4 (mismo ancho, mitad de alto) — un comprobante no
    // necesita una hoja completa; si el contenido no alcanza, se agrega
    // otra media página (asegurarEspacio ya usa doc.page.height).
    const doc = new PDFDocument({ size: [595.28, 420.94], margins: { top: 32, bottom: 32, left: 48, right: 48 }, autoFirstPage: true });
    registrarFuentesPdf(doc);
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const empresa = cfg || {};
    const ML = 48;
    const W = doc.page.width - ML * 2;
    const logo = resolverLogo(empresa.logoUrl);
    const anchoTexto = W - (logo ? 130 : 0);
    let y = 32;

    if (logo) {
      try { doc.image(logo, ML, y, { fit: [120, 55] }); } catch { /* logo inválido */ }
    }
    doc.fontSize(9).font('Helvetica-Bold').fillColor(NEGRO)
      .text((empresa.razonSocial || '').toUpperCase(), ML + (logo ? 130 : 0), y, { width: anchoTexto });
    doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`RUC: ${empresa.ruc || ''}`, { width: anchoTexto });
    if (empresa.dirMatriz) doc.text(empresa.dirMatriz, { width: anchoTexto });
    if (empresa.telefono) doc.text(`Telf.: ${empresa.telefono}`, { width: anchoTexto });
    // El piso de "y+55" solo aplica si hay logo (reserva su alto) — sin
    // logo, no hay que reservar ese espacio de más (media hoja A4: cada
    // punto cuenta).
    y = Math.max(doc.y, logo ? y + 55 : 0) + 10;

    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke(LINEA);
    y += 14;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(NEGRO).text(estilo.titulo, ML, y, { width: W, align: 'center' });
    y += 18;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(estilo.color).text(`No. ${datos.numero || '—'}`, ML, y, { width: W, align: 'center' });
    y += 16;
    if (datos.anulado) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#EF4444').text('*** ANULADO ***', ML, y, { width: W, align: 'center' });
      y += 16;
    }
    y += 4;

    // El margen de reserva bajo el contenido es proporcional al alto de
    // página, no un valor fijo — en la media hoja A4 (420.94pt) un buffer
    // fijo de 60pt (pensado para A4 completo) se comía ~14% de la página y
    // forzaba una segunda media página con contenido de sobra.
    const RESERVA_INFERIOR = Math.round(doc.page.height * 0.095);
    const asegurarEspacio = (alto) => {
      if (y + alto > doc.page.height - RESERVA_INFERIOR) { doc.addPage(); y = 32; }
    };

    for (const [label, valor, negrita] of [['Fecha:', fmtFecha(datos.fecha)], ...(datos.filas || [])]) {
      if (valor === null || valor === undefined || valor === '') continue;
      asegurarEspacio(20);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text(label, ML, y, { width: 140 });
      doc.fontSize(9).font(negrita ? 'Helvetica-Bold' : 'Helvetica').fillColor(NEGRO).text(String(valor), ML + 140, y, { width: W - 140 });
      y = Math.max(y + 14, doc.y + 3);
    }

    for (const tabla of datos.tablas || []) {
      if (!tabla.filas?.length) continue;
      y += 8;
      // Solo reserva espacio para el título — el encabezado y cada fila ya
      // piden su propio espacio real más abajo (dibujarFila); un margen más
      // grande acá cortaba a una media página nueva antes de tiempo.
      asegurarEspacio(18);
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

    // Caja de monto: antes ocupaba 40pt de alto con letra de 15pt — mucho
    // más protagonismo del que necesita un dato que ya se repite en el
    // detalle/formas de pago, y le quitaba espacio real a las firmas
    // (queja del cliente: "ocupa mucho espacio... para que donde se firme
    // tenga el espacio"). Se mantiene el recuadro de color (referencia
    // visual rápida) pero más angosto y con letra en negrita más discreta.
    y += 6;
    const ALTO_BOX_MONTO = 26;
    asegurarEspacio(ALTO_BOX_MONTO);
    doc.roundedRect(ML, y, W, ALTO_BOX_MONTO, 5).fillAndStroke(estilo.fondo, estilo.borde);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(GRIS).text(estilo.etiquetaMonto, ML + 12, y + 8);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(estilo.color).text(fmtMoney(datos.monto), ML, y + 6, { width: W - 12, align: 'right' });
    y += ALTO_BOX_MONTO + 6;

    if (datos.observaciones) {
      asegurarEspacio(30);
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(`Observaciones: ${datos.observaciones}`, ML, y, { width: W });
      y = doc.y + 10;
    }

    // Firmas: ancladas cerca del pie de la página (no siguen el flujo
    // normal como el resto — si el contenido ya llegó tan abajo que ni la
    // línea+etiqueta de la firma entran antes del margen real, recién ahí
    // se agrega una página nueva; si no, se paran en su posición ideal
    // aunque quede espacio libre debajo (por diseño, no es un error).
    //
    // El alto real de "línea + etiqueta" se mide con heightOfString en vez
    // de una constante adivinada — un valor adivinado (18) por debajo del
    // real dejaba pasar el chequeo y luego PDFKit auto-paginaba DENTRO del
    // propio .text() de la firma (su motor de texto no permite que una
    // línea quede recortada por el margen inferior), generando una página
    // extra en blanco por cada firma restante del arreglo (bug real: un
    // comprobante de egreso con 3 firmas terminó en 4 páginas). El chequeo
    // también debe incluir `holguraPreFirma` — antes se comparaba el `y`
    // SIN ese colchón contra el límite, pero el colchón sí se suma al `y`
    // final donde en verdad se dibuja.
    const firmas = estilo.firmas;
    const anchoFirma = W / firmas.length;
    const altoTextoFirma = Math.max(
      ...firmas.map((texto) => doc.fontSize(8).font('Helvetica').heightOfString(texto, { width: anchoFirma })),
    );
    const GAP_LINEA_TEXTO = 5;
    const NECESARIO_FIRMA = GAP_LINEA_TEXTO + altoTextoFirma + 1;
    const holguraPreFirma = 6;
    if (y + holguraPreFirma + NECESARIO_FIRMA > doc.page.height - 32) { doc.addPage(); y = 32; }
    y = Math.max(y + holguraPreFirma, doc.page.height - Math.round(doc.page.height * 0.145));
    firmas.forEach((texto, i) => {
      const x = ML + anchoFirma * i;
      doc.moveTo(x + 12, y).lineTo(x + anchoFirma - 12, y).lineWidth(0.75).stroke('#94a3b8');
      doc.fontSize(8).font('Helvetica').fillColor(GRIS).text(texto, x, y + GAP_LINEA_TEXTO, { width: anchoFirma, align: 'center' });
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
