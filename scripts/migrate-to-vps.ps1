# migrate-to-vps.ps1
# Migra la base de datos salamandra completa al VPS
# Incluye schema master + todos los schemas crm_*
#
# Uso: .\scripts\migrate-to-vps.ps1
# Requisitos: pg_dump en PATH (viene con PostgreSQL), ssh, scp

# ─── CONFIGURA ESTOS VALORES ──────────────────────────────────────────────────

# Base de datos LOCAL
$LOCAL_DB_HOST     = "localhost"
$LOCAL_DB_PORT     = "5432"
$LOCAL_DB_NAME     = "salamandra"
$LOCAL_DB_USER     = "postgres"
# Deja vacío si usas pg_password / .pgpass / trust en pg_hba.conf
$LOCAL_DB_PASS     = ""

# VPS — conexión SSH
$VPS_SSH_USER      = "ubuntu"           # usuario SSH del VPS
$VPS_SSH_HOST      = "0.0.0.0"          # IP o dominio del VPS (CAMBIAR)
$VPS_SSH_PORT      = "22"
$VPS_SSH_KEY       = ""                 # ruta a clave privada, p.ej: "C:\Users\tu\.ssh\id_rsa"

# Base de datos en el VPS
$VPS_DB_HOST       = "localhost"
$VPS_DB_PORT       = "5432"
$VPS_DB_NAME       = "salamandra"
$VPS_DB_USER       = "postgres"
$VPS_DB_PASS       = ""

# Archivo de volcado temporal
$DUMP_FILE         = "$env:TEMP\salamandra_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
$REMOTE_TMP        = "/tmp/salamandra_restore.dump"

# ──────────────────────────────────────────────────────────────────────────────

function Write-Step { param([string]$msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Fail { param([string]$msg) Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host "`n════════════════════════════════════════" -ForegroundColor Yellow
Write-Host " Salamandra CRM — Migración a VPS       " -ForegroundColor Yellow
Write-Host "════════════════════════════════════════`n" -ForegroundColor Yellow

# ─── Validaciones previas ─────────────────────────────────────────────────────

Write-Step "Comprobando herramientas necesarias..."

if (-not (Get-Command "pg_dump" -ErrorAction SilentlyContinue)) {
    Write-Fail "pg_dump no encontrado. Asegúrate de que PostgreSQL está en el PATH."
}
Write-Ok "pg_dump encontrado"

if (-not (Get-Command "scp" -ErrorAction SilentlyContinue)) {
    Write-Fail "scp no encontrado. Instala OpenSSH: Add-WindowsCapability -Online -Name OpenSSH.Client*"
}
Write-Ok "scp encontrado"

if ($VPS_SSH_HOST -eq "0.0.0.0") {
    Write-Fail "Configura VPS_SSH_HOST con la IP real de tu VPS antes de ejecutar."
}

# ─── Paso 1: Volcado local ────────────────────────────────────────────────────

Write-Step "Volcando base de datos local '$LOCAL_DB_NAME'..."

if ($LOCAL_DB_PASS -ne "") {
    $env:PGPASSWORD = $LOCAL_DB_PASS
}

$pgDumpArgs = @(
    "-h", $LOCAL_DB_HOST,
    "-p", $LOCAL_DB_PORT,
    "-U", $LOCAL_DB_USER,
    "-d", $LOCAL_DB_NAME,
    "-F", "c",           # formato custom (comprimido, más rápido en restore)
    "--no-owner",        # no restaurar propietarios (por si el user del VPS es distinto)
    "--no-acl",          # no restaurar permisos
    "-f", $DUMP_FILE
)

& pg_dump @pgDumpArgs
if ($LASTEXITCODE -ne 0) { Write-Fail "pg_dump falló con código $LASTEXITCODE" }

$dumpSizeMB = [math]::Round((Get-Item $DUMP_FILE).Length / 1MB, 2)
Write-Ok "Volcado creado: $DUMP_FILE ($dumpSizeMB MB)"

$env:PGPASSWORD = ""

# ─── Paso 2: Transferir al VPS ───────────────────────────────────────────────

Write-Step "Transfiriendo volcado al VPS ($VPS_SSH_HOST)..."

$scpArgs = @("-P", $VPS_SSH_PORT)
if ($VPS_SSH_KEY -ne "") { $scpArgs += @("-i", $VPS_SSH_KEY) }
$scpArgs += @($DUMP_FILE, "${VPS_SSH_USER}@${VPS_SSH_HOST}:${REMOTE_TMP}")

& scp @scpArgs
if ($LASTEXITCODE -ne 0) { Write-Fail "scp falló con código $LASTEXITCODE" }
Write-Ok "Volcado transferido a $REMOTE_TMP"

# ─── Paso 3: Restaurar en el VPS ─────────────────────────────────────────────

Write-Step "Restaurando en el VPS..."

$sshArgs = @("-p", $VPS_SSH_PORT)
if ($VPS_SSH_KEY -ne "") { $sshArgs += @("-i", $VPS_SSH_KEY) }
$sshArgs += "${VPS_SSH_USER}@${VPS_SSH_HOST}"

# Comando remoto:
# 1. Crea la BD si no existe
# 2. Restaura con pg_restore
$remoteCmd = @"
set -e
echo '  → Verificando base de datos...'
PGPASSWORD='$VPS_DB_PASS' psql -h $VPS_DB_HOST -p $VPS_DB_PORT -U $VPS_DB_USER -tc "SELECT 1 FROM pg_database WHERE datname='$VPS_DB_NAME'" | grep -q 1 || \
  PGPASSWORD='$VPS_DB_PASS' psql -h $VPS_DB_HOST -p $VPS_DB_PORT -U $VPS_DB_USER -c "CREATE DATABASE $VPS_DB_NAME"
echo '  → Restaurando...'
PGPASSWORD='$VPS_DB_PASS' pg_restore \
  -h $VPS_DB_HOST \
  -p $VPS_DB_PORT \
  -U $VPS_DB_USER \
  -d $VPS_DB_NAME \
  --no-owner \
  --no-acl \
  -F c \
  --clean \
  --if-exists \
  $REMOTE_TMP
echo '  → Limpiando archivo temporal...'
rm -f $REMOTE_TMP
echo 'done'
"@

& ssh @sshArgs $remoteCmd
if ($LASTEXITCODE -ne 0) { Write-Fail "La restauración en el VPS falló con código $LASTEXITCODE" }
Write-Ok "Base de datos restaurada en el VPS"

# ─── Limpieza local ───────────────────────────────────────────────────────────

Write-Step "Limpiando archivos temporales locales..."
Remove-Item $DUMP_FILE -Force
Write-Ok "Volcado local eliminado"

# ─── Fin ──────────────────────────────────────────────────────────────────────

Write-Host "`n════════════════════════════════════════" -ForegroundColor Green
Write-Host " Migración completada                   " -ForegroundColor Green
Write-Host "════════════════════════════════════════`n" -ForegroundColor Green
Write-Host "  BD migrada: $LOCAL_DB_NAME → ${VPS_SSH_HOST}/$VPS_DB_NAME" -ForegroundColor White
Write-Host "  Schemas migrados: master + todos los crm_*`n" -ForegroundColor White
