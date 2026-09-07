param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$env:PORT = Resolve-PilotPort $Port
$root = $PSScriptRoot
$serverPath = Join-Path $root 'server.js'
$bundledNode = Join-Path $root 'runtime\node.exe'

function Test-NodePilot {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$env:PORT/api/health" -TimeoutSec 4
    return ($health.ok -eq $true -and [int]$health.port -eq [int]$env:PORT)
  } catch { return $false }
}

# Controller availability is separate from the local service's health.
if (Test-NodePilot) { exit 0 }
$nodeExe = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $serverPath)) { throw 'server.js not found.' }
Start-Process -FilePath $nodeExe -ArgumentList "`"$serverPath`"" -WorkingDirectory $root -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(15)
do {
  if (Test-NodePilot) { exit 0 }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
throw 'Node Pilot did not become healthy. Check its logs and whether PORT is already occupied.'
