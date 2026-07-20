$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hiddenLauncher = Join-Path $root 'run-powershell-hidden.vbs'
$watchdog = Join-Path $root 'startup-watchdog.ps1'
$optimizer = Join-Path $root 'auto-optimize.ps1'
$clash = 'C:\Program Files\Clash Verge\clash-verge.exe'
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

@('Clash Verge', 'Clash Node Pilot', 'Clash Node Pilot Startup', 'Clash Node Pilot Watchdog', 'Clash Node Pilot Optimizer') | ForEach-Object {
  Unregister-ScheduledTask -TaskName $_ -Confirm:$false -ErrorAction SilentlyContinue
}

$startupAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$hiddenLauncher`" `"$watchdog`""
$startupTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'Clash Node Pilot Startup' -Action $startupAction -Trigger $startupTrigger -Settings $taskSettings -Description 'Wait for network, recover Mihomo, and start Clash Node Pilot' -Force | Out-Null

& schtasks.exe /Create /TN 'Clash Node Pilot Watchdog' /SC MINUTE /MO 2 /TR "wscript.exe `"$hiddenLauncher`" `"$watchdog`"" /F | Out-Null
& schtasks.exe /Create /TN 'Clash Node Pilot Optimizer' /SC MINUTE /MO 3 /TR "wscript.exe `"$hiddenLauncher`" `"$optimizer`"" /F | Out-Null
Set-ScheduledTask -TaskName 'Clash Node Pilot Watchdog' -Settings $taskSettings | Out-Null
Set-ScheduledTask -TaskName 'Clash Node Pilot Optimizer' -Settings $taskSettings | Out-Null

if (Test-Path $clash) {
  Set-ItemProperty -Path $runKey -Name 'Clash Verge' -Value "`"$clash`""
}
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot Optimizer' -ErrorAction SilentlyContinue
Write-Host 'Installed startup recovery, two-minute watchdog, and three-minute optimizer tasks.'
