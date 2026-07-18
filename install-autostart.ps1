$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$clash = 'C:\Program Files\Clash Verge\clash-verge.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (Test-Path $clash) { Set-ItemProperty -Path $runKey -Name 'Clash Verge' -Value "`"$clash`"" }
$pilotCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"Start-Sleep -Seconds 20; Set-Location -LiteralPath '$root'; & '$node' server.js`""
Set-ItemProperty -Path $runKey -Name 'Clash Node Pilot' -Value $pilotCommand
$loop = Join-Path $root 'auto-loop.ps1'
$hiddenLauncher = Join-Path $root 'run-powershell-hidden.vbs'
$loopCommand = "wscript.exe `"$hiddenLauncher`" `"$loop`""
Set-ItemProperty -Path $runKey -Name 'Clash Node Pilot Optimizer' -Value $loopCommand
Write-Host 'Installed current-user startup entries: Clash Verge, Clash Node Pilot, Clash Node Pilot Optimizer'
Write-Host 'Optimizer interval: 3 minutes'
