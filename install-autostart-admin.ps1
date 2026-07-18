$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$clash = 'C:\Program Files\Clash Verge\clash-verge.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path $clash) {
  Register-ScheduledTask -TaskName 'Clash Verge' -Action (New-ScheduledTaskAction -Execute $clash -WorkingDirectory (Split-Path $clash)) -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Description 'Start Clash Verge at Windows logon' -Force | Out-Null
}
$pilotAction = New-ScheduledTaskAction -Execute $node -Argument 'server.js' -WorkingDirectory $root
$pilotTrigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'Clash Node Pilot' -Action $pilotAction -Trigger $pilotTrigger -Description 'Start local Clash Node Pilot controller' -Force | Out-Null
$optimizer = Join-Path $root 'auto-optimize.ps1'
$hiddenLauncher = Join-Path $root 'run-powershell-hidden.vbs'
& schtasks.exe /Create /TN 'Clash Node Pilot Optimizer' /SC MINUTE /MO 3 /TR "wscript.exe `"$hiddenLauncher`" `"$optimizer`"" /F | Out-Null
Remove-ItemProperty -Path $runKey -Name 'Clash Verge' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot' -ErrorAction SilentlyContinue
Remove-ItemProperty -Path $runKey -Name 'Clash Node Pilot Optimizer' -ErrorAction SilentlyContinue
Write-Host 'Installed elevated scheduled tasks and removed fallback Run entries.'
