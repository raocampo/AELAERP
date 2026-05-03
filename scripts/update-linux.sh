#!/usr/bin/env bash
# ============================================================
#  SCFI — Script de actualización Linux/VPS
#
#  Uso:
#    sudo ./update-linux.sh
#
#  Qué hace:
#    1. Copia los nuevos archivos (sin borrar .env ni uploads)
#    2. Instala/actualiza dependencias
#    3. Aplica cambios de BD con backup y rollback automático
#    4. Recompila el frontend
#    5. Reinicia el backend con PM2 (sin downtime)
# ============================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${BLUE}  → $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }

[[ $EUID -ne 0 ]] && echo "Ejecuta como root: sudo $0" && exit 1

INSTALL_DIR="/opt/scfi"
SCFI_USER="scfi"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "\n${BLUE}  SCFI — Actualización${NC}\n"

# Leer configuración actual
source "$INSTALL_DIR/backend/.env"

mkdir -p /var/backups/scfi
info "El backup se realizará justo antes de aplicar migraciones Prisma."

# 2. Copiar nuevos archivos (preservar .env y uploads)
info "Copiando nuevos archivos..."
rsync -a --exclude='node_modules' --exclude='.env' --exclude='uploads/' \
  --exclude='.git' --exclude='*.log' \
  "$PROJECT_DIR/backend/"  "$INSTALL_DIR/backend/"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='dist' \
  "$PROJECT_DIR/frontend/" "$INSTALL_DIR/frontend/"
chown -R "$SCFI_USER:$SCFI_USER" "$INSTALL_DIR"
ok "Archivos actualizados"

# 3. Actualizar dependencias backend
info "Actualizando dependencias del backend..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/backend && npm install --production --quiet"
ok "Dependencias backend actualizadas"

# 4. Aplicar cambios de BD
info "Aplicando cambios de base de datos con backup seguro..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/backend && DB_BACKUP_DIR=/var/backups/scfi npm run db:migrate:safe"
ok "Base de datos actualizada"

# 5. Recompilar frontend
info "Actualizando dependencias del frontend..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/frontend && npm install --quiet"

info "Compilando frontend..."
DOMINIO=$(grep FRONTEND_URL "$INSTALL_DIR/backend/.env" | cut -d'/' -f3)
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/frontend && \
  VITE_API_URL='http://${DOMINIO}/api' npm run build"
ok "Frontend recompilado"

# 6. Recargar Nginx (por si cambió la config)
nginx -t 2>/dev/null && systemctl reload nginx
ok "Nginx recargado"

# 7. Reiniciar backend con PM2 (reload = zero-downtime)
info "Reiniciando backend..."
sudo -u "$SCFI_USER" pm2 reload scfi-backend --update-env
ok "Backend reiniciado"

echo -e "\n${GREEN}  ✓ Actualización completada${NC}"
echo "  Backups de BD: /var/backups/scfi"
echo "  Para ver estado: pm2 status"
echo ""
