param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$unicodeLabel = [string][char]0x4e2d + [char]0x6587
$root = Join-Path ([IO.Path]::GetTempPath()) ("pilot installer $unicodeLabel " + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'application space'
$data = Join-Path $root 'private data'
$ownedProcess = $null
$appProcess = $null
$installed = $false
$checks = New-Object System.Collections.Generic.List[string]

function Assert-Check([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
  $checks.Add($Message)
}

function Invoke-Installer([string]$Executable, [string[]]$Arguments) {
  $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  $null = $process.Handle
  if (-not $process.WaitForExit(60000)) {
    Stop-Process -Id $process.Id -Force
    throw 'Owned installer process exceeded its 60 second deadline.'
  }
  $process.Refresh()
  return $process.ExitCode
}

function Read-IntegrationSnapshot {
  $entries = @()
  foreach ($key in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run')) {
    if (Test-Path -LiteralPath $key) {
      $entries += Get-ItemProperty -LiteralPath $key | Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress
      $entries += Get-ChildItem -LiteralPath $key | ForEach-Object { $_.Name }
    }
  }
  foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Startup'))) {
    if ($folder -and (Test-Path -LiteralPath $folder)) {
      $entries += Get-ChildItem -LiteralPath $folder -Recurse -Filter '*Pilot*' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
    }
  }
  return (@($entries | Sort-Object) -join "`n")
}

function Assert-OwnedCleanupPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if ($full -ne [IO.Path]::GetFullPath($root).TrimEnd('\') -or -not $full.StartsWith("$tempRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing cleanup outside the unique installer test root.'
  }
  $links = @(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if (((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint) -or $links.Count) {
    throw 'Refusing recursive cleanup through a reparse point.'
  }
}

try {
  New-Item -ItemType Directory -Path $root, $data -Force | Out-Null
  $state = Join-Path $data 'state.json'
  $stateBytes = '{"schemaVersion":2,"monitorOnly":true,"privateMarker":"synthetic-preserve"}'
  [IO.File]::WriteAllText($state, $stateBytes)
  $before = Read-IntegrationSnapshot
  $unowned = Join-Path $root 'unrelated occupied directory'
  New-Item -ItemType Directory -Path $unowned -Force | Out-Null
  $unrelatedFile = Join-Path $unowned 'keep.txt'
  [IO.File]::WriteAllText($unrelatedFile, 'unrelated content')
  $code = Invoke-Installer $setup @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOINTEGRATION=1', "/DIR=`"$unowned`"", "/LOG=`"$(Join-Path $root 'unowned.log')`"")
  Assert-Check ($code -ne 0) 'Installer rejected an occupied directory without its ownership marker.'
  Assert-Check ([IO.File]::ReadAllText($unrelatedFile) -ceq 'unrelated content') 'Rejected installation preserved unrelated files.'
  Assert-Check (-not (Test-Path -LiteralPath (Join-Path $unowned 'server.js'))) 'Rejected installation wrote no application payload.'
  $installArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOINTEGRATION=1', "/DIR=`"$app`"")
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'install.log')`"")
  Assert-Check ($code -eq 0) 'Isolated real installer completed in a Chinese and spaced directory.'
  $installed = $true
  foreach ($file in @('server.js', 'package.json', 'runtime\node.exe', 'stop-pilot.ps1', 'unins000.exe')) {
    Assert-Check (Test-Path -LiteralPath (Join-Path $app $file) -PathType Leaf) "Installed payload contains $file."
  }
  $node = Join-Path $app 'runtime\node.exe'
  Assert-Check (@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node }).Count -eq 0) 'Silent installation did not start the application.'
  $portableState = Join-Path $app 'data\state.json'
  New-Item -ItemType Directory -Path (Split-Path -Parent $portableState) -Force | Out-Null
  [IO.File]::WriteAllText($portableState, $stateBytes)
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'reinstall.log')`"")
  Assert-Check ($code -eq 0) 'Same-version installation over an existing installation completed.'
  Assert-Check ([IO.File]::ReadAllText($state) -ceq $stateBytes) 'External user state survived reinstall unchanged.'
  Assert-Check ([IO.File]::ReadAllText($portableState) -ceq $stateBytes) 'Unmanaged portable data survived reinstall unchanged.'

  $runner = Join-Path $root 'owned-running-process.js'
  [IO.File]::WriteAllText($runner, 'setInterval(() => {}, 1000);')
  $ownedProcess = Start-Process -FilePath $node -ArgumentList "`"$runner`"" -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 300
  Assert-Check (-not $ownedProcess.HasExited) 'Owned installed runtime process is active for upgrade-conflict injection.'
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'running-upgrade.log')`"")
  Assert-Check ($code -ne 0) 'Installer rejected replacement while its installed runtime was active.'
  $ownedProcess.Refresh()
  Assert-Check (-not $ownedProcess.HasExited) 'Installer did not kill the active runtime.'

  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  if ($port -eq 3210) { throw 'Refusing the existing user service port.' }
  $environment = @{
    PORT = [string]$port; HOST = '127.0.0.1'; CLASH_PILOT_STATE = (Join-Path $root 'runtime-state.json')
    CLASH_PILOT_DEMO = '1'; CLASH_PILOT_DISABLE_AUTO_LOOP = '1'; CLASH_PILOT_DISABLE_OS_INTEGRATION = '1'
    CLASH_PILOT_DEMO_AUTO = '0'; CLASH_PILOT_NO_BROWSER = '1'; CLASH_CONFIG = ''
  }
  $previousEnvironment = @{}
  foreach ($key in $environment.Keys) {
    $previousEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process')
  }
  try {
    $appProcess = Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $app 'server.js')`"" -WorkingDirectory $app -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'server.stdout.log') -RedirectStandardError (Join-Path $root 'server.stderr.log')
  } finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
  }
  $health = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($appProcess.HasExited) { throw 'Installed server exited before becoming healthy.' }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
      if ($health.ok) { break }
    } catch { Start-Sleep -Milliseconds 150 }
  }
  Assert-Check ($health.ok -eq $true -and [int]$health.port -eq $port) 'Installed bundled runtime served health on an isolated random port.'
  $package = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
  Assert-Check ($health.version -eq $package.version) 'Installed health reports the packaged version.'
  $session = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/session" -TimeoutSec 3
  Assert-Check ($session.token -match '^[a-f0-9]{64}$') 'Installed application issued a local session.'
  $headers = @{ 'x-pilot-session' = $session.token }
  $diagnostics = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/diagnostics" -Headers $headers -TimeoutSec 3
  Assert-Check ($diagnostics.environment.osIntegrationDisabled -eq $true) 'Installed application respected disabled OS integration.'
  $unauthenticatedStatus = 0
  try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/status" -UseBasicParsing -TimeoutSec 3 | Out-Null }
  catch { $unauthenticatedStatus = [int]$_.Exception.Response.StatusCode }
  Assert-Check ($unauthenticatedStatus -eq 403) 'Installed API rejected access without a session.'
  $code = Invoke-Installer 'powershell.exe' @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $app 'stop-pilot.ps1')`"")
  Assert-Check ($code -eq 0 -and $appProcess.WaitForExit(10000)) 'Installed stop entry stopped its server.'
  $appProcess = $null
  $ownedProcess.Refresh()
  Assert-Check (-not $ownedProcess.HasExited) 'Stop entry preserved a non-server process using the same installed node executable.'
  Stop-Process -Id $ownedProcess.Id -Force
  $ownedProcess.WaitForExit()
  $ownedProcess = $null

  $code = Invoke-Installer (Join-Path $app 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$(Join-Path $root 'uninstall.log')`"")
  Assert-Check ($code -eq 0) 'Isolated real uninstaller completed.'
  $installed = $false
  Assert-Check (-not (Test-Path -LiteralPath (Join-Path $app 'server.js'))) 'Uninstall removed the installed application payload.'
  Assert-Check ([IO.File]::ReadAllText($state) -ceq $stateBytes) 'Uninstall preserved external user state byte-for-byte.'
  Assert-Check ([IO.File]::ReadAllText($portableState) -ceq $stateBytes) 'Uninstall preserved unmanaged portable data byte-for-byte.'
  Assert-Check ((Read-IntegrationSnapshot) -ceq $before) 'Isolated lifecycle left user uninstall registration, startup values and Pilot shortcuts unchanged.'
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  $setupStream = [IO.File]::OpenRead($setup)
  try { $setupHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($setupStream)).Replace('-', '').ToLowerInvariant() }
  finally { $setupStream.Dispose(); $hashAlgorithm.Dispose() }
  [pscustomobject]@{
    ok = $true; mode = 'real-installer-no-user-integration'; setupSha256 = $setupHash
    checks = $checks.ToArray(); limitations = @('Default registry and shortcut integration not exercised.', 'Reinstall uses the same build; migration from an older released installer is not established.', 'Only owned isolated application and dummy processes were started or stopped; no existing user process was modified.')
    retainedPath = $(if ($Keep) { $root } else { $null })
  } | ConvertTo-Json -Depth 5
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force; $appProcess.WaitForExit() }
  if ($ownedProcess -and -not $ownedProcess.HasExited) { Stop-Process -Id $ownedProcess.Id -Force; $ownedProcess.WaitForExit() }
  if ($installed -and (Test-Path -LiteralPath (Join-Path $app 'unins000.exe'))) {
    $null = Invoke-Installer (Join-Path $app 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
  }
  if (-not $Keep -and (Test-Path -LiteralPath $root)) {
    Assert-OwnedCleanupPath $root
    Remove-Item -LiteralPath $root -Recurse -Force
  }
}
