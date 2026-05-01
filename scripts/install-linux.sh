#!/usr/bin/env bash
# ============================================================
#  SCFI — Instalador para Linux (Ubuntu 22.04 / Debian)
#  Escenario: Servidor VPS o servidor propio del cliente
#
#  Uso:
#    chmod +x install-linux.sh
#    sudo ./install-linux.sh
#
#  Al finalizar:
#    - Backend corriendo con PM2 en puerto 5600
#    - Frontend compilado y servido por Nginx en puerto 80/443
#    - PostgreSQL configurado
#    - Autoarranque activo (PM2 + systemd)
# ============================================================

set -euo pipefail

# ─── Colores ────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${NC}"; }
info() { echo -e "${BLUE}  → $1${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${NC}"; }
err()  { echo -e "${RED}  ✗ $1${NC}"; exit 1; }

# ─── Banner ─────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║   SCFI — Instalador Linux / VPS      ║"
echo "  ║   Sistema de Comprobantes Fiscales    ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ─── Verificar root ─────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Ejecuta como root: sudo $0"

# ─── Variables de instalación ───────────────────────────────
INSTALL_DIR="/opt/scfi"
SCFI_USER="scfi"

# ── Preguntar al usuario ──
echo -e "\n${BOLD}Configuración de instalación:${NC}\n"

read -rp "  Plan (lite/medium/pro) [pro]: "      PLAN;        PLAN=${PLAN:-pro}
read -rp "  Dominio o IP del servidor: "          DOMINIO
read -rp "  Puerto backend [5600]: "              BACKEND_PORT; BACKEND_PORT=${BACKEND_PORT:-5600}
read -rp "  Usuario PostgreSQL [postgres]: "      DB_USER;     DB_USER=${DB_USER:-postgres}
read -rp "  Contraseña PostgreSQL: "              DB_PASS
read -rp "  Nombre de BD [scfi_db]: "             DB_NAME;     DB_NAME=${DB_NAME:-scfi_db}
read -rp "  Correo SMTP (opcional, Enter para omitir): " SMTP_USER

echo ""

# ─── 1. Actualizar sistema ───────────────────────────────────
info "Actualizando paquetes del sistema..."
apt-get update -qq && apt-get upgrade -y -qq
ok "Sistema actualizado"

# ─── 2. Instalar dependencias base ──────────────────────────
info "Instalando dependencias (Node.js 20, PostgreSQL, Nginx, PM2)..."

# Node.js 20 LTS
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
  apt-get install -y -qq nodejs
fi

# PostgreSQL
if ! command -v psql &>/dev/null; then
  apt-get install -y -qq postgresql postgresql-contrib
  systemctl enable postgresql
  systemctl start postgresql
fi

# Nginx
if ! command -v nginx &>/dev/null; then
  apt-get install -y -qq nginx
  systemctl enable nginx
fi

# PM2 (gestor de procesos Node.js)
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --quiet
fi

ok "Dependencias instaladas (Node $(node -v), PostgreSQL $(psql --version | awk '{print $3}'))"

# ─── 3. Crear usuario del sistema ────────────────────────────
if ! id "$SCFI_USER" &>/dev/null; then
  useradd -r -m -d "$INSTALL_DIR" -s /bin/bash "$SCFI_USER"
  ok "Usuario '$SCFI_USER' creado"
fi

# ─── 4. Configurar PostgreSQL ────────────────────────────────
info "Configurando base de datos..."

# Cambiar contraseña del usuario postgres
sudo -u postgres psql -c "ALTER USER $DB_USER PASSWORD '$DB_PASS';" 2>/dev/null || true

# Crear la BD si no existe
sudo -u postgres createdb "$DB_NAME" 2>/dev/null || warn "La BD '$DB_NAME' ya existe, continuando..."

ok "Base de datos '$DB_NAME' lista"

# ─── 5. Copiar código ────────────────────────────────────────
info "Copiando archivos de SCFI a $INSTALL_DIR..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

mkdir -p "$INSTALL_DIR"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='*.log' \
  "$PROJECT_DIR/" "$INSTALL_DIR/"

chown -R "$SCFI_USER:$SCFI_USER" "$INSTALL_DIR"
ok "Archivos copiados"

# ─── 6. Configurar .env del backend ─────────────────────────
info "Generando configuración del backend..."

JWT_SECRET=$(openssl rand -hex 32)
DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

cat > "$INSTALL_DIR/backend/.env" <<EOF
# SCFI — Configuración de producción
# Generado automáticamente por install-linux.sh

DATABASE_URL="${DB_URL}"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="30d"
PORT=${BACKEND_PORT}
NODE_ENV=production
SCFI_EDITION=${PLAN}
MODO_EMPRESA=mono
FRONTEND_URL=http://${DOMINIO}

# SMTP (configurar si se requiere envío de correos)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=${SMTP_USER}
SMTP_PASS=
SMTP_FROM=
EOF

chmod 600 "$INSTALL_DIR/backend/.env"
chown "$SCFI_USER:$SCFI_USER" "$INSTALL_DIR/backend/.env"
ok "Configuración backend creada"

# ─── 7. Instalar dependencias y migrar BD ───────────────────
info "Instalando dependencias del backend..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/backend && npm install --production --quiet"

info "Aplicando schema de base de datos..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/backend && npx prisma db push --accept-data-loss"
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/backend && npx prisma generate"

ok "Backend configurado"

# ─── 8. Compilar frontend ────────────────────────────────────
info "Instalando dependencias del frontend..."
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/frontend && npm install --quiet"

info "Compilando frontend para producción..."
VITE_API_URL="http://${DOMINIO}:${BACKEND_PORT}/api" \
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR/frontend && \
  VITE_API_URL='http://${DOMINIO}:${BACKEND_PORT}/api' npm run build"

ok "Frontend compilado"

# ─── 9. Configurar PM2 ──────────────────────────────────────
info "Configurando PM2 (gestor de procesos)..."

cat > "$INSTALL_DIR/ecosystem.config.js" <<'EOF'
module.exports = {
  apps: [{
    name       : 'scfi-backend',
    script     : 'server.js',
    cwd        : '/opt/scfi/backend',
    instances  : 1,
    autorestart: true,
    watch      : false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file : '/var/log/scfi/error.log',
    out_file   : '/var/log/scfi/out.log',
  }],
};
EOF

mkdir -p /var/log/scfi
chown -R "$SCFI_USER:$SCFI_USER" /var/log/scfi

# Iniciar backend con PM2
sudo -u "$SCFI_USER" bash -c "cd $INSTALL_DIR && pm2 start ecosystem.config.js --env production"

# Guardar lista de procesos PM2
sudo -u "$SCFI_USER" pm2 save

# Configurar PM2 para arrancar con el sistema (systemd)
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$SCFI_USER" --hp "$INSTALL_DIR" | bash

ok "PM2 configurado con autoarranque"

# ─── 10. Configurar Nginx ────────────────────────────────────
info "Configurando Nginx..."

cat > "/etc/nginx/sites-available/scfi" <<EOF
server {
    listen 80;
    server_name ${DOMINIO};

    # Frontend (archivos estáticos compilados)
    root ${INSTALL_DIR}/frontend/dist;
    index index.html;

    # SPA: todas las rutas van a index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API Backend (proxy inverso)
    location /api/ {
        proxy_pass         http://127.0.0.1:${BACKEND_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        client_max_body_size 20M;
    }

    # Archivos subidos
    location /uploads/ {
        alias ${INSTALL_DIR}/backend/uploads/;
    }

    # Logs
    access_log /var/log/nginx/scfi-access.log;
    error_log  /var/log/nginx/scfi-error.log;
}
EOF

ln -sf /etc/nginx/sites-available/scfi /etc/nginx/sites-enabled/scfi
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

ok "Nginx configurado"

# ─── 11. Firewall básico ────────────────────────────────────
if command -v ufw &>/dev/null; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
  ok "Firewall configurado (puertos 22, 80, 443)"
fi

# ─── Resumen final ──────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ✓ SCFI instalado correctamente         ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"
echo -e "  ${BOLD}URL de acceso:${NC}    http://${DOMINIO}"
echo -e "  ${BOLD}Plan activo:${NC}      ${PLAN}"
echo -e "  ${BOLD}Base de datos:${NC}    ${DB_NAME}"
echo -e "  ${BOLD}Logs backend:${NC}     /var/log/scfi/"
echo -e "  ${BOLD}Logs Nginx:${NC}       /var/log/nginx/scfi-*.log"
echo ""
echo -e "  ${YELLOW}Comandos útiles:${NC}"
echo "    pm2 status                   # ver estado del backend"
echo "    pm2 logs scfi-backend        # ver logs en tiempo real"
echo "    pm2 restart scfi-backend     # reiniciar backend"
echo "    systemctl status nginx       # ver estado de Nginx"
echo ""
echo -e "  ${YELLOW}Próximos pasos:${NC}"
echo "    1. Abrir http://${DOMINIO} en el navegador"
echo "    2. Completar la configuración inicial (empresa + admin)"
echo "    3. Configurar certificado SSL: sudo certbot --nginx -d ${DOMINIO}"
echo ""
