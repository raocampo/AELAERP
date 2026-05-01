# ============================================================
#  SCFI — Backup rápido de base de datos (desarrollo)
#
#  Uso desde la raíz del proyecto:
#    .\scripts\backup-dev.ps1
#
#  Qué hace:
#    1. Lee DATABASE_URL del .env del backend
#    2. Ejecuta pg_dump
#    3. Guarda el .sql en backups/ con timestamp
#    4. Mantiene los últimos 20 backups
#
#  EJECUTAR ANTES DE TODA MIGRACIÓN PRISMA
# ============================================================

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = "$ProjectDir\backend"
$BackupDir  = "$ProjectDir\backups"
$envFile    = "$BackendDir\.env"

function Write-Ok   { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "  --> $msg"  -ForegroundColor Cyan }
function Write-Err  { param($msg) Write-Host "  [ERROR] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  SCFI — Backup de base de datos" -ForegroundColor Blue
Write-Host ""

# ─── Leer .env ───────────────────────────────────────────────
if (-not (Test-Path $envFile)) {
    Write-Err "No se encontró .env en $BackendDir"
    exit 1
}

$DB_URL = ""
Get-Content $envFile | Where-Object { $_ -match "^DATABASE_URL\s*=" } | ForEach-Object {
    $DB_URL = ($_ -split "=", 2)[1].Trim().Trim('"').Trim("'")
}

if (-not $DB_URL) {
    Write-Err "DATABASE_URL no encontrada en .env"
    exit 1
}

# Parsear: postgresql://user:password@host:port/dbname
# El password puede contener @ — se parsea desde los extremos
if ($DB_URL -match "^postgresql://([^:]+):(.+)@([^:/]+):?(\d+)?/(.+)$") {
    $DB_USER = $Matches[1]
    $DB_PASS = $Matches[2]
    $DB_HOST = $Matches[3]
    $DB_PORT = if ($Matches[4]) { $Matches[4] } else { "5432" }
    $DB_NAME = $Matches[5] -split "\?" | Select-Object -First 1
} else {
    Write-Err "No se pudo parsear DATABASE_URL. Formato esperado: postgresql://user:pass@host:port/dbname"
    exit 1
}

Write-Info "Base de datos: $DB_NAME en $DB_HOST`:$DB_PORT (usuario: $DB_USER)"

# ─── Crear carpeta de backups ─────────────────────────────────
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

# ─── Ejecutar pg_dump ────────────────────────────────────────
$timestamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backupFile = "$BackupDir\scfi_dev_$timestamp.sql"

Write-Info "Generando backup..."

$env:PGPASSWORD = $DB_PASS

try {
    $result = & pg_dump `
        -h $DB_HOST `
        -p $DB_PORT `
        -U $DB_USER `
        -d $DB_NAME `
        -f $backupFile `
        --verbose 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump salió con código $LASTEXITCODE"
    }

    $size = [math]::Round((Get-Item $backupFile).Length / 1KB, 1)
    Write-Ok "Backup guardado: $backupFile ($size KB)"
} catch {
    Write-Err "Error al ejecutar pg_dump: $_"
    Write-Host ""
    Write-Host "  Asegúrate de que pg_dump esté en el PATH." -ForegroundColor Yellow
    Write-Host "  (Normalmente en C:\Program Files\PostgreSQL\<version>\bin)" -ForegroundColor Yellow
    exit 1
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

# ─── Limpiar backups antiguos (mantener últimos 20) ──────────
$old = Get-ChildItem $BackupDir -Filter "scfi_dev_*.sql" |
       Sort-Object LastWriteTime -Descending |
       Select-Object -Skip 20
if ($old) {
    $old | Remove-Item -Force
    Write-Info "Backups antiguos eliminados: $($old.Count)"
}

Write-Host ""
Write-Host "  Backup completado exitosamente." -ForegroundColor Green
Write-Host "  Archivo: $backupFile" -ForegroundColor Gray
Write-Host ""
