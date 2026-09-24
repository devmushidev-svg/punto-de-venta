$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/postgres?sslmode=disable&pgbouncer=true&connection_limit=1"
$env:AUTO_SEED_DEMO_ON_EMPTY = "true"

Set-Location $root

Write-Host "Preparando esquema de base local..." -ForegroundColor Cyan
npm run db:push -w apps/api

Write-Host "Cargando demo local si hace falta..." -ForegroundColor Cyan
npm run db:seed -w apps/api

Write-Host "Iniciando Punto Flow local. API: http://localhost:3001 | App: http://localhost:5173" -ForegroundColor Green
npm run dev
