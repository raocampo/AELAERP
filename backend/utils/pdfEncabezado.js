/**
 * Encabezado estándar para TODOS los reportes internos de Contabilidad y
 * Bancos (asiento contable, Libro Diario/Mayor, Estados Financieros,
 * comprobantes bancarios, Libro de Bancos) — antes cada archivo dibujaba su
 * propio encabezado con tamaños de letra, alineación y color de línea
 * distintos (uno con logo+texto centrado y línea morada, otro con logo a la
 * izquierda y línea gris, etc.), lo que hacía que los reportes se vieran
 * como de sistemas distintos. Se extrae acá el diseño ya usado por
 * Contabilidad (el que más reportes ya tenían) para que todos compartan el
 * mismo encabezado.
 */
const fs = require('fs');
const path = require('path');

// Resuelve el logo de configuracion_sri — soporta data URI base64 (formato
// actual) y ruta de archivo legado.
function _resolverLogo(logoUrl, baseDir) {
  if (!logoUrl) return null;
  if (logoUrl.startsWith('data:')) {
    try {
      const b64 = logoUrl.replace(/^data:image\/\w+;base64,/, '');
      return Buffer.from(b64, 'base64');
    } catch { return null; }
  }
  const logoPath = path.join(baseDir, logoUrl.replace(/^\//, ''));
  return fs.existsSync(logoPath) ? logoPath : null;
}

/**
 * @param {PDFDocument} doc
 * @param {object} config  configuracion_sri de la empresa (razonSocial, ruc,
 *   dirMatriz, telefono, logoUrl)
 * @param {string} titulo  título del reporte (ej. "Libro de Bancos",
 *   "Comprobante Contable 3711")
 * @param {object} [opciones]
 * @param {string} [opciones.baseDir]  raíz para resolver logoUrl de archivo
 *   legado (default: raíz de backend/)
 */
function dibujarEncabezadoReporte(doc, config, titulo, opciones = {}) {
  const ML = doc.page.margins.left;
  const W = doc.page.width - ML - doc.page.margins.right;
  const baseDir = opciones.baseDir || path.join(__dirname, '..');
  const logoData = _resolverLogo(config?.logoUrl, baseDir);
  const y = doc.y;

  if (logoData) {
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

module.exports = { dibujarEncabezadoReporte };
