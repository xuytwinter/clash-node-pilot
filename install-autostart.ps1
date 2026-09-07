param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'install-pilot-autostart.ps1') -Port $Port
