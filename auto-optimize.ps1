param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$Port = Resolve-PilotPort $Port
$dataDir = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'ClashNodePilot' } else { Join-Path $env:USERPROFILE 'AppData\Local\ClashNodePilot' }
$log = Join-Path $dataDir 'auto-optimize.log'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$url = "http://127.0.0.1:$Port/api/auto-optimize"
try {
  $session = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/session" -TimeoutSec 5
  $response = Invoke-RestMethod -Uri $url -Method Post -Headers @{ 'x-pilot-session' = $session.token } -ContentType 'application/json' -Body '{}' -TimeoutSec 75
  "$(Get-Date -Format s) $($response | ConvertTo-Json -Compress)" | Add-Content -LiteralPath $log -Encoding UTF8
} catch {
  "$(Get-Date -Format s) skipped: $($_.Exception.Message)" | Add-Content -LiteralPath $log -Encoding UTF8
}
