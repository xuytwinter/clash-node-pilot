param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$env:PORT = Resolve-PilotPort $Port
$root = $PSScriptRoot
$serverPath = Join-Path $root 'server.js'
$bundledNode = Join-Path $root 'runtime\node.exe'
$nodeExe = if (Test-Path -LiteralPath $bundledNode) { $bundledNode } else { (Get-Command node.exe -ErrorAction Stop).Source }

function Test-NodePilotHealth {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$env:PORT/api/health" -TimeoutSec 4
    return ($health.ok -eq $true -and [int]$health.port -eq [int]$env:PORT)
  } catch { return $false }
}

function Test-NodePilot {
  return ((Test-NodePilotHealth) -and (@(Get-PilotServerProcesses $nodeExe $serverPath ([int]$env:PORT)).Count -gt 0))
}

# Controller availability is separate from the local service's health.
if (Test-NodePilotHealth) {
  if (Test-NodePilot) { exit 0 }
  throw "Port $env:PORT is already serving a different local service. Stop it or choose another port."
}
if (-not (Test-Path -LiteralPath $serverPath)) { throw 'server.js not found.' }
Start-Process -FilePath $nodeExe -ArgumentList "`"$serverPath`"" -WorkingDirectory $root -WindowStyle Hidden
$deadline = (Get-Date).AddSeconds(15)
do {
  if (Test-NodePilot) { exit 0 }
  if (Test-NodePilotHealth) {
    throw "Port $env:PORT became healthy under a different local service. Stop it or choose another port."
  }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)
throw 'Node Pilot did not become healthy. Check its logs and whether PORT is already occupied.'
