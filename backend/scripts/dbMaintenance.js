#!/usr/bin/env node
// ============================================================
// AELA — Mantenimiento seguro de base de datos
//
// Comandos:
//   node scripts/dbMaintenance.js backup
//   node scripts/dbMaintenance.js migrate
//   node scripts/dbMaintenance.js migrate-dev --name nombre_migracion
//   node scripts/dbMaintenance.js restore <archivo.sql>
//
// Requiere pg_dump y psql disponibles en PATH.
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_BACKUP_DIR = process.env.NODE_ENV === 'production'
  ? '/tmp/aela-backups'
  : path.join(PROJECT_ROOT, 'backups');
const BACKUP_DIR = process.env.DB_BACKUP_DIR || DEFAULT_BACKUP_DIR;

function log(msg) {
  console.log(msg);
}

function fail(msg) {
  console.error(`\n[ERROR] ${msg}`);
  process.exit(1);
}

function bin(name) {
  if (process.platform === 'win32' && ['pg_dump', 'psql'].includes(name)) {
    const fromPgBin = process.env.PG_BIN ? path.join(process.env.PG_BIN, `${name}.exe`) : null;
    if (fromPgBin && fs.existsSync(fromPgBin)) return fromPgBin;

    const pgRoot = 'C:\\Program Files\\PostgreSQL';
    if (fs.existsSync(pgRoot)) {
      const versions = fs.readdirSync(pgRoot)
        .filter((entry) => fs.statSync(path.join(pgRoot, entry)).isDirectory())
        .sort((a, b) => Number(b) - Number(a));
      for (const version of versions) {
        const candidate = path.join(pgRoot, version, 'bin', `${name}.exe`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }

  return process.platform === 'win32' && ['npm', 'npx'].includes(name)
    ? `${name}.cmd`
    : name;
}

function run(command, args, { env = {}, stdio = 'inherit' } = {}) {
  const result = spawnSync(bin(command), args, {
    cwd: path.join(PROJECT_ROOT, 'backend'),
    env: { ...process.env, ...env },
    stdio,
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} terminó con código ${result.status}`);
  }
  return result;
}

function readDatabaseUrl() {
  const url = (process.env.DATABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  if (!url) fail('DATABASE_URL no está configurada');
  return url;
}

function parseDatabaseUrl(rawUrl) {
  const clean = rawUrl.trim().replace(/^["']|["']$/g, '');
  const withoutProtocol = clean.replace(/^postgres(?:ql)?:\/\//i, '');
  const atIndex = withoutProtocol.lastIndexOf('@');
  if (atIndex === -1) fail('DATABASE_URL inválida: no se encontró usuario/host');

  const credentials = withoutProtocol.slice(0, atIndex);
  const hostAndDb = withoutProtocol.slice(atIndex + 1);
  const colonIndex = credentials.indexOf(':');
  if (colonIndex === -1) fail('DATABASE_URL inválida: no se encontró contraseña');

  const user = decodeURIComponent(credentials.slice(0, colonIndex));
  const password = decodeURIComponent(credentials.slice(colonIndex + 1));
  const slashIndex = hostAndDb.indexOf('/');
  if (slashIndex === -1) fail('DATABASE_URL inválida: no se encontró nombre de BD');

  const hostPort = hostAndDb.slice(0, slashIndex);
  const dbAndQuery = hostAndDb.slice(slashIndex + 1);
  const [databaseRaw, queryRaw = ''] = dbAndQuery.split('?');
  const database = decodeURIComponent(databaseRaw);
  const query = new URLSearchParams(queryRaw);
  const [host, portRaw] = hostPort.split(':');

  return {
    user,
    password,
    host,
    port: portRaw || '5432',
    database,
    sslmode: query.get('sslmode') || '',
  };
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
  ].join('') + '_' + [
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function ensureBackupDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function backupDatabase() {
  const conn = parseDatabaseUrl(readDatabaseUrl());
  ensureBackupDir();

  const file = path.join(BACKUP_DIR, `aela_${conn.database}_${timestamp()}.sql`);
  log(`\n[DB] Backup previo: ${conn.database} (${conn.host}:${conn.port})`);
  log(`[DB] Archivo: ${file}`);

  run('pg_dump', [
    '-h', conn.host,
    '-p', conn.port,
    '-U', conn.user,
    '-d', conn.database,
    '--no-owner',
    '--no-privileges',
    '-f', file,
  ], {
    env: {
      PGPASSWORD: conn.password,
      ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}),
    },
  });

  const sizeKb = Math.round(fs.statSync(file).size / 1024);
  log(`[DB] Backup OK (${sizeKb} KB)`);
  return file;
}

function restoreDatabase(file) {
  if (!file || !fs.existsSync(file)) {
    fail(`Backup no encontrado: ${file || '<vacío>'}`);
  }

  const conn = parseDatabaseUrl(readDatabaseUrl());
  log(`\n[DB] Restaurando backup en ${conn.database}`);
  log(`[DB] Origen: ${file}`);

  const env = {
    PGPASSWORD: conn.password,
    ...(conn.sslmode ? { PGSSLMODE: conn.sslmode } : {}),
  };
  const baseArgs = ['-h', conn.host, '-p', conn.port, '-U', conn.user, '-d', conn.database, '-v', 'ON_ERROR_STOP=1'];

  run('psql', [
    ...baseArgs,
    '-c', 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;',
  ], { env });

  run('psql', [
    ...baseArgs,
    '-f', file,
  ], { env });

  log('[DB] Restauración OK');
}

function migrateSafe({ dev = false, name = null } = {}) {
  const backupFile = backupDatabase();

  try {
    if (dev) {
      if (!name) fail('Para migrate-dev usa: npm run db:migrate:dev:safe -- --name nombre_migracion');
      log(`\n[Prisma] Ejecutando migrate dev: ${name}`);
      run('npx', ['prisma', 'migrate', 'dev', '--name', name]);
    } else {
      log('\n[Prisma] Ejecutando migrate deploy');
      run('npx', ['prisma', 'migrate', 'deploy']);
    }

    log('\n[Prisma] Regenerando cliente');
    run('npx', ['prisma', 'generate']);
    log('\n[DB] Migración segura completada. Backup conservado para rollback manual.');
  } catch (err) {
    console.error(`\n[Prisma] Falló la migración: ${err.message}`);
    console.error('[DB] Intentando restaurar el backup previo...');
    try {
      restoreDatabase(backupFile);
    } catch (restoreErr) {
      console.error(`\n[DB] No se pudo restaurar automáticamente: ${restoreErr.message}`);
      console.error(`[DB] Restauración manual: npm run db:restore -- "${backupFile}"`);
    }
    process.exit(1);
  }
}

function getFlagValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function printHelp() {
  log(`
AELA — mantenimiento seguro de BD

Uso:
  npm run db:backup
  npm run db:migrate:safe
  npm run db:migrate:dev:safe -- --name nombre_migracion
  npm run db:restore -- backups/aela_scfi_dev_YYYYMMDD_HHMMSS.sql

Variables:
  DATABASE_URL   conexión PostgreSQL
  DB_BACKUP_DIR  carpeta de backups (opcional)
`);
}

const command = process.argv[2] || 'help';

if (command === 'backup') {
  backupDatabase();
} else if (command === 'restore') {
  restoreDatabase(process.argv[3]);
} else if (command === 'migrate') {
  migrateSafe();
} else if (command === 'migrate-dev') {
  migrateSafe({ dev: true, name: getFlagValue('--name') || getFlagValue('-n') });
} else {
  printHelp();
}
