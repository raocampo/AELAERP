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

echo "--- Sincronizando schema con la BD (prisma db push) ---"
npx prisma db push --skip-generate --accept-data-loss
DB_EXIT=$?

if [ $DB_EXIT -ne 0 ]; then
  echo ""
  echo "ADVERTENCIA: prisma db push falló (exit $DB_EXIT)."
  echo "El servidor arrancará igual — revisa los Deploy Logs de Railway."
  echo ""
fi

echo ""
echo "--- Iniciando servidor Node.js ---"
exec node server.js
