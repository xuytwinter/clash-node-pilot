$ErrorActionPreference = 'SilentlyContinue'
$scriptRoot = $PSScriptRoot
$log = Join-Path $scriptRoot 'auto-optimize.log'
while ($true) {
  & (Join-Path $scriptRoot 'auto-optimize.ps1')
  Start-Sleep -Seconds 180
}
