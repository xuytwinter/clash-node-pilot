$ErrorActionPreference = 'SilentlyContinue'
$url = 'http://127.0.0.1:3210/api/auto-optimize'
try {
  $response = Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 75
  $log = Join-Path $PSScriptRoot 'auto-optimize.log'
  "$(Get-Date -Format s) $($response | ConvertTo-Json -Compress)" | Add-Content -LiteralPath $log -Encoding UTF8
} catch {
  $log = Join-Path $PSScriptRoot 'auto-optimize.log'
  "$(Get-Date -Format s) skipped: $($_.Exception.Message)" | Add-Content -LiteralPath $log -Encoding UTF8
}
