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

/**
 * Devuelve el instante (Date) de las 00:00:00 hora Ecuador del día calendario
 * indicado ("YYYY-MM-DD", default hoy en EC). Seguro para usar como límite
 * `gte`/`lt` en consultas Prisma sin importar en qué zona horaria corre el
 * proceso (Railway corre en UTC) — Ecuador no tiene horario de verano, así
 * que el offset -05:00 es constante todo el año.
 */
const inicioDiaEC = (fechaCal = fechaHoyEC()) =>
  new Date(`${fechaCal}T00:00:00.000-05:00`);

/**
 * 00:00:00 hora Ecuador del día SIGUIENTE a fechaCal — límite `lt`
 * (exclusivo) para cubrir "todo el día", más seguro que sumar
 * 23:59:59.999 a mano (evita descuadres de milisegundo).
 */
const finDiaEC = (fechaCal = fechaHoyEC()) =>
  new Date(inicioDiaEC(fechaCal).getTime() + 24 * 60 * 60 * 1000);

/**
 * 00:00:00 hora Ecuador del primer día del mes que contiene fechaCal.
 */
const inicioMesEC = (fechaCal = fechaHoyEC()) =>
  inicioDiaEC(`${fechaCal.slice(0, 7)}-01`);

/**
 * 00:00:00 hora Ecuador del primer día del mes SIGUIENTE a fechaCal —
 * límite `lt` (exclusivo) para cubrir "todo el mes".
 */
const finMesEC = (fechaCal = fechaHoyEC()) => {
  const [anio, mes] = fechaCal.slice(0, 7).split('-').map(Number);
  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig  = mes === 12 ? 1 : mes + 1;
  return inicioDiaEC(`${anioSig}-${String(mesSig).padStart(2, '0')}-01`);
};

/**
 * 00:00:00 hora Ecuador del 1 de enero del año que contiene fechaCal.
 */
const inicioAnioEC = (fechaCal = fechaHoyEC()) =>
  inicioDiaEC(`${fechaCal.slice(0, 4)}-01-01`);

/**
 * 00:00:00 hora Ecuador del 1 de enero del año SIGUIENTE — límite `lt`
 * (exclusivo) para cubrir "todo el año".
 */
const finAnioEC = (fechaCal = fechaHoyEC()) =>
  inicioDiaEC(`${Number(fechaCal.slice(0, 4)) + 1}-01-01`);

// ─── Rangos para campos "solo-fecha" (fechaEmision, fechaOperacion, etc.) ────
// A diferencia de inicioDiaEC/finDiaEC de arriba (pensados para columnas de
// TIMESTAMP REAL como createdAt/cerradaEn, donde 00:00 hora Ecuador cae en
// las 05:00 UTC), estos campos se guardan como medianoche UTC exacta
// representando el día calendario (ver comentario al inicio de este archivo)
// — NO tienen componente de hora real. Filtrar esos campos con los límites
// EC de arriba los desalinearía 5 horas contra filas ya guardadas con la
// convención medianoche-UTC. Usar SIEMPRE estos para fechaEmision/
// fechaOperacion/etc., y los de arriba (inicioDiaEC/finDiaEC/...) solo para
// columnas de timestamp real.

/**
 * Rango [gte, lt) para "todo el día calendario EC" de `valor` (Date,
 * timestamp o ya un string "YYYY-MM-DD"), en la convención medianoche-UTC
 * que usan los campos solo-fecha.
 */
const rangoDiaSoloFecha = (valor = new Date()) => {
  const cal = diaCalendarioEC(valor);
  const gte = new Date(`${cal}T00:00:00.000Z`);
  return { gte, lt: new Date(gte.getTime() + 24 * 60 * 60 * 1000) };
};

/**
 * Rango [gte, lt) para "todo el mes calendario EC" que contiene `valor`.
 */
const rangoMesSoloFecha = (valor = new Date()) => {
  const cal = diaCalendarioEC(valor);
  const [anio, mes] = cal.slice(0, 7).split('-').map(Number);
  const anioSig = mes === 12 ? anio + 1 : anio;
  const mesSig  = mes === 12 ? 1 : mes + 1;
  return {
    gte: new Date(`${cal.slice(0, 7)}-01T00:00:00.000Z`),
    lt:  new Date(`${anioSig}-${String(mesSig).padStart(2, '0')}-01T00:00:00.000Z`),
  };
};

/**
 * Rango [gte, lt) para "todo el año calendario EC" que contiene `valor`.
 */
const rangoAnioSoloFecha = (valor = new Date()) => {
  const cal = diaCalendarioEC(valor);
  return {
    gte: new Date(`${cal.slice(0, 4)}-01-01T00:00:00.000Z`),
    lt:  new Date(`${Number(cal.slice(0, 4)) + 1}-01-01T00:00:00.000Z`),
  };
};

/**
 * { anio, mes } (mes 1-12) del día calendario Ecuador actual — para
 * defaults de reportes/numeración mensual (F104, ATS, asientos, etc.)
 * que hoy usan new Date().getFullYear()/getMonth()+1 cuando no viene
 * mes/año explícito por query. Evita que, cerca de medianoche hora
 * Ecuador, el servidor (Railway, UTC) calcule el mes/año siguiente.
 */
const mesAnioActualEC = () => {
  const [anio, mes] = diaCalendarioEC().split('-').map(Number);
  return { anio, mes };
};

module.exports = {
  TZ_EC, formatFechaHora, fechaHoyEC, fechaECOffset, diaCalendarioEC,
  inicioDiaEC, finDiaEC, inicioMesEC, finMesEC, inicioAnioEC, finAnioEC,
  rangoDiaSoloFecha, rangoMesSoloFecha, rangoAnioSoloFecha, mesAnioActualEC,
};
