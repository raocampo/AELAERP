// ============================================================
//  AELA — Utilidad de certificado P12
//  backend/utils/certUtils.js
//
//  En Railway (y otros PaaS), el filesystem es efímero:
//  el archivo .p12 subido desaparece en cada deploy.
//  Solución: guardar el certificado como base64 en la BD
//  (campo certificadoP12Data) y usarlo como fallback.
// ============================================================

const fs = require('fs');

/**
 * Retorna un Buffer con el contenido del certificado P12.
 * 1. Si el archivo en disco existe → lo lee.
 * 2. Si no existe pero hay base64 en BD → lo construye en memoria.
 * 3. Si ninguno → retorna null (sin certificado disponible).
 *
 * @param {object} config  Fila de configuracion_sri
 * @returns {Buffer|null}
 */
function getCertBuffer(config) {
  if (config.certificadoP12 && fs.existsSync(config.certificadoP12)) {
    return fs.readFileSync(config.certificadoP12);
  }
  if (config.certificadoP12Data) {
    return Buffer.from(config.certificadoP12Data, 'base64');
  }
  return null;
}

/**
 * Indica si la configuración tiene un certificado disponible
 * (ya sea en disco o en BD).
 *
 * @param {object} config  Fila de configuracion_sri
 * @returns {boolean}
 */
function tieneCertificado(config) {
  if (config.certificadoP12 && fs.existsSync(config.certificadoP12)) return true;
  if (config.certificadoP12Data) return true;
  return false;
}

module.exports = { getCertBuffer, tieneCertificado };
