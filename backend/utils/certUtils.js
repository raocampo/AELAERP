// ============================================================
//  AELA — Utilidad de certificado P12
//  backend/utils/certUtils.js
//
//  En Railway (y otros PaaS), el filesystem es efímero:
//  el archivo .p12 subido desaparece en cada deploy.
//  Solución: guardar el certificado como base64 en la BD
//  (campo certificadoP12Data) y usarlo como fallback.
// ============================================================

const fs    = require('fs');
const forge = require('node-forge');

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

/**
 * Parsea el certificado P12 y devuelve metadata de validez sin lanzar excepciones.
 * Umbrales: > 30 días → VIGENTE, 0-30 días → POR_VENCER, < 0 → VENCIDO.
 *
 * @param {object} config  Fila de configuracion_sri (incluye claveCertificado)
 * @returns {{ estado: string, cn?: string, emisorCN?: string, validoDesde?: Date, validoHasta?: Date, diasRestantes?: number }}
 */
function getCertInfo(config) {
  try {
    const p12Buffer = getCertBuffer(config);
    if (!p12Buffer) return { estado: 'SIN_CERTIFICADO' };

    const claveP12 = config.claveCertificado || '';
    const p12Asn1  = forge.asn1.fromDer(p12Buffer.toString('binary'));
    const p12Obj   = forge.pkcs12.pkcs12FromAsn1(p12Asn1, claveP12);

    const certs = [];
    for (const sc of p12Obj.safeContents) {
      for (const sb of sc.safeBags) {
        if (sb.type === forge.pki.oids.certBag && sb.cert) {
          certs.push(sb.cert);
        }
      }
    }
    if (!certs.length) return { estado: 'SIN_CERTIFICADO' };

    // Preferir certificado de entidad final (no CA)
    const cert = certs.find(c => !c.getExtension('basicConstraints')?.cA) || certs[0];

    const ahora         = new Date();
    const validoHasta   = cert.validity.notAfter;
    const validoDesde   = cert.validity.notBefore;
    const diasRestantes = Math.floor((validoHasta - ahora) / (1000 * 60 * 60 * 24));

    const estado = diasRestantes < 0   ? 'VENCIDO'
                 : diasRestantes <= 30 ? 'POR_VENCER'
                 : 'VIGENTE';

    return {
      estado,
      cn:             cert.subject.getField('CN')?.value  || null,
      emisorCN:       cert.issuer.getField('CN')?.value   || null,
      validoDesde,
      validoHasta,
      diasRestantes,
    };
  } catch {
    return { estado: 'ERROR_PARSEO' };
  }
}

module.exports = { getCertBuffer, tieneCertificado, getCertInfo };
