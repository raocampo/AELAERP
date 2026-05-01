// ====================================
// UTILIDAD DE AUDITORÍA
// Registra acciones en la tabla auditoria
// ====================================

const prisma = require('../config/prisma');

/**
 * Registrar una acción de auditoría
 * @param {Object} params
 * @param {number} params.usuarioId - ID del usuario que realizó la acción
 * @param {string} params.accion - Tipo de acción (INSERT, UPDATE, DELETE, LOGIN, LOGOUT, etc.)
 * @param {string} params.tabla - Tabla afectada
 * @param {number} params.registroId - ID del registro afectado
 * @param {Object} params.datosAnteriores - Datos antes del cambio (para UPDATE/DELETE)
 * @param {Object} params.datosNuevos - Datos después del cambio (para INSERT/UPDATE)
 * @param {Object} params.req - Objeto request de Express (para IP y userAgent)
 */
const registrarAuditoria = async ({ usuarioId, accion, tabla, registroId, datosAnteriores, datosNuevos, req }) => {
    try {
        await prisma.auditoria.create({
            data: {
                usuarioId: usuarioId || null,
                accion,
                tabla,
                registroId: registroId || null,
                datosAnteriores: datosAnteriores || undefined,
                datosNuevos: datosNuevos || undefined,
                ip: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null) : null,
                userAgent: req ? (req.headers['user-agent'] || null) : null
            }
        });
    } catch (error) {
        // No lanzar error para no interrumpir la operación principal
        console.error('Error al registrar auditoría:', error.message);
    }
};

module.exports = { registrarAuditoria };
