// Reencripta dbPass en una transacción. Por defecto solo revisa; --apply escribe.
// Desplegar antes con la clave nueva y DB_ENCRYPT_KEY_PREVIOUS; retirar la
// anterior únicamente cuando --check confirme que todos usan la clave actual.
require('dotenv').config();
const { Client } = require('pg');
const { cifrar, descifrar } = require('../utils/cifrado');

async function rotarCifradoTenants(client, { aplicar = false, soloActual = false } = {}) {
  cifrar('validar configuración');
  await client.query(aplicar ? 'BEGIN' : 'BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    const { rows } = await client.query(`SELECT id, "dbPass" FROM aela_master.tenants
      ORDER BY id${aplicar ? ' FOR UPDATE' : ''}`);
    const resultado = { tenants: rows.length, actuales: 0, porMigrar: 0, vacios: 0, modificados: 0 };
    for (const tenant of rows) {
      if (!tenant.dbPass) {
        resultado.vacios++;
        continue;
      }
      const texto = descifrar(tenant.dbPass, { permitirClaveAnterior: !soloActual });
      if (tenant.dbPass.startsWith('enc:')) {
        try {
          descifrar(tenant.dbPass, { permitirClaveAnterior: false });
          resultado.actuales++;
          continue;
        } catch (err) {
          if (soloActual) throw err;
        }
      }
      if (soloActual) throw new Error('Hay credenciales pendientes de cifrar con la clave actual');
      resultado.porMigrar++;
      if (aplicar) {
        await client.query('UPDATE aela_master.tenants SET "dbPass"=$1 WHERE id=$2', [cifrar(texto), tenant.id]);
        resultado.modificados++;
      }
    }
    await client.query(aplicar ? 'COMMIT' : 'ROLLBACK');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--check'].includes(arg)) || (args.includes('--apply') && args.includes('--check'))) {
    throw new Error('Usar sin argumentos para revisar, --apply para migrar o --check para verificar la clave actual');
  }
  if (!process.env.DATABASE_MASTER_URL) throw new Error('Falta DATABASE_MASTER_URL');
  const client = new Client({ connectionString: process.env.DATABASE_MASTER_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const resultado = await rotarCifradoTenants(client, { aplicar: args.includes('--apply'), soloActual: args.includes('--check') });
    console.log(JSON.stringify({ modo: args.includes('--apply') ? 'aplicar' : args.includes('--check') ? 'verificar' : 'revisar', ...resultado }));
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Falló la rotación de cifrado. No se imprimen URLs, claves ni contraseñas. Revisar configuración y conectividad.');
    process.exitCode = 1;
  });
}

module.exports = { rotarCifradoTenants };
