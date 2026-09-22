/**
 * PDF del Libro de Bancos — listado de movimientos de una cuenta bancaria en
 * un período, con saldo anterior/ingresos/egresos/saldo final y el estado de
 * conciliación de cada línea (misma información que ya se ve en pantalla en
 * LibroBancos.jsx — sirve tanto para "imprimir el libro" como para la
 * conciliación, ya que es la misma tabla con la columna "Conc." incluida).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const PDFDocument = require('pdfkit');
const { registrarFuentesPdf } = require('./pdfFonts');
const { dibujarEncabezadoReporte } = require('./pdfEncabezado');

const NEGRO = '#1e293b';
const GRIS = '#64748b';
const LINEA = '#e2e8f0';
const VERDE = '#16a34a';
const ROJO = '#dc2626';

const fmtFecha = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
};
const fmtMoney = (v) => `$${Number(v || 0).toFixed(2)}`;

/**
 * @param {object} datos
 *   cuenta      { nombre, banco, tipoCuenta, numeroCuenta }
 *   periodo     { desde, hasta } (strings YYYY-MM-DD o null = "todo")
 *   saldoAnterior, totalDebe, totalHaber, saldoFinal
 *   movimientos [{ fecha, numero, tipo, concepto, referencia, debe, haber, saldoAcumulado, conciliado }]
 * @param {object} cfg  configuracion_sri de la empresa
 */
function generarLibroBancosPdf(datos, cfg, outputPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 36, bottom: 36, left: 40, right: 40 }, autoFirstPage: true });
    registrarFuentesPdf(doc);
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    const empresa = cfg || {};
    const ML = 40;
    const W = doc.page.width - ML * 2;

    // Mismo encabezado (logo, tipografía, línea morada de marca) que el
    // resto de reportes de Contabilidad/Bancos.
    dibujarEncabezadoReporte(doc, empresa, 'LIBRO DE BANCOS');
    let y = doc.y + 4;
    const c = datos.cuenta || {};
    doc.fontSize(9).font('Helvetica').fillColor(GRIS)
      .text(`${c.nombre || ''} — ${c.banco || ''} · ${c.tipoCuenta || ''} ${c.numeroCuenta || ''}`, ML, y, { width: W, align: 'center' });
    y += 12;
    const periodoTxt = datos.periodo?.desde || datos.periodo?.hasta
      ? `Período: ${datos.periodo.desde ? fmtFecha(datos.periodo.desde) : 'inicio'} al ${datos.periodo.hasta ? fmtFecha(datos.periodo.hasta) : 'hoy'}`
      : 'Período: todo el historial';
    doc.text(periodoTxt, ML, y, { width: W, align: 'center' });
    y += 20;

    // Resumen de saldos
    const resumen = [
      ['Saldo anterior', datos.saldoAnterior],
      ['Total ingresos', datos.totalDebe],
      ['Total egresos', datos.totalHaber],
      ['Saldo al cierre', datos.saldoFinal],
    ];
    const anchoResumen = W / resumen.length;
    resumen.forEach(([label, valor], i) => {
      const x = ML + anchoResumen * i;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(GRIS).text(label.toUpperCase(), x, y, { width: anchoResumen, align: 'center' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor(Number(valor) < 0 ? ROJO : NEGRO).text(fmtMoney(valor), x, y + 12, { width: anchoResumen, align: 'center' });
    });
    y += 34;
    doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(1).stroke(LINEA);
    y += 10;

    const asegurarEspacio = (alto) => {
      if (y + alto > doc.page.height - 40) {
        doc.addPage();
        y = 36;
      }
    };

    // Tabla de movimientos
    const columnas = [
      { titulo: 'Fecha', ancho: 55 },
      { titulo: 'N°', ancho: 75 },
      { titulo: 'Tipo', ancho: 75 },
      { titulo: 'Concepto' },
      { titulo: 'Referencia', ancho: 70 },
      { titulo: 'Debe', ancho: 65, alinear: 'right' },
      { titulo: 'Haber', ancho: 65, alinear: 'right' },
      { titulo: 'Saldo', ancho: 65, alinear: 'right' },
      { titulo: 'Conc.', ancho: 35, alinear: 'center' },
    ];
    const fijo = columnas.reduce((s, c2) => s + (c2.ancho || 0), 0);
    const flexibles = columnas.filter((c2) => !c2.ancho).length || 1;
    const anchos = columnas.map((c2) => c2.ancho || (W - fijo) / flexibles);

    const dibujarFila = (celdas, { encabezado = false, colorSaldo = null } = {}) => {
      const alto = Math.max(...celdas.map((t, i) => doc.fontSize(7.5).font(encabezado ? 'Helvetica-Bold' : 'Helvetica')
        .heightOfString(String(t ?? ''), { width: anchos[i] - 4 }))) + 6;
      asegurarEspacio(alto);
      if (encabezado) doc.rect(ML, y, W, alto).fill('#f1f5f9');
      let x = ML;
      celdas.forEach((t, i) => {
        const color = !encabezado && colorSaldo && i === 7 ? colorSaldo : NEGRO;
        doc.fontSize(7.5).font(encabezado ? 'Helvetica-Bold' : 'Helvetica').fillColor(color)
          .text(String(t ?? ''), x + 2, y + 3, { width: anchos[i] - 4, align: columnas[i].alinear || 'left' });
        x += anchos[i];
      });
      y += alto;
      doc.moveTo(ML, y).lineTo(ML + W, y).lineWidth(0.5).stroke(LINEA);
    };

    dibujarFila(columnas.map((c2) => c2.titulo), { encabezado: true });
    for (const m of datos.movimientos || []) {
      dibujarFila([
        fmtFecha(m.fecha),
        m.numero || '—',
        String(m.tipo || '').replace(/_/g, ' '),
        m.concepto || '',
        m.referencia || '—',
        Number(m.debe) > 0 ? fmtMoney(m.debe) : '',
        Number(m.haber) > 0 ? fmtMoney(m.haber) : '',
        fmtMoney(m.saldoAcumulado),
        m.conciliado ? 'SI' : '—',
      ], { colorSaldo: Number(m.saldoAcumulado) < 0 ? ROJO : (m.conciliado ? VERDE : null) });
    }

    // Totales
    asegurarEspacio(20);
    y += 4;
    doc.fontSize(8).font('Helvetica-Bold').fillColor(NEGRO)
      .text('TOTALES DEL PERÍODO', ML, y, { width: anchos.slice(0, 5).reduce((s, a) => s + a, 0), align: 'right' });
    let xTot = ML + anchos.slice(0, 5).reduce((s, a) => s + a, 0);
    doc.text(fmtMoney(datos.totalDebe), xTot, y, { width: anchos[5], align: 'right' }); xTot += anchos[5];
    doc.text(fmtMoney(datos.totalHaber), xTot, y, { width: anchos[6], align: 'right' }); xTot += anchos[6];
    doc.text(fmtMoney(datos.saldoFinal), xTot, y, { width: anchos[7], align: 'right' });

    doc.end();
    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}

async function enviarLibroBancosPdf(res, datos, cfg, nombreArchivo) {
  const outPath = path.join(os.tmpdir(), `libro-bancos-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`);
  try {
    await generarLibroBancosPdf(datos, cfg, outPath);
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

module.exports = { generarLibroBancosPdf, enviarLibroBancosPdf };
