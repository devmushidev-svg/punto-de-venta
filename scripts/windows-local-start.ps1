$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$apiEnv = Join-Path $root "apps\api\.env"
$apiEnvExample = Join-Path $root "apps\api\.env.example"

Set-Location $root

if (!(Test-Path $apiEnv)) {
  Copy-Item -Path $apiEnvExample -Destination $apiEnv
  Write-Host "Creado apps\api\.env con SQLite local. Configura Supabase despues desde la app si usaras nube." -ForegroundColor Yellow
}

Write-Host "Instalando dependencias si hacen falta..." -ForegroundColor Cyan
npm install

Write-Host "Preparando SQLite local..." -ForegroundColor Cyan
npm run db:push
npm run db:seed

Write-Host "Iniciando Punto Flow local. API: http://localhost:3001 | App: http://localhost:5173" -ForegroundColor Green
npm run dev
