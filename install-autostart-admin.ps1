$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hiddenLauncher = Join-Path $root 'run-powershell-hidden.vbs'
$watchdog = Join-Path $root 'startup-watchdog.ps1'
$optimizer = Join-Path $root 'auto-optimize.ps1'

@('Clash Verge', 'Clash Node Pilot', 'Clash Node Pilot Startup', 'Clash Node Pilot Watchdog', 'Clash Node Pilot Optimizer') | ForEach-Object {
  Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue
}

$startupAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$hiddenLauncher`" `"$watchdog`""
$startupTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'Clash Node Pilot Startup' -Action $startupAction -Trigger $startupTrigger -Description 'Wait for network, recover Mihomo, and start Clash Node Pilot' -Force | Out-Null

& schtasks.exe /Create /TN 'Clash Node Pilot Watchdog' /SC MINUTE /MO 2 /TR "wscript.exe `"$hiddenLauncher`" `"$watchdog`"" /F | Out-Null
& schtasks.exe /Create /TN 'Clash Node Pilot Optimizer' /SC MINUTE /MO 3 /TR "wscript.exe `"$hiddenLauncher`" `"$optimizer`"" /F | Out-Null

Remove-ItemProperty -Path $runKey -Name 'Clash Verge' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot Optimizer' -ErrorAction SilentlyContinue
Write-Host 'Installed startup recovery, two-minute watchdog, and three-minute optimizer tasks.'
