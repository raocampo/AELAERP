/**
 * Utilidades de fecha/hora para Ecuador (UTC-5, sin horario de verano).
 *
 * IMPORTANTE: Las fechas "solo-fecha" (fechaEmision, etc.) se almacenan como
 * medianoche UTC en la BD y se muestran con toLocaleDateString SIN zona horaria
 * para evitar desfase de un día. Este módulo cubre los casos de fecha+hora.
 */

const TZ_EC = 'America/Guayaquil';

/**
 * Formatea un Date (o "ahora" si se omite) como fecha+hora en zona Ecuador.
 * Usar en PDFs, logs de generación, timestamps de autorización SRI.
 * Reemplaza: new Date(d).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })
 */
const formatFechaHora = (d = new Date()) =>
  new Date(d).toLocaleString('es-EC', { timeZone: TZ_EC });

/**
 * Retorna la fecha de hoy en Ecuador como "YYYY-MM-DD" (ISO 8601).
 * Útil cuando se necesita la fecha local Ecuador para nombre de archivos, etc.
 */
const fechaHoyEC = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: TZ_EC }); // en-CA = YYYY-MM-DD

module.exports = { TZ_EC, formatFechaHora, fechaHoyEC };
