$ErrorActionPreference = 'SilentlyContinue'
$dataDir = Join-Path $env:LOCALAPPDATA 'ClashNodePilot'
if (-not $env:LOCALAPPDATA) { $dataDir = Join-Path $env:USERPROFILE 'AppData\Local\ClashNodePilot' }
$log = Join-Path $dataDir 'auto-optimize.log'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$url = 'http://127.0.0.1:3210/api/auto-optimize'
try {
  $response = Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 75
  "$(Get-Date -Format s) $($response | ConvertTo-Json -Compress)" | Add-Content -LiteralPath $log -Encoding UTF8
} catch {
  "$(Get-Date -Format s) skipped: $($_.Exception.Message)" | Add-Content -LiteralPath $log -Encoding UTF8
}
