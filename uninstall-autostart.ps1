$ErrorActionPreference = 'SilentlyContinue'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
@('Clash Verge', 'Clash Node Pilot', 'Clash Node Pilot Startup', 'Clash Node Pilot Watchdog', 'Clash Node Pilot Optimizer') | ForEach-Object {
  Remove-ItemProperty -Path $runKey -Name $_
  Unregister-ScheduledTask -TaskName $_ -Confirm:$false
}
Write-Host 'Removed Clash Node Pilot startup entries and scheduled tasks.'
Write-Host 'Run this script as administrator if scheduled tasks remain.'
