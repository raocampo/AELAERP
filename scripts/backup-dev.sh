#!/usr/bin/env bash
# ============================================================
#  SCFI — Backup rápido de base de datos (desarrollo - Linux/Mac)
#
#  Uso desde la raíz del proyecto:
#    bash scripts/backup-dev.sh
#
#  EJECUTAR ANTES DE TODA MIGRACIÓN PRISMA
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKUP_DIR="$PROJECT_DIR/backups"
ENV_FILE="$BACKEND_DIR/.env"

ok()   { echo "  [OK] $*"; }
info() { echo "  --> $*"; }
err()  { echo "  [ERROR] $*" >&2; }

echo ""
echo "  SCFI — Backup de base de datos"
echo ""

# ─── Leer DATABASE_URL ───────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    err "No se encontró .env en $BACKEND_DIR"
    exit 1
fi

DB_URL=$(grep -E '^DATABASE_URL\s*=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL\s*=\s*//' | tr -d '"'"'"' ')

if [ -z "$DB_URL" ]; then
    err "DATABASE_URL no encontrada en .env"
    exit 1
fi

# Parsear: postgresql://user:password@host:port/dbname
DB_USER=$(echo "$DB_URL" | sed -E 's|postgresql://([^:]+):.*|\1|')
DB_PASS=$(echo "$DB_URL" | sed -E 's|postgresql://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$DB_URL" | sed -E 's|postgresql://[^@]+@([^:/]+).*|\1|')
DB_PORT=$(echo "$DB_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+).*|\1|')

[ -z "$DB_PORT" ] && DB_PORT=5432

info "Base de datos: $DB_NAME en $DB_HOST:$DB_PORT (usuario: $DB_USER)"

# ─── Crear carpeta de backups ─────────────────────────────────
mkdir -p "$BACKUP_DIR"

# ─── Ejecutar pg_dump ────────────────────────────────────────
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/scfi_dev_$TIMESTAMP.sql"

info "Generando backup..."

export PGPASSWORD="$DB_PASS"

pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$BACKUP_FILE"

unset PGPASSWORD

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
ok "Backup guardado: $BACKUP_FILE ($SIZE)"

# ─── Limpiar backups antiguos (mantener últimos 20) ──────────
ls -t "$BACKUP_DIR"/scfi_dev_*.sql 2>/dev/null | tail -n +21 | xargs rm -f 2>/dev/null || true

echo ""
echo "  Backup completado exitosamente."
echo "  Archivo: $BACKUP_FILE"
echo ""
