// ====================================
// DIRECTORIO GLOBAL — helper de upsert
// backend/utils/directorioGlobal.js
//
// Centraliza la escritura en la tabla maestra directorio_global.
// NUNCA lanza excepción hacia el llamador — los errores se loguean y se ignoran
// para que un fallo en el directorio nunca bloquee la operación principal.
// ====================================

const prisma = require('../config/prisma');

/**
 * Enriquece el directorio global con los datos de un contribuyente.
 * - Si la identificación no existe → crea el registro.
 * - Si ya existe → actualiza razonSocial (siempre) y los demás campos
 *   solo cuando el nuevo valor es no-vacío (evita sobreescribir con nulos).
 *
 * @param {object} datos
 * @param {string} datos.identificacion       RUC (13), cédula (10), pasaporte, etc.
 * @param {string} datos.tipoIdentificacion   04 | 05 | 06 | 07 | 08
 * @param {string} datos.razonSocial          Nombre legal o apellidos+nombres
 * @param {string} [datos.nombreComercial]
 * @param {string} [datos.direccion]
 * @param {string} [datos.email]
 * @param {string} [datos.telefono]
 * @param {string} [datos.fuente]             sri_csv | sri_api | importacion | manual
 */
async function upsertDirectorio({
  identificacion,
  tipoIdentificacion,
  razonSocial,
  nombreComercial,
  direccion,
  email,
  telefono,
  fuente = 'manual',
}) {
  if (!identificacion || !razonSocial) return;

  try {
    await prisma.directorio_global.upsert({
      where: { identificacion },
      create: {
        identificacion,
        tipoIdentificacion,
        razonSocial,
        nombreComercial: nombreComercial || null,
        direccion:       direccion       || null,
        email:           email           || null,
        telefono:        telefono        || null,
        fuente,
      },
      update: {
        razonSocial,
        fuente,
        // Solo enriquece — no sobreescribe con vacíos
        ...(nombreComercial ? { nombreComercial } : {}),
        ...(direccion       ? { direccion }       : {}),
        ...(email           ? { email }           : {}),
        ...(telefono        ? { telefono }        : {}),
      },
    });
  } catch (err) {
    console.error('[directorio_global] upsert error:', err.message);
  }
}

module.exports = { upsertDirectorio };
