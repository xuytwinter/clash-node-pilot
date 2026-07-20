$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hiddenLauncher = Join-Path $root 'run-powershell-hidden.vbs'
$watchdog = Join-Path $root 'startup-watchdog.ps1'
$watchdogCommand = "wscript.exe `"$hiddenLauncher`" `"$watchdog`""
Set-ItemProperty -Path $runKey -Name 'Clash Node Pilot Startup' -Value $watchdogCommand
$loop = Join-Path $root 'auto-loop.ps1'
$loopCommand = "wscript.exe `"$hiddenLauncher`" `"$loop`""
Set-ItemProperty -Path $runKey -Name 'Clash Node Pilot Optimizer' -Value $loopCommand
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot' -ErrorAction SilentlyContinue
Write-Host 'Clash startup recovery and Node Pilot optimizer enabled.'
