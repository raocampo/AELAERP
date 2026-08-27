#!/usr/bin/env node
// ====================================
// SCRIPT: Reparar mojibake UTF-8 -> Latin-1 en contribuyentes_sri (catastro)
//
// A diferencia de repararMojibakeContribuyentes.js (que usa Prisma normal y
// no aguanta las 6.8M filas de esta tabla -- el motor de Prisma revienta al
// intentar convertir ciertas filas a String de Node), este script hace TODO
// el trabajo del lado de Postgres con una funcion PL/pgSQL: nunca trae el
// texto corrupto de vuelta a Node, solo contadores. Esto es ademas mucho
// mas rapido para una tabla de este tamano.
//
// Los caracteres sospechosos ("A con tilde" cod. 195, "A circunfleja" cod.
// 194 -- los primeros bytes de una vocal acentuada/ene UTF-8 mal leida como
// Latin-1) se generan con chr(codigo) dentro del SQL, NUNCA como literal en
// este archivo ni en la terminal -- ver feedback_no_retipear_caracteres_
// acentuados_bd.md: escribir el caracter literal en un comando es justo lo
// que corrompio peor los datos la primera vez que se reparo esto a mano.
//
// Uso:
//   node scripts/repararEncodingCatastroSRI.js                  (dry-run)
//   node scripts/repararEncodingCatastroSRI.js --aplicar         (aplica)
//   node scripts/repararEncodingCatastroSRI.js --limite-id 100000  (acota
//     el rango de id, util para probar antes de correr sobre toda la tabla)
// ====================================

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const NOMBRE_FUNCION = 'reparar_encoding_catastro_tmp';

function sqlFuncion(limiteId) {
  const filtroId = limiteId ? `AND id <= ${Number(limiteId)}` : '';
  return `
CREATE OR REPLACE FUNCTION ${NOMBRE_FUNCION}(p_aplicar boolean DEFAULT false)
RETURNS TABLE(procesados int, reparados int, omitidos int) AS $F$
DECLARE
  v_a_tilde TEXT := chr(195);
  v_a_circ  TEXT := chr(194);
  r RECORD;
  nuevo_rs TEXT;
  nuevo_nc TEXT;
  v_reparados INT := 0;
  v_omitidos INT := 0;
  v_procesados INT := 0;
BEGIN
  FOR r IN
    SELECT id, "razonSocial", "nombreComercial" FROM contribuyentes_sri
    WHERE (
      "razonSocial" LIKE '%'||v_a_tilde||'%' OR "razonSocial" LIKE '%'||v_a_circ||'%'
      OR "nombreComercial" LIKE '%'||v_a_tilde||'%' OR "nombreComercial" LIKE '%'||v_a_circ||'%'
    )
    ${filtroId}
  LOOP
    v_procesados := v_procesados + 1;
    nuevo_rs := r."razonSocial";
    nuevo_nc := r."nombreComercial";
    BEGIN
      IF r."razonSocial" LIKE '%'||v_a_tilde||'%' OR r."razonSocial" LIKE '%'||v_a_circ||'%' THEN
        nuevo_rs := convert_from(convert_to(r."razonSocial", 'LATIN1'), 'UTF8');
      END IF;
      IF r."nombreComercial" IS NOT NULL AND (r."nombreComercial" LIKE '%'||v_a_tilde||'%' OR r."nombreComercial" LIKE '%'||v_a_circ||'%') THEN
        nuevo_nc := convert_from(convert_to(r."nombreComercial", 'LATIN1'), 'UTF8');
      END IF;

      IF (nuevo_rs IS DISTINCT FROM r."razonSocial" OR nuevo_nc IS DISTINCT FROM r."nombreComercial")
         AND NOT (nuevo_rs LIKE '%'||v_a_tilde||'%' OR nuevo_rs LIKE '%'||v_a_circ||'%')
         AND (nuevo_nc IS NULL OR NOT (nuevo_nc LIKE '%'||v_a_tilde||'%' OR nuevo_nc LIKE '%'||v_a_circ||'%'))
      THEN
        v_reparados := v_reparados + 1;
        IF p_aplicar THEN
          UPDATE contribuyentes_sri SET "razonSocial" = nuevo_rs, "nombreComercial" = nuevo_nc WHERE id = r.id;
        END IF;
      ELSE
        v_omitidos := v_omitidos + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_omitidos := v_omitidos + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT v_procesados, v_reparados, v_omitidos;
END;
$F$ LANGUAGE plpgsql;
`;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const idxLimite = args.indexOf('--limite-id');
  const limiteId = idxLimite >= 0 ? args[idxLimite + 1] : null;

  console.log(aplicar ? 'Modo: APLICAR cambios' : 'Modo: dry-run (solo contar)');
  if (limiteId) console.log(`Acotado a id <= ${limiteId}`);
  console.log('========================================');

  const t0 = Date.now();
  await prisma.$executeRawUnsafe(sqlFuncion(limiteId));

  const resultado = await prisma.$queryRawUnsafe(
    `SELECT * FROM ${NOMBRE_FUNCION}(${aplicar ? 'true' : 'false'})`
  );

  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${NOMBRE_FUNCION}(boolean)`);

  const { procesados, reparados, omitidos } = resultado[0];
  console.log(`Procesados : ${procesados}`);
  console.log(`Reparados  : ${reparados}${aplicar ? ' (aplicados)' : ' (se aplicarían con --aplicar)'}`);
  console.log(`Omitidos   : ${omitidos} (no cambiaron o el round-trip no dio un resultado limpio)`);
  console.log(`Tiempo     : ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${NOMBRE_FUNCION}(boolean)`);
  } catch { /* ignore */ }
  await prisma.$disconnect();
  process.exit(1);
});
