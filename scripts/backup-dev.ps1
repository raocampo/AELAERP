# ============================================================
#  AELA — Backup rápido de base de datos (desarrollo)
#
#  Uso desde la raíz del proyecto:
#    .\scripts\backup-dev.ps1
# ============================================================

$ErrorActionPreference = "Stop"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$BackendDir = "$ProjectDir\backend"
$BackupDir  = "$ProjectDir\backups"

Write-Host ""
Write-Host "  AELA — Backup de base de datos" -ForegroundColor Blue
Write-Host ""

Push-Location $BackendDir
try {
    $env:DB_BACKUP_DIR = $BackupDir
    npm run db:backup
} finally {
    Remove-Item Env:\DB_BACKUP_DIR -ErrorAction SilentlyContinue
    Pop-Location
}
