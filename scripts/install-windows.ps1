# ============================================================
#  SCFI — Instalador para Windows (local / red interna)
#  Escenario: PC de oficina o servidor Windows sin internet
#
#  Uso (ejecutar como Administrador):
#    PowerShell -ExecutionPolicy Bypass -File install-windows.ps1
#
#  Al finalizar:
#    - Backend y Frontend corren como Servicios de Windows
#    - Se inician automáticamente al encender el equipo
#    - Accesible desde cualquier PC de la red local
#    - PostgreSQL configurado con autoarranque
# ============================================================

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

# ─── Colores ────────────────────────────────────────────────
function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "  --> $msg" -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host "  [!] $msg"  -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "  [X] $msg"  -ForegroundColor Red; exit 1 }

# ─── Banner ─────────────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "  ║   SCFI — Instalador Windows (Local)      ║" -ForegroundColor Blue
Write-Host "  ║   Sistema de Comprobantes Fiscales        ║" -ForegroundColor Blue
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# ─── Directorio del script / proyecto ────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir

# ─── Preguntar configuración ─────────────────────────────────
Write-Host "  Configuración de instalación:" -ForegroundColor White
Write-Host ""

$PLAN         = Read-Host "  Plan (lite/medium/pro) [pro]"
if (-not $PLAN) { $PLAN = "pro" }

$BACKEND_PORT = Read-Host "  Puerto backend [5600]"
if (-not $BACKEND_PORT) { $BACKEND_PORT = "5600" }

$FRONTEND_PORT = Read-Host "  Puerto frontend [5174]"
if (-not $FRONTEND_PORT) { $FRONTEND_PORT = "5174" }

$DB_USER  = Read-Host "  Usuario PostgreSQL [postgres]"
if (-not $DB_USER) { $DB_USER = "postgres" }

$DB_PASS  = Read-Host "  Contraseña PostgreSQL" -AsSecureString
$DB_PASS  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($DB_PASS))

$DB_NAME  = Read-Host "  Nombre de base de datos [scfi_db]"
if (-not $DB_NAME) { $DB_NAME = "scfi_db" }

# Detectar IP local automáticamente
$LocalIP = (Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  IP local detectada: $LocalIP" -ForegroundColor Yellow
Write-Host "  Los usuarios de la red accederán a: http://${LocalIP}:${FRONTEND_PORT}" -ForegroundColor Yellow
Write-Host ""

# ─── Rutas de instalación ─────────────────────────────────────
$InstallDir = "C:\SCFI"
$BackendDir  = "$InstallDir\backend"
$FrontendDir = "$InstallDir\frontend"
$LogDir      = "$InstallDir\logs"

# ─── 1. Verificar requisitos previos ─────────────────────────
Write-Info "Verificando requisitos..."

# Node.js
try {
    $nodeVersion = node --version 2>&1
    Write-Ok "Node.js $nodeVersion encontrado"
} catch {
    Write-Err "Node.js no está instalado. Descárgalo de https://nodejs.org (versión 20 LTS)"
}

# PostgreSQL
$pgPath = Get-Command psql -ErrorAction SilentlyContinue
if (-not $pgPath) {
    Write-Warn "psql no encontrado en PATH. Asegúrate de que PostgreSQL está instalado."
    Write-Warn "Descarga: https://www.postgresql.org/download/windows/"
    Write-Warn "Durante la instalación marca 'Add to PATH'"
    Write-Host ""
    $continue = Read-Host "  ¿Continuar de todos modos? (s/n)"
    if ($continue -ne "s") { exit 1 }
}

# NSSM (para crear servicios Windows)
$nssmPath = "$InstallDir\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Info "Descargando NSSM (gestor de servicios Windows)..."
    try {
        $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
        $nssmZip = "$env:TEMP\nssm.zip"
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing
        Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm" -Force
        Copy-Item "$env:TEMP\nssm\nssm-2.24\win64\nssm.exe" $nssmPath
        Write-Ok "NSSM descargado"
    } catch {
        Write-Warn "No se pudo descargar NSSM automáticamente."
        Write-Warn "Descarga manual: https://nssm.cc/download"
        Write-Warn "Copia nssm.exe a $nssmPath"
        Write-Host ""
        $continue = Read-Host "  ¿Ya copiaste nssm.exe? (s/n)"
        if ($continue -ne "s" -or -not (Test-Path $nssmPath)) {
            Write-Err "NSSM requerido para crear servicios Windows."
        }
    }
}
Write-Ok "NSSM disponible"

# ─── 2. Crear estructura de directorios ──────────────────────
Write-Info "Creando directorios en $InstallDir..."

New-Item -ItemType Directory -Force -Path $InstallDir  | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir      | Out-Null

# Copiar proyecto (si no es el mismo directorio)
if ($ProjectDir -ne $InstallDir) {
    Write-Info "Copiando archivos del proyecto..."

    # Backend
    if (Test-Path "$ProjectDir\backend") {
        robocopy "$ProjectDir\backend" $BackendDir /E /XD node_modules .git /XF "*.log" /NFL /NDL /NJH /NJS | Out-Null
    }

    # Frontend
    if (Test-Path "$ProjectDir\frontend") {
        robocopy "$ProjectDir\frontend" $FrontendDir /E /XD node_modules .git dist /XF "*.log" /NFL /NDL /NJH /NJS | Out-Null
    }
    Write-Ok "Archivos copiados"
} else {
    $BackendDir  = "$ProjectDir\backend"
    $FrontendDir = "$ProjectDir\frontend"
    Write-Ok "Usando directorio del proyecto: $ProjectDir"
}

# ─── 3. Configurar base de datos ─────────────────────────────
Write-Info "Configurando PostgreSQL..."

# Intentar crear la BD
try {
    $env:PGPASSWORD = $DB_PASS
    $result = & psql -U $DB_USER -h localhost -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" postgres 2>&1
    if ($result -notmatch "1 row") {
        & psql -U $DB_USER -h localhost -c "CREATE DATABASE $DB_NAME" postgres 2>&1 | Out-Null
        Write-Ok "Base de datos '$DB_NAME' creada"
    } else {
        Write-Ok "Base de datos '$DB_NAME' ya existe"
    }
} catch {
    Write-Warn "No se pudo crear la BD automáticamente."
    Write-Warn "Créala manualmente: createdb -U $DB_USER $DB_NAME"
}

# ─── 4. Crear .env del backend ───────────────────────────────
Write-Info "Generando configuración del backend..."

# Generar JWT secret aleatorio
$bytes     = New-Object byte[] 32
[System.Security.Cryptography.RNGCryptoServiceProvider]::Create().GetBytes($bytes)
$JwtSecret = [System.BitConverter]::ToString($bytes).Replace("-","").ToLower()

$DB_URL = "postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"

$envContent = @"
# SCFI — Configuración Windows Local
# Generado por install-windows.ps1

DATABASE_URL="${DB_URL}"
JWT_SECRET="${JwtSecret}"
JWT_EXPIRES_IN="30d"
PORT=${BACKEND_PORT}
NODE_ENV=production
SCFI_EDITION=${PLAN}
MODO_EMPRESA=mono
FRONTEND_URL=http://${LocalIP}:${FRONTEND_PORT}

# SMTP (opcional)
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
"@

$envContent | Out-File -FilePath "$BackendDir\.env" -Encoding UTF8 -Force
Write-Ok "Archivo .env creado"

# ─── 5. Instalar dependencias del backend ────────────────────
Write-Info "Instalando dependencias del backend..."
Push-Location $BackendDir
    npm install --production --quiet
    Write-Ok "Dependencias instaladas"

    Write-Info "Aplicando schema de base de datos..."
    $env:DATABASE_URL = $DB_URL
    $env:DB_BACKUP_DIR = "$ProjectDir\backups"
    npm run db:migrate:safe
    Remove-Item Env:\DB_BACKUP_DIR -ErrorAction SilentlyContinue
    Write-Ok "Base de datos configurada"
Pop-Location

# ─── 6. Compilar frontend ────────────────────────────────────
Write-Info "Instalando dependencias del frontend..."
Push-Location $FrontendDir
    npm install --quiet
    Write-Ok "Dependencias del frontend instaladas"

    Write-Info "Compilando frontend para producción..."
    $env:VITE_API_URL = "http://${LocalIP}:${BACKEND_PORT}/api"
    npm run build 2>&1 | Out-Null
    Write-Ok "Frontend compilado"
Pop-Location

# ─── 7. Instalar serve (servidor de archivos estáticos) ──────
Write-Info "Instalando servidor de archivos estáticos..."
npm install -g serve --quiet 2>&1 | Out-Null
Write-Ok "serve instalado globalmente"

# ─── 8. Crear servicios de Windows con NSSM ─────────────────
Write-Info "Creando servicio Windows para el BACKEND..."

$nodePath = (Get-Command node).Source

# Eliminar servicio si ya existe
& $nssmPath stop  "SCFI-Backend" 2>&1 | Out-Null
& $nssmPath remove "SCFI-Backend" confirm 2>&1 | Out-Null

& $nssmPath install "SCFI-Backend" $nodePath "server.js"
& $nssmPath set "SCFI-Backend" AppDirectory    $BackendDir
& $nssmPath set "SCFI-Backend" AppEnvironmentExtra `
    "NODE_ENV=production" `
    "DATABASE_URL=$DB_URL" `
    "JWT_SECRET=$JwtSecret" `
    "PORT=$BACKEND_PORT" `
    "SCFI_EDITION=$PLAN"
& $nssmPath set "SCFI-Backend" AppStdout       "$LogDir\backend-out.log"
& $nssmPath set "SCFI-Backend" AppStderr       "$LogDir\backend-err.log"
& $nssmPath set "SCFI-Backend" AppRotateFiles  1
& $nssmPath set "SCFI-Backend" AppRotateBytes  10485760
& $nssmPath set "SCFI-Backend" Start           SERVICE_AUTO_START
& $nssmPath set "SCFI-Backend" DisplayName     "SCFI Backend"
& $nssmPath set "SCFI-Backend" Description     "SCFI Sistema de Facturación - Backend API"

Write-Ok "Servicio SCFI-Backend creado"

Write-Info "Creando servicio Windows para el FRONTEND..."

$servePath = (Get-Command serve -ErrorAction SilentlyContinue)?.Source
if (-not $servePath) {
    $servePath = "$env:APPDATA\npm\serve.cmd"
}

# Eliminar servicio si ya existe
& $nssmPath stop  "SCFI-Frontend" 2>&1 | Out-Null
& $nssmPath remove "SCFI-Frontend" confirm 2>&1 | Out-Null

# serve sirve la carpeta dist del frontend compilado
& $nssmPath install "SCFI-Frontend" $nodePath
& $nssmPath set "SCFI-Frontend" AppParameters   "`"$($env:APPDATA)\npm\node_modules\serve\build\main.js`" `"$FrontendDir\dist`" -l $FRONTEND_PORT -s"
& $nssmPath set "SCFI-Frontend" AppDirectory    $FrontendDir
& $nssmPath set "SCFI-Frontend" AppStdout       "$LogDir\frontend-out.log"
& $nssmPath set "SCFI-Frontend" AppStderr       "$LogDir\frontend-err.log"
& $nssmPath set "SCFI-Frontend" AppRotateFiles  1
& $nssmPath set "SCFI-Frontend" AppRotateBytes  5242880
& $nssmPath set "SCFI-Frontend" Start           SERVICE_AUTO_START
& $nssmPath set "SCFI-Frontend" DisplayName     "SCFI Frontend"
& $nssmPath set "SCFI-Frontend" Description     "SCFI Sistema de Facturación - Frontend Web"

Write-Ok "Servicio SCFI-Frontend creado"

# ─── 9. Iniciar servicios ────────────────────────────────────
Write-Info "Iniciando servicios..."
Start-Sleep -Seconds 2

& $nssmPath start "SCFI-Backend"
Start-Sleep -Seconds 3
& $nssmPath start "SCFI-Frontend"
Start-Sleep -Seconds 2

Write-Ok "Servicios iniciados"

# ─── 10. Reglas de Firewall (acceso desde la red local) ──────
Write-Info "Configurando reglas de Firewall..."

# Eliminar reglas anteriores si existen
Remove-NetFirewallRule -DisplayName "SCFI Backend"  -ErrorAction SilentlyContinue
Remove-NetFirewallRule -DisplayName "SCFI Frontend" -ErrorAction SilentlyContinue

New-NetFirewallRule -DisplayName "SCFI Backend"  -Direction Inbound -Protocol TCP -LocalPort $BACKEND_PORT  -Action Allow | Out-Null
New-NetFirewallRule -DisplayName "SCFI Frontend" -Direction Inbound -Protocol TCP -LocalPort $FRONTEND_PORT -Action Allow | Out-Null

Write-Ok "Firewall configurado (puertos $BACKEND_PORT y $FRONTEND_PORT)"

# ─── 11. Verificar que están corriendo ───────────────────────
Write-Info "Verificando servicios..."
Start-Sleep -Seconds 3

$backendStatus  = (Get-Service "SCFI-Backend"  -ErrorAction SilentlyContinue).Status
$frontendStatus = (Get-Service "SCFI-Frontend" -ErrorAction SilentlyContinue).Status

if ($backendStatus -eq "Running") {
    Write-Ok "SCFI-Backend: Corriendo"
} else {
    Write-Warn "SCFI-Backend: $backendStatus — revisa $LogDir\backend-err.log"
}

if ($frontendStatus -eq "Running") {
    Write-Ok "SCFI-Frontend: Corriendo"
} else {
    Write-Warn "SCFI-Frontend: $frontendStatus — revisa $LogDir\frontend-err.log"
}

# ─── Resumen final ───────────────────────────────────────────
Write-Host ""
Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "  ║   SCFI instalado y configurado               ║" -ForegroundColor Green
Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Acceso local (esta PC):"  -ForegroundColor White
Write-Host "    http://localhost:$FRONTEND_PORT" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Acceso desde otras PCs de la red:" -ForegroundColor White
Write-Host "    http://${LocalIP}:$FRONTEND_PORT" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Plan activo:       $PLAN" -ForegroundColor White
Write-Host "  Base de datos:     $DB_NAME" -ForegroundColor White
Write-Host "  Logs:              $LogDir" -ForegroundColor White
Write-Host ""
Write-Host "  Servicios Windows (arrancan automáticamente al encender el PC):" -ForegroundColor White
Write-Host "    SCFI-Backend   → API en puerto $BACKEND_PORT"  -ForegroundColor Cyan
Write-Host "    SCFI-Frontend  → Web en puerto $FRONTEND_PORT" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Comandos útiles:" -ForegroundColor White
Write-Host "    Get-Service SCFI-Backend, SCFI-Frontend        # ver estado"  -ForegroundColor Gray
Write-Host "    Restart-Service SCFI-Backend                   # reiniciar"   -ForegroundColor Gray
Write-Host "    Get-Content $LogDir\backend-err.log -Tail 50  # ver errores" -ForegroundColor Gray
Write-Host ""
Write-Host "  Próximos pasos:" -ForegroundColor White
Write-Host "    1. Abrir http://localhost:$FRONTEND_PORT en el navegador"
Write-Host "    2. Completar la configuración inicial (empresa + admin)"
Write-Host "    3. Compartir la URL de red con los demás usuarios"
Write-Host ""
