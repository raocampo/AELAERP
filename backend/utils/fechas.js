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

/**
 * Retorna hoy ± N días en Ecuador como "YYYY-MM-DD". Ecuador no tiene
 * horario de verano, así que sumar/restar milisegundos y reformatear con
 * timeZone es seguro (nunca hay un salto de hora que descuadre el día).
 */
const fechaECOffset = (diasOffset = 0) =>
  new Date(Date.now() + diasOffset * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: TZ_EC });

/**
 * Reduce cualquier valor de fecha a su día calendario en Ecuador ("YYYY-MM-DD"),
 * para comparar fechas por día sin importar la hora exacta ni la zona horaria
 * del proceso que las generó (Railway corre en UTC).
 *
 * Si `valor` ya es un string "YYYY-MM-DD" (el caso normal: viene de un
 * <input type="date">, ej. fechaEmision del POS/facturación), se devuelve
 * TAL CUAL — es la fecha calendario que el usuario eligió, sin ambigüedad.
 * Convertirlo primero a Date y de ahí a zona horaria movería el día (una
 * fecha "solo-fecha" se ancla a medianoche UTC; reinterpretada en
 * America/Guayaquil cae en el día ANTERIOR). Solo para timestamps reales
 * (con hora) tiene sentido pasar por el Date + timeZone.
 */
const diaCalendarioEC = (valor) => {
  const s = String(valor ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date(valor).toLocaleDateString('en-CA', { timeZone: TZ_EC });
};

module.exports = { TZ_EC, formatFechaHora, fechaHoyEC, fechaECOffset, diaCalendarioEC };
