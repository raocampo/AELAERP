# ============================================================
# renombrarBDs.ps1 — Renombrar bases de datos locales
# scfi_dev → aela_dev  |  scfi_master → aela_master
#
# REQUISITOS:
#   - PostgreSQL instalado localmente
#   - psql en el PATH (o ajusta la variable $PSQL abajo)
#   - No haber conexiones activas a las BDs a renombrar
#
# EJECUCIÓN:
#   .\scripts\renombrarBDs.ps1
# ============================================================

param(
  [string]$PgUser     = "postgres",
  [string]$PgHost     = "localhost",
  [string]$PgPort     = "5432",
  [string]$PgPassword = ""          # Deja vacío si usas .pgpass o trust auth
)

$PSQL = "psql"

if ($PgPassword) {
  $env:PGPASSWORD = $PgPassword
}

function Invoke-Psql($query) {
  & $PSQL -h $PgHost -p $PgPort -U $PgUser -c $query postgres
  if ($LASTEXITCODE -ne 0) { throw "Error ejecutando: $query" }
}

Write-Host "=== Renombrar BDs AELA ERP ===" -ForegroundColor Cyan
Write-Host "Host: ${PgHost}:${PgPort} | Usuario: $PgUser"
Write-Host ""

# Verificar qué BDs existen
Write-Host "BDs encontradas:" -ForegroundColor Yellow
& $PSQL -h $PgHost -p $PgPort -U $PgUser -c "\l" postgres 2>&1 | Select-String "(scfi|aela)"
Write-Host ""

# ─── scfi_dev → aela_dev ────────────────────────────────────
Write-Host "1) Renombrando scfi_dev → aela_dev ..." -ForegroundColor Green
try {
  # Forzar desconexión de usuarios activos
  Invoke-Psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'scfi_dev' AND pid <> pg_backend_pid();"
  Invoke-Psql "ALTER DATABASE scfi_dev RENAME TO aela_dev;"
  Write-Host "   ✅ scfi_dev renombrada a aela_dev" -ForegroundColor Green
} catch {
  Write-Host "   ⚠️  No se pudo renombrar scfi_dev: $_" -ForegroundColor Yellow
  Write-Host "   (Puede que ya se llame aela_dev o no exista)" -ForegroundColor Gray
}

# ─── scfi_master → aela_master ─────────────────────────────
Write-Host "2) Renombrando scfi_master → aela_master ..." -ForegroundColor Green
try {
  Invoke-Psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'scfi_master' AND pid <> pg_backend_pid();"
  Invoke-Psql "ALTER DATABASE scfi_master RENAME TO aela_master;"
  Write-Host "   ✅ scfi_master renombrada a aela_master" -ForegroundColor Green
} catch {
  Write-Host "   ⚠️  No se pudo renombrar scfi_master: $_" -ForegroundColor Yellow
  Write-Host "   (Puede que ya se llame aela_master o no exista)" -ForegroundColor Gray
}

# ─── Verificar resultado ────────────────────────────────────
Write-Host ""
Write-Host "BDs después del rename:" -ForegroundColor Yellow
& $PSQL -h $PgHost -p $PgPort -U $PgUser -c "\l" postgres 2>&1 | Select-String "(scfi|aela)"

Write-Host ""
Write-Host "=== Listo. Actualiza tu .env: ===" -ForegroundColor Cyan
Write-Host "  DATABASE_URL=postgresql://${PgUser}:PASSWORD@${PgHost}:${PgPort}/aela_dev" -ForegroundColor White
Write-Host "  (o aela_master si usas el esquema maestro)" -ForegroundColor Gray
Write-Host ""
