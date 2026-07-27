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

/**
 * Siguiente secuencial de Factura, calculado de forma ATÓMICA dentro de una
 * transacción — a diferencia de `siguienteSecuencial()` (findFirst/aggregate
 * + cálculo en 2 pasos separados, con posible carrera si 2 escrituras
 * concurrentes leen el mismo máximo antes de que cualquiera inserte).
 *
 * Necesario porque varias cajas físicas pueden compartir un mismo punto de
 * emisión (ver modelo `cajas`) — la concurrencia real ya no es un caso raro.
 * `puntos_emision.ultimoSecuencialFactura` se incrementa con
 * `UPDATE ... SET x = x+1 RETURNING x`, atómico a nivel de fila en Postgres:
 * dos transacciones concurrentes se serializan en el lock de esa fila, sin
 * necesitar `SELECT ... FOR UPDATE` explícito ni aislamiento SERIALIZABLE.
 *
 * No hace falta que el llamador esté dentro de un `$transaction` — el
 * `UPDATE` en sí ya es atómico. Si algo falla después (ej. generación de XML)
 * y el documento nunca se crea, el secuencial reservado queda como un salto
 * en la numeración — legal ante el SRI (lo que NO es legal es un duplicado).
 *
 * @param {PrismaClient} tx - cliente de Prisma (normal o dentro de una transacción)
 * @param {number}       empresaId
 * @param {string}       establecimiento
 * @param {string}       puntoEmision
 * @returns {Promise<number>} siguiente número (sin pad)
 */
async function siguienteSecuencialFacturaAtomico(tx, empresaId, establecimiento, puntoEmision) {
  const punto = await tx.puntos_emision.findFirst({
    where:  { empresaId, establecimiento, puntoEmision },
    select: { id: true, ultimoSecuencialFactura: true, secInicialFactura: true },
  });

  if (!punto) {
    // Integración/offline sin selector de caja: nunca creó su punto de
    // emisión. Se crea aquí para no bloquear la emisión — mismo criterio de
    // "migración perezosa" ya usado en puntos-emision/activo.
    const creado = await tx.puntos_emision.create({
      data: { empresaId, establecimiento, puntoEmision, ultimoSecuencialFactura: 0 },
    });
    const actualizado = await tx.puntos_emision.update({
      where: { id: creado.id },
      data:  { ultimoSecuencialFactura: { increment: 1 } },
    });
    return actualizado.ultimoSecuencialFactura;
  }

  if (punto.ultimoSecuencialFactura === null) {
    // Punto de emisión creado antes de esta migración (no debería pasar tras
    // el backfill, pero se cubre por seguridad): arranca desde su secuencial
    // inicial configurado.
    await tx.puntos_emision.update({
      where: { id: punto.id },
      data:  { ultimoSecuencialFactura: punto.secInicialFactura },
    });
  }

  const actualizado = await tx.puntos_emision.update({
    where: { id: punto.id },
    data:  { ultimoSecuencialFactura: { increment: 1 } },
  });
  return actualizado.ultimoSecuencialFactura;
}

module.exports = { siguienteSecuencial, siguienteSecuencialFacturaAtomico };
