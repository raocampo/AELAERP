// ====================================
// UTILIDAD DE AUDITORÍA
// Registra acciones en la tabla auditoria
// ====================================

const prisma = require('../config/prisma');

/**
 * Registrar una acción de auditoría.
 * No lanza error — nunca debe interrumpir la operación principal.
 *
 * @param {object}  params
 * @param {number}  [params.usuarioId]       - ID del usuario que realizó la acción
 * @param {number}  [params.empresaId]       - ID de la empresa (se toma de req.empresa.id si no se pasa)
 * @param {string}  params.accion            - Tipo de acción: CREATE, UPDATE, DELETE, LOGIN, LOGOUT, etc.
 * @param {string}  [params.tabla]           - Tabla afectada
 * @param {number}  [params.registroId]      - ID del registro afectado
 * @param {object}  [params.datosAnteriores] - Snapshot antes del cambio (UPDATE/DELETE)
 * @param {object}  [params.datosNuevos]     - Snapshot después del cambio (CREATE/UPDATE)
 * @param {object}  [params.req]             - Request de Express (para IP y User-Agent)
 */
const registrarAuditoria = async ({
  usuarioId, empresaId, accion, tabla, registroId,
  datosAnteriores, datosNuevos, req,
}) => {
  try {
    const empId = empresaId || req?.empresa?.id || undefined;
    const ip    = req
      ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim()
         || req.socket?.remoteAddress
         || null)
      : null;
    const ua = req ? (req.headers['user-agent'] || null) : null;

    await prisma.auditoria.create({
      data: {
        ...(empId    ? { empresaId: empId }                            : {}),
        ...(usuarioId ? { usuario: { connect: { id: usuarioId } } }   : {}),
        accion,
        tabla:       tabla       || null,
        registroId:  registroId  || null,
        datosAntes:  datosAnteriores || undefined,
        datosNuevos: datosNuevos     || undefined,
        ip,
        userAgent:   ua,
      },
    });
  } catch (error) {
    console.error('Error al registrar auditoría:', error.message);
  }
};

module.exports = { registrarAuditoria };
