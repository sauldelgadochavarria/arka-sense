#Requires -Version 5.1
<#
.SYNOPSIS
  Repara montajes rotos de Docker Desktop en Windows (ENODEV / mkdir ... file exists).

.DESCRIPTION
  Error típico al levantar compose con bind mounts desde D: u otra unidad:
    error while creating mount source path '/run/desktop/mnt/host/d/...': mkdir /run/desktop/mnt/host/d: file exists

  Causa: estado corrupto de los mount points internos de Docker Desktop tras reinicios de Windows/WSL.

.EXAMPLE
  .\scripts\fix-docker-mounts.ps1
  .\scripts\fix-docker-mounts.ps1 -Up
#>
param(
  [switch]$Up,
  [string]$ComposeFile = "docker-compose.dev.yml"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "1/3 Cerrando WSL (resetea mount points de Docker Desktop)..." -ForegroundColor Cyan
wsl --shutdown
Start-Sleep -Seconds 3

Write-Host "2/3 Verificando daemon Docker..." -ForegroundColor Cyan
$retries = 0
while ($retries -lt 12) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { break }
  $retries++
  Write-Host "   Esperando Docker Desktop ($retries/12)..."
  Start-Sleep -Seconds 5
}
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker no responde. Abre Docker Desktop manualmente y vuelve a ejecutar este script." -ForegroundColor Red
  exit 1
}

Write-Host "3/3 Probando montaje en base-saas..." -ForegroundColor Cyan
docker compose -f $ComposeFile up -d
if ($LASTEXITCODE -ne 0) {
  Write-Host "Compose falló. Prueba reiniciar Docker Desktop desde el icono de la bandeja." -ForegroundColor Red
  exit 1
}

$test = docker compose -f $ComposeFile exec -T base-saas test -f /app/package.json 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Contenedor arriba pero /app/package.json no accesible (mount aún roto)." -ForegroundColor Red
  Write-Host "Alternativa: ejecuta scripts npm desde services/base-saas (Mongo en localhost:27020)." -ForegroundColor Yellow
  exit 1
}

Write-Host "OK — montajes restaurados." -ForegroundColor Green
docker compose -f $ComposeFile ps

if ($Up) {
  Write-Host "Servicios levantados." -ForegroundColor Green
}
