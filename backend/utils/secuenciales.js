/**
 * Calcula el siguiente secuencial para un tipo de documento,
 * respetando el secuencial inicial configurado en puntos_emision.
 *
 * @param {PrismaClient} prisma
 * @param {number}       empresaId
 * @param {string}       establecimiento  - "001"
 * @param {string}       puntoEmision     - "001"
 * @param {number}       maxEnBD          - último secuencial numérico en la BD (0 si ninguno)
 * @param {string}       campo            - nombre del campo en puntos_emision, ej: "secInicialFactura"
 * @returns {Promise<number>}             - siguiente número (sin pad)
 */
async function siguienteSecuencial(prisma, empresaId, establecimiento, puntoEmision, maxEnBD, campo) {
  const punto = await prisma.puntos_emision.findFirst({
    where:  { empresaId, establecimiento, puntoEmision },
    select: { [campo]: true },
  });

  const inicial = punto?.[campo] ?? 0;
  return Math.max(maxEnBD, inicial) + 1;
}

module.exports = { siguienteSecuencial };
