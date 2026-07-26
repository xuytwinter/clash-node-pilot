$ErrorActionPreference = 'SilentlyContinue'
$scriptRoot = $PSScriptRoot
while ($true) {
  & (Join-Path $scriptRoot 'auto-optimize.ps1')
  Start-Sleep -Seconds 180
}
