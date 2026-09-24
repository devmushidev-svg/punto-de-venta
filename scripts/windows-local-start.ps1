$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiEnv = Join-Path $root "apps\api\.env"
$apiEnvExample = Join-Path $root "apps\api\.env.example"
$childRunner = Join-Path $root "scripts\windows-local-run.ps1"
$localDatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable&pgbouncer=true&connection_limit=1"

function Set-DotEnvValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $line = "$Key=""$Value"""
  if (!(Test-Path $Path)) {
    Set-Content -Path $Path -Value $line
    return
  }

  $content = Get-Content -Path $Path -Raw
  if ($content -match "(?m)^#?\s*$([regex]::Escape($Key))=") {
    $content = [regex]::Replace($content, "(?m)^#?\s*$([regex]::Escape($Key))=.*$", $line)
    Set-Content -Path $Path -Value $content.TrimEnd()
  } else {
    Add-Content -Path $Path -Value ""
    Add-Content -Path $Path -Value $line
  }
}

Set-Location $root

if (!(Test-Path $apiEnv)) {
  Copy-Item -Path $apiEnvExample -Destination $apiEnv
  Write-Host "Creado apps\api\.env para desarrollo local." -ForegroundColor Yellow
}

Set-DotEnvValue -Path $apiEnv -Key "DATABASE_URL" -Value $localDatabaseUrl
Set-DotEnvValue -Path $apiEnv -Key "AUTO_SEED_DEMO_ON_EMPTY" -Value "true"

Write-Host "Instalando dependencias si hacen falta..." -ForegroundColor Cyan
npm install

Write-Host "Iniciando PostgreSQL portatil local en 127.0.0.1:55432..." -ForegroundColor Cyan
npx pglite-server --db=.pglite-dev --port=55432 --host=127.0.0.1 --max-connections=10 --run "powershell -ExecutionPolicy Bypass -File `"$childRunner`""
