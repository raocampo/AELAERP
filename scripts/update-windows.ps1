# ============================================================
#  SCFI — Script de actualización Windows
#
#  Uso (ejecutar como Administrador):
#    PowerShell -ExecutionPolicy Bypass -File update-windows.ps1
#
#  Qué hace:
#    1. Backup de la base de datos
#    2. Copia nuevos archivos (sin tocar .env ni uploads)
#    3. Actualiza dependencias npm
#    4. Aplica cambios de BD (prisma db push)
#    5. Recompila el frontend
#    6. Reinicia los servicios Windows
# ============================================================

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "  --> $msg" -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host "  [!] $msg"  -ForegroundColor Yellow }

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptDir
$InstallDir  = "C:\SCFI"
$BackendDir  = "$InstallDir\backend"
$FrontendDir = "$InstallDir\frontend"
$BackupDir   = "$InstallDir\backups"
$LogDir      = "$InstallDir\logs"

# Si el install se hizo en el mismo directorio del proyecto
if (-not (Test-Path "$InstallDir\backend")) {
    $BackendDir  = "$ProjectDir\backend"
    $FrontendDir = "$ProjectDir\frontend"
}

Write-Host ""
Write-Host "  SCFI — Actualizacion Windows" -ForegroundColor Blue
Write-Host ""

# ─── 1. Leer configuración actual ───────────────────────────
$envFile = "$BackendDir\.env"
if (-not (Test-Path $envFile)) {
    Write-Host "  No se encontró .env en $BackendDir" -ForegroundColor Red
    exit 1
}

$envVars = @{}
Get-Content $envFile | Where-Object { $_ -match "^[A-Z_]+=.+" } | ForEach-Object {
    $parts = $_ -split "=", 2
    $envVars[$parts[0]] = $parts[1].Trim('"')
}

$DB_URL  = $envVars["DATABASE_URL"]
$DB_NAME = ($DB_URL -split "/")[-1]

Write-Ok "Configuración leída de .env"

# ─── 2. Backup de la BD ─────────────────────────────────────
Write-Info "Haciendo backup de la base de datos..."
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir\scfi_$timestamp.sql"

try {
    $env:PGPASSWORD = ($DB_URL -split ":")[2] -split "@" | Select-Object -First 1
    & pg_dump -U postgres $DB_NAME -f $backupFile 2>&1 | Out-Null
    Write-Ok "Backup guardado: $backupFile"
} catch {
    Write-Warn "No se pudo hacer backup automático. Hazlo manualmente."
}

# ─── 3. Detener servicios ────────────────────────────────────
Write-Info "Deteniendo servicios SCFI..."
Stop-Service "SCFI-Frontend" -ErrorAction SilentlyContinue -Force
Stop-Service "SCFI-Backend"  -ErrorAction SilentlyContinue -Force
Start-Sleep -Seconds 2
Write-Ok "Servicios detenidos"

# ─── 4. Copiar nuevos archivos ───────────────────────────────
Write-Info "Copiando nuevos archivos..."

if ($ProjectDir -ne $InstallDir) {
    # Backend — preservar .env y uploads
    robocopy "$ProjectDir\backend" $BackendDir /E `
        /XD node_modules .git uploads `
        /XF ".env" "*.log" `
        /NFL /NDL /NJH /NJS | Out-Null

    # Frontend — preservar dist hasta recompilar
    robocopy "$ProjectDir\frontend" $FrontendDir /E `
        /XD node_modules .git dist `
        /NFL /NDL /NJH /NJS | Out-Null

    Write-Ok "Archivos copiados"
} else {
    Write-Ok "Proyecto en el mismo directorio, no se requiere copia"
}

# ─── 5. Actualizar dependencias backend ─────────────────────
Write-Info "Actualizando dependencias del backend..."
Push-Location $BackendDir
    $env:DATABASE_URL = $DB_URL
    npm install --production --quiet
    Write-Ok "Dependencias backend actualizadas"

    Write-Info "Aplicando cambios de base de datos..."
    npx prisma db push --accept-data-loss 2>&1 | Out-Null
    npx prisma generate 2>&1 | Out-Null
    Write-Ok "Base de datos actualizada"
Pop-Location

# ─── 6. Recompilar frontend ──────────────────────────────────
Write-Info "Actualizando dependencias del frontend..."
Push-Location $FrontendDir
    npm install --quiet

    Write-Info "Compilando frontend..."
    $LocalIP = ($envVars["FRONTEND_URL"] -replace "http://","" -replace ":.*","")
    $BackendPort = $envVars["PORT"]
    $env:VITE_API_URL = "http://${LocalIP}:${BackendPort}/api"
    npm run build 2>&1 | Out-Null
    Write-Ok "Frontend recompilado"
Pop-Location

# ─── 7. Reiniciar servicios ──────────────────────────────────
Write-Info "Reiniciando servicios SCFI..."
Start-Service "SCFI-Backend"
Start-Sleep -Seconds 3
Start-Service "SCFI-Frontend"
Start-Sleep -Seconds 2

$backendStatus  = (Get-Service "SCFI-Backend").Status
$frontendStatus = (Get-Service "SCFI-Frontend").Status

Write-Ok "SCFI-Backend: $backendStatus"
Write-Ok "SCFI-Frontend: $frontendStatus"

# ─── Limpieza de backups antiguos (mantener últimos 10) ──────
Get-ChildItem $BackupDir -Filter "*.sql" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip 10 |
    Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Actualizacion completada" -ForegroundColor Green
Write-Host "  Backup guardado: $backupFile" -ForegroundColor Gray
Write-Host ""
