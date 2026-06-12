/**
 * fixCertMismatch.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Transfiere el certificado P12 almacenado en la BD de un tenant (o la BD
 * principal) a la BD de otro tenant.  Usado para corregir certificados subidos
 * accidentalmente a la empresa equivocada.
 *
 * Uso:
 *   node scripts/fixCertMismatch.js --from main --to mprq
 *   node scripts/fixCertMismatch.js --from main --to mprq --dry-run
 *
 * Flags:
 *   --from <slug>   Slug del tenant origen (o "main" para la BD principal)
 *   --to   <slug>   Slug del tenant destino
 *   --dry-run       Muestra lo que haría sin modificar nada
 *
 * Requiere:
 *   DATABASE_URL           — conexión a la BD principal / aela_master
 *   Variables en .env del backend
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { Client } = require('pg');
const forge      = require('node-forge');

const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const FROM_IDX = args.indexOf('--from');
const TO_IDX   = args.indexOf('--to');

const FROM_SLUG = FROM_IDX >= 0 ? args[FROM_IDX + 1] : null;
const TO_SLUG   = TO_IDX   >= 0 ? args[TO_IDX   + 1] : null;

if (!FROM_SLUG || !TO_SLUG) {
  console.error('\nUso: node scripts/fixCertMismatch.js --from <slug|main> --to <slug> [--dry-run]\n');
  console.error('Ejemplos:');
  console.error('  node scripts/fixCertMismatch.js --from main --to mprq');
  console.error('  node scripts/fixCertMismatch.js --from corpsimtelec --to mprq --dry-run\n');
  process.exit(1);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildUrlFromMain(mainUrl, dbName) {
  const u = new URL(mainUrl);
  return `postgresql://${u.username}:${u.password}@${u.hostname}:${u.port || 5432}/${dbName}`;
}

async function obtenerUrlTenant(slug, mainUrl) {
  if (slug === 'main') return mainUrl;

  const master = new Client({ connectionString: mainUrl });
  await master.connect();
  try {
    const { rows } = await master.query(
      `SELECT "dbName", "dbHost", "dbPort", "dbUser", "dbPass"
       FROM aela_master.tenants
       WHERE slug = $1 AND estado = 'activo'
       LIMIT 1`,
      [slug]
    );
    if (!rows.length) throw new Error(`Tenant '${slug}' no encontrado en aela_master.`);

    const t = rows[0];
    // Si las credenciales del tenant coinciden con el main, reusar la contraseña del main
    const u = new URL(mainUrl);
    const pass = t.dbPass ? decodeURIComponent(t.dbPass) : decodeURIComponent(u.password);
    const host = t.dbHost || u.hostname;
    const port = t.dbPort || u.port || 5432;
    const user = t.dbUser || u.username;
    return `postgresql://${user}:${encodeURIComponent(pass)}@${host}:${port}/${t.dbName}`;
  } finally {
    await master.end().catch(() => {});
  }
}

function parsearCertCN(certB64, clave) {
  try {
    const buf   = Buffer.from(certB64, 'base64');
    const asn1  = forge.asn1.fromDer(buf.toString('binary'));
    const p12   = forge.pkcs12.pkcs12FromAsn1(asn1, clave || '');
    for (const sc of p12.safeContents) {
      for (const sb of sc.safeBags) {
        if (sb.type === forge.pki.oids.certBag && sb.cert) {
          if (!sb.cert.getExtension('basicConstraints')?.cA) {
            const cn = sb.cert.subject.getField('CN')?.value || '(sin CN)';
            const hasta = sb.cert.validity.notAfter.toISOString().slice(0, 10);
            return { cn, hasta };
          }
        }
      }
    }
    return { cn: '(no se pudo leer)', hasta: null };
  } catch (e) {
    return { cn: `(error: ${e.message})`, hasta: null };
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function run() {
  const mainUrl = process.env.DATABASE_URL;
  if (!mainUrl) { console.error('❌  DATABASE_URL no definida en .env'); process.exit(1); }

  console.log(`\n🔍  AELA — Fix de certificado mal asignado`);
  console.log(`    Origen : ${FROM_SLUG}`);
  console.log(`    Destino: ${TO_SLUG}`);
  if (DRY_RUN) console.log('    Modo   : DRY-RUN (sin cambios)\n');
  else console.log('    Modo   : REAL — se modificará la BD\n');

  // ── 1. Conectar a la BD origen ───────────────────────────────────────────
  const fromUrl = await obtenerUrlTenant(FROM_SLUG, mainUrl);
  const fromDb  = new Client({ connectionString: fromUrl });
  await fromDb.connect();

  const { rows: origenRows } = await fromDb.query(
    `SELECT id, "ruc", "razonSocial", "certificadoP12Data", "claveCertificado"
     FROM configuracion_sri
     WHERE "certificadoP12Data" IS NOT NULL
     ORDER BY id
     LIMIT 10`
  );

  if (!origenRows.length) {
    console.log(`⚠️   La BD '${FROM_SLUG}' no tiene certificados en configuracion_sri.`);
    console.log('     Nada que transferir.\n');
    await fromDb.end();
    return;
  }

  console.log(`📋  Certificados encontrados en '${FROM_SLUG}':`);
  for (const r of origenRows) {
    const info = parsearCertCN(r.certificadoP12Data, r.claveCertificado);
    console.log(`    ID=${r.id}  RUC=${r.ruc}  Empresa="${r.razonSocial}"`);
    console.log(`    Cert CN: "${info.cn}"  válido hasta ${info.hasta || '?'}`);
  }

  if (origenRows.length > 1) {
    console.log('\n⚠️   Hay más de un registro. Se transferirá el primero. Verifica manualmente si necesitas otro.\n');
  }

  const origen = origenRows[0];
  const certInfo = parsearCertCN(origen.certificadoP12Data, origen.claveCertificado);

  // ── 2. Conectar a la BD destino ──────────────────────────────────────────
  const toUrl = await obtenerUrlTenant(TO_SLUG, mainUrl);
  const toDb  = new Client({ connectionString: toUrl });
  await toDb.connect();

  // Leer config del destino
  const { rows: destinoRows } = await toDb.query(
    `SELECT id, "ruc", "razonSocial", "certificadoP12Data"
     FROM configuracion_sri
     ORDER BY id LIMIT 5`
  );

  if (!destinoRows.length) {
    console.log(`\n⚠️   La BD '${TO_SLUG}' no tiene ningún registro en configuracion_sri.`);
    console.log('     No se puede crear un registro desde este script — configura primero el RUC en esa empresa.');
    await fromDb.end();
    await toDb.end();
    process.exit(1);
  }

  const destino = destinoRows[0];
  console.log(`\n📋  Destino '${TO_SLUG}':`);
  console.log(`    ID=${destino.id}  RUC=${destino.ruc}  Empresa="${destino.razonSocial}"`);
  if (destino.certificadoP12Data) {
    const dInfo = parsearCertCN(destino.certificadoP12Data, '');
    console.log(`    Ya tiene cert: CN="${dInfo.cn}"`);
    console.log('\n⚠️   El destino ya tiene un certificado. Se sobreescribirá si continúas.');
  } else {
    console.log('    Sin certificado actualmente.');
  }

  console.log('\n─────────────────────────────────────────────────────────');
  console.log(`📦  Transferir cert "${certInfo.cn}" (hasta ${certInfo.hasta})`);
  console.log(`    DE: ${FROM_SLUG} → HACIA: ${TO_SLUG}`);
  console.log('─────────────────────────────────────────────────────────\n');

  if (DRY_RUN) {
    console.log('✅  DRY-RUN completado. Sin cambios. Ejecuta sin --dry-run para aplicar.\n');
  } else {
    // ── 3. Escribir cert en destino ──────────────────────────────────────────
    await toDb.query(
      `UPDATE configuracion_sri
       SET "certificadoP12Data" = $1,
           "claveCertificado"   = $2,
           "certificadoP12"     = NULL,
           "updatedAt"          = NOW()
       WHERE id = $3`,
      [origen.certificadoP12Data, origen.claveCertificado, destino.id]
    );
    console.log(`✅  Cert copiado a '${TO_SLUG}' (configuracion_sri id=${destino.id})`);

    // ── 4. Limpiar cert del origen ───────────────────────────────────────────
    await fromDb.query(
      `UPDATE configuracion_sri
       SET "certificadoP12Data" = NULL,
           "certificadoP12"     = NULL,
           "claveCertificado"   = NULL,
           "updatedAt"          = NOW()
       WHERE id = $1`,
      [origen.id]
    );
    console.log(`🧹  Cert eliminado de '${FROM_SLUG}' (configuracion_sri id=${origen.id})`);
    console.log('\n✅  Migración completada exitosamente.\n');
    console.log('👉  Próximos pasos:');
    console.log(`    1. Verifica en aela.corpsimtelec.com/${TO_SLUG}/configuracion-sri que el cert aparece`);
    console.log(`    2. Sube el certificado correcto de Corp Simtelec en configuracion-sri`);
  }

  await fromDb.end();
  await toDb.end();
}

run().catch((err) => {
  console.error('\n❌  Error:', err.message);
  process.exit(1);
});
