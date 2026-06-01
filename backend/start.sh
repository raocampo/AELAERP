#!/bin/sh
# ============================================================
#  AELA ERP — Script de arranque para Railway
#  Aplica schema a la BD y luego inicia el servidor.
# ============================================================

echo ""
echo "======================================"
echo "  AELA ERP — Iniciando backend..."
echo "======================================"
echo "  NODE_ENV : $NODE_ENV"
echo "  PORT     : $PORT"
# Mostrar URL enmascarada para verificar que DATABASE_URL está inyectada
DB_MASKED=$(echo "$DATABASE_URL" | sed 's|://[^:]*:[^@]*@|://***:***@|')
echo "  DB URL   : $DB_MASKED"
echo ""

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL no está definida. Revisa las variables en Railway."
  exit 1
fi

echo "--- Aplicando correcciones de schema (SQL directo, idempotente) ---"
node scripts/applySchemaFixes.js

echo ""
echo "--- Verificando historial de migraciones (baseline si es necesario) ---"
node scripts/baselineMigrations.js

echo ""
echo "--- Aplicando migraciones nuevas (prisma migrate deploy) ---"
npx prisma migrate deploy
DB_EXIT=$?
if [ $DB_EXIT -ne 0 ]; then
  echo ""
  echo "ADVERTENCIA: prisma migrate deploy falló (exit $DB_EXIT) — el servidor arrancará igual."
  echo ""
fi

echo ""
echo "--- Inicializando BD master (migrateMaster.js) ---"
node scripts/migrateMaster.js
MASTER_EXIT=$?
if [ $MASTER_EXIT -ne 0 ]; then
  echo "ADVERTENCIA: migrateMaster.js salió con error $MASTER_EXIT — el servidor arranca igual."
fi

echo ""
echo "--- Corrigiendo credenciales de tenants (fixTenantCredentials.js) ---"
node scripts/fixTenantCredentials.js
echo ""
echo "--- Iniciando servidor Node.js ---"
exec node server.js
