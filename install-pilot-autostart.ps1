param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$Port = Resolve-PilotPort $Port
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hiddenLauncher = Join-Path $PSScriptRoot 'run-powershell-hidden.vbs'
$watchdog = Join-Path $PSScriptRoot 'startup-watchdog.ps1'
$watchdogCommand = "wscript.exe `"$hiddenLauncher`" `"$watchdog`" -Port $Port"
Set-ItemProperty -Path $runKey -Name 'Clash Node Pilot Startup' -Value $watchdogCommand
foreach ($name in @('Clash Node Pilot', 'Clash Node Pilot Optimizer')) {
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
}
Unregister-ScheduledTask -TaskName 'Clash Node Pilot Optimizer' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Node Pilot startup enabled on port $Port. Automatic optimization is managed by the Node service."
