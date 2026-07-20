$ErrorActionPreference = 'SilentlyContinue'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dataDir = Join-Path $root 'data'
$logPath = Join-Path $dataDir 'startup-watchdog.log'
$clashExe = 'C:\Program Files\Clash Verge\clash-verge.exe'
$configPath = Join-Path $env:APPDATA 'io.github.clash-verge-rev.clash-verge-rev\config.yaml'
$nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$serverPath = Join-Path $root 'server.js'

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
if ((Test-Path $logPath) -and (Get-Item $logPath).Length -gt 1MB) {
  Move-Item -LiteralPath $logPath -Destination "$logPath.previous" -Force
}

function Write-WatchdogLog([string]$message) {
  "$(Get-Date -Format s) $message" | Add-Content -LiteralPath $logPath -Encoding UTF8
}

function Wait-Network([int]$timeoutSeconds = 90) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    $adapterReady = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' }
    $dnsReady = Resolve-DnsName 'www.gstatic.com' -Type A -QuickTimeout -ErrorAction SilentlyContinue
    if ($adapterReady -and $dnsReady) { return $true }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Get-ClashController {
  if (-not (Test-Path $configPath)) { return $null }
  $content = Get-Content -LiteralPath $configPath -Encoding UTF8
  $controllerMatch = $content | Select-String '^external-controller:\s*(.+?)\s*$' | Select-Object -First 1
  $secretMatch = $content | Select-String '^secret:\s*(.*?)\s*$' | Select-Object -First 1
  if (-not $controllerMatch) { return $null }
  $controller = $controllerMatch.Matches[0].Groups[1].Value.Trim().Trim("'", '"')
  $secret = if ($secretMatch) { $secretMatch.Matches[0].Groups[1].Value.Trim().Trim("'", '"') } else { '' }
  return @{ BaseUrl = "http://$controller"; Secret = $secret }
}

function Test-ClashController {
  $controller = Get-ClashController
  if (-not $controller) { return $false }
  $headers = @{}
  if ($controller.Secret) { $headers.Authorization = "Bearer $($controller.Secret)" }
  try {
    $version = Invoke-RestMethod -Uri "$($controller.BaseUrl)/version" -Headers $headers -TimeoutSec 3
    return [bool]$version
  } catch { return $false }
}

function Wait-ClashController([int]$timeoutSeconds = 50) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-ClashController) { return $true }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Test-NodePilot {
  try {
    $status = Invoke-RestMethod -Uri 'http://127.0.0.1:3210/api/status' -TimeoutSec 4
    return [bool]$status.connected
  } catch { return $false }
}

function Start-NodePilot {
  if (-not $nodeExe -or -not (Test-Path $serverPath)) {
    Write-WatchdogLog 'Node Pilot start skipped: node.exe or server.js not found.'
    return $false
  }
  Start-Process -FilePath $nodeExe -ArgumentList @($serverPath) -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(15)
  do {
    if (Test-NodePilot) { return $true }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  return $false
}

if (-not (Wait-Network)) {
  Write-WatchdogLog 'Network/DNS unavailable after 90 seconds; retry on next watchdog run.'
  exit 2
}

$clashHealthy = Test-ClashController
if (-not $clashHealthy) {
  Write-WatchdogLog 'Mihomo controller unhealthy; restarting Clash Verge.'
  Get-Process verge-mihomo, clash-verge -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
  if (-not (Test-Path $clashExe)) {
    Write-WatchdogLog 'Clash Verge executable not found.'
    exit 3
  }
  Start-Process -FilePath $clashExe -WorkingDirectory (Split-Path $clashExe) -WindowStyle Hidden
  $clashHealthy = Wait-ClashController
  Write-WatchdogLog $(if ($clashHealthy) { 'Mihomo controller recovered.' } else { 'Mihomo controller recovery timed out.' })
}

if (-not $clashHealthy) { exit 4 }

if (-not (Test-NodePilot)) {
  $pilotStarted = Start-NodePilot
  Write-WatchdogLog $(if ($pilotStarted) { 'Node Pilot started.' } else { 'Node Pilot failed to start.' })
  if (-not $pilotStarted) { exit 5 }
}

Write-WatchdogLog 'Healthy.'
exit 0
