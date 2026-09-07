param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$env:PORT = Resolve-PilotPort $Port
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'startup-watchdog.ps1') -Port $env:PORT
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($env:CLASH_PILOT_NO_BROWSER -ne '1') { Start-Process "http://127.0.0.1:$env:PORT" }
