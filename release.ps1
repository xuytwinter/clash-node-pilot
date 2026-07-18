$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = if ($args[0]) { $args[0] } else { '0.1.0' }
$out = Join-Path $root "clash-node-pilot-$version-windows.zip"
$files = @('package.json','README.md','LICENSE','CHANGELOG.md','SECURITY.md','server.js','regions.json','public','test','start-clash-node-pilot.cmd','install-pilot-autostart.ps1','uninstall-pilot-autostart.ps1','install-autostart-admin.ps1','auto-optimize.ps1','auto-loop.ps1','run-powershell-hidden.vbs')
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
Compress-Archive -Path ($files | ForEach-Object { Join-Path $root $_ }) -DestinationPath $out
Write-Host "Created $out"
