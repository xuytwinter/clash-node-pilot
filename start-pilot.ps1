param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'windows-common.ps1')
  $env:PORT = Resolve-PilotPort $Port
  $messages = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'startup-watchdog.ps1') -Port $env:PORT 2>&1
  if ($LASTEXITCODE -ne 0) { throw (($messages | Out-String).Trim()) }
  if ($env:CLASH_PILOT_NO_BROWSER -ne '1') { Start-Process "http://127.0.0.1:$env:PORT" }
} catch {
  $message = $_.Exception.Message
  $logDirectory = if ($env:CLASH_PILOT_STATE) { Split-Path -Parent ([IO.Path]::GetFullPath($env:CLASH_PILOT_STATE)) } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ClashNodePilot' }
  try {
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $log = Join-Path $logDirectory 'launcher.log'
    "$(Get-Date -Format o) $message" | Set-Content -LiteralPath $log -Encoding UTF8
    $message += "`n`nDetails: $log"
  } catch {}
  if ($env:CLASH_PILOT_NO_BROWSER -ne '1') {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($message, 'Clash Node Pilot could not start', 'OK', 'Error') | Out-Null
  }
  [Console]::Error.WriteLine($message)
  exit 1
}
