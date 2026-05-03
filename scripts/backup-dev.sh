#!/usr/bin/env bash
# ============================================================
#  AELA — Backup rápido de base de datos (desarrollo - Linux/Mac)
#
#  Uso desde la raíz del proyecto:
#    bash scripts/backup-dev.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_DIR/backend"
BACKUP_DIR="$PROJECT_DIR/backups"

echo ""
echo "  AELA — Backup de base de datos"
echo ""

cd "$BACKEND_DIR"
DB_BACKUP_DIR="$BACKUP_DIR" npm run db:backup
