param([string]$Port = $env:PORT)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-common.ps1')
$Port = Resolve-PilotPort $Port
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$hiddenLauncher = Join-Path $PSScriptRoot 'run-powershell-hidden.vbs'
$watchdog = Join-Path $PSScriptRoot 'startup-watchdog.ps1'
$taskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$hiddenLauncher`" `"$watchdog`" -Port $Port"
$startup = New-ScheduledTaskTrigger -AtLogOn
$periodic = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 2)
Register-ScheduledTask -TaskName 'Clash Node Pilot Watchdog' -Action $action -Trigger @($startup, $periodic) -Settings $taskSettings -Description 'Keep the local Node Pilot service available' -Force | Out-Null
foreach ($name in @('Clash Node Pilot', 'Clash Node Pilot Startup', 'Clash Node Pilot Optimizer')) {
  Remove-ItemProperty -Path $runKey -Name $name -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
}
Write-Host "Node Pilot watchdog enabled on port $Port. Automatic optimization is managed by the Node service."
