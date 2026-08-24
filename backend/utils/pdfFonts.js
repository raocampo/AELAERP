// ====================================
// FUENTES PDF — Noto Sans registrada sobre los nombres estándar de PDFKit
//
// PDFKit solo trae las 14 fuentes base (Helvetica vía AFM/WinAnsiEncoding),
// que en la versión instalada (0.17.2) no renderiza bien los acentos y
// eñes del español ("Situación" sale "Situaci�n"). registerFont(name, ...)
// se busca ANTES que las fuentes estándar (ver pdfkit.js: doc.font()
// consulta this._registeredFonts[src] primero), así que registrar Noto
// Sans bajo los mismos nombres "Helvetica"/"Helvetica-Bold"/
// "Helvetica-Oblique" intercepta cualquier `.font('Helvetica...')` ya
// existente en el código sin tener que tocar cada llamada.
// ====================================

const path = require('path');

const DIR = path.join(__dirname, '..', 'assets', 'fonts');
const REGULAR = path.join(DIR, 'NotoSans-Regular.ttf');
const BOLD = path.join(DIR, 'NotoSans-Bold.ttf');
const ITALIC = path.join(DIR, 'NotoSans-Italic.ttf');

function registrarFuentesPdf(doc) {
  doc.registerFont('Helvetica', REGULAR);
  doc.registerFont('Helvetica-Bold', BOLD);
  doc.registerFont('Helvetica-Oblique', ITALIC);
  return doc;
}

module.exports = { registrarFuentesPdf };
