param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [switch]$Keep,
  [switch]$VerifyIntegration
)

$ErrorActionPreference = 'Stop'
if ($VerifyIntegration -and ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows')) {
  throw 'VerifyIntegration requires a GitHub Actions Windows runner. Local user integration is forbidden.'
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$unicodeLabel = [string][char]0x4e2d + [char]0x6587
$root = Join-Path ([IO.Path]::GetTempPath()) ("pilot installer $unicodeLabel " + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'application space'
$data = Join-Path $root 'private data'
$ownedProcess = $null
$appProcess = $null
$installed = $false
$junctionPresent = $false
$report = $null
$checks = New-Object System.Collections.Generic.List[string]
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6E17E88E-073F-4827-9377-49523373F319}_is1'
$launchLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Clash Node Pilot.lnk'
$stopLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Stop Clash Node Pilot.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Clash Node Pilot.lnk'

Add-Type -TypeDefinition @'
using System.Text;
using System.Runtime.InteropServices;
public static class PilotInstallerPaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetLongPathName(string path, StringBuilder result, uint length);
}
'@

function Get-LongExistingPath([string]$Path) {
  $buffer = New-Object Text.StringBuilder 32768
  $length = [PilotInstallerPaths]::GetLongPathName([IO.Path]::GetFullPath($Path), $buffer, $buffer.Capacity)
  if ($length -eq 0 -or $length -ge $buffer.Capacity) { throw "Cannot resolve the long Windows path: $Path" }
  return $buffer.ToString()
}

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

function Assert-Shortcut([string]$LinkPath, [string]$Target, [string]$Arguments) {
  Assert-Check (Test-Path -LiteralPath $LinkPath -PathType Leaf) "Installer created $(Split-Path -Leaf $LinkPath)."
  $shell = New-Object -ComObject WScript.Shell
  $link = $null
  try {
    $link = $shell.CreateShortcut($LinkPath)
    Assert-Check ((Get-LongExistingPath $link.TargetPath) -ieq (Get-LongExistingPath $Target)) "Shortcut $(Split-Path -Leaf $LinkPath) targets the installed application."
    Assert-Check ($link.Arguments -ceq $Arguments) "Shortcut $(Split-Path -Leaf $LinkPath) has the expected arguments."
    Assert-Check ((Get-LongExistingPath $link.WorkingDirectory) -ieq $app) "Shortcut $(Split-Path -Leaf $LinkPath) uses its installation directory."
  } finally {
    if ($link) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
}

function Read-StartupSnapshot {
  $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  $startup = [Environment]::GetFolderPath('Startup')
  $entries = @()
  if (Test-Path -LiteralPath $runKey) { $entries += Get-ItemProperty -LiteralPath $runKey | Select-Object * -ExcludeProperty PS* | ConvertTo-Json -Compress }
  if (Test-Path -LiteralPath $startup) { $entries += Get-ChildItem -LiteralPath $startup -Recurse -Force | ForEach-Object { $_.FullName } }
  return (@($entries | Sort-Object) -join "`n")
}

function Assert-OwnedCleanupPath([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
  $tempRoot = (Get-LongExistingPath ([IO.Path]::GetTempPath())).TrimEnd('\')
  if ($full -ne [IO.Path]::GetFullPath($root).TrimEnd('\') -or -not $full.StartsWith("$tempRoot\", [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing cleanup outside the unique installer test root.'
  }
  $links = @(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
  if (((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint) -or $links.Count) {
    throw 'Refusing recursive cleanup through a reparse point.'
  }
}

try {
  if ($VerifyIntegration) {
    foreach ($entry in @($uninstallKey, $launchLink, $stopLink, $desktopLink)) {
      if (Test-Path -LiteralPath $entry) { throw "Refusing to overwrite existing runner integration: $entry" }
    }
  }
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  $root = Get-LongExistingPath $root
  $app = Join-Path $root 'application space'
  $data = Join-Path $root 'private data'
  New-Item -ItemType Directory -Path $data -Force | Out-Null
  $state = Join-Path $data 'state.json'
  $stateBytes = '{"schemaVersion":2,"monitorOnly":true,"privateMarker":"synthetic-preserve"}'
  [IO.File]::WriteAllText($state, $stateBytes)
  $before = Read-IntegrationSnapshot
  $startupBefore = Read-StartupSnapshot
  $unowned = Join-Path $root 'unrelated occupied directory'
  New-Item -ItemType Directory -Path $unowned -Force | Out-Null
  $unrelatedFile = Join-Path $unowned 'keep.txt'
  [IO.File]::WriteAllText($unrelatedFile, 'unrelated content')
  $code = Invoke-Installer $setup @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOINTEGRATION=1', "/DIR=`"$unowned`"", "/LOG=`"$(Join-Path $root 'unowned.log')`"")
  Assert-Check ($code -ne 0) 'Installer rejected an occupied directory without its ownership marker.'
  Assert-Check ([IO.File]::ReadAllText($unrelatedFile) -ceq 'unrelated content') 'Rejected installation preserved unrelated files.'
  Assert-Check (-not (Test-Path -LiteralPath (Join-Path $unowned 'server.js'))) 'Rejected installation wrote no application payload.'
  $installArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$app`"")
  if (-not $VerifyIntegration) { $installArgs += '/NOINTEGRATION=1' }
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'install.log')`"")
  Assert-Check ($code -eq 0) 'Isolated real installer completed in a Chinese and spaced directory.'
  $installed = $true
  if ($VerifyIntegration) {
    Assert-Shortcut $launchLink (Join-Path $app 'start-clash-node-pilot.cmd') ''
    Assert-Shortcut $stopLink (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $app 'stop-pilot.ps1')`""
    Assert-Check (-not (Test-Path -LiteralPath $desktopLink)) 'Default installation did not create an optional desktop shortcut.'
    Assert-Check (Test-Path -LiteralPath $uninstallKey) 'Default installation registered a current-user uninstaller.'
    $registration = Get-ItemProperty -LiteralPath $uninstallKey
    Assert-Check ($registration.DisplayName -eq 'Clash Node Pilot') 'Uninstall registration has the expected application name.'
    Assert-Check ($registration.UninstallString -ceq "`"$(Join-Path $app 'unins000.exe')`"") 'Uninstall registration points to this isolated installation.'
    Assert-Check ((Read-StartupSnapshot) -ceq $startupBefore) 'Default installation did not enable autostart.'
    $installArgs += '/TASKS=desktopicon'
  }
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
  if ($VerifyIntegration) {
    Assert-Shortcut $desktopLink (Join-Path $app 'start-clash-node-pilot.cmd') ''
    Assert-Check ((Read-StartupSnapshot) -ceq $startupBefore) 'Optional desktop shortcut creation did not enable autostart.'
  }
  Assert-Check ([IO.File]::ReadAllText($state) -ceq $stateBytes) 'External user state survived reinstall unchanged.'
  Assert-Check ([IO.File]::ReadAllText($portableState) -ceq $stateBytes) 'Unmanaged portable data survived reinstall unchanged.'

  $publicPath = [IO.Path]::GetFullPath((Join-Path $app 'public'))
  $publicBackup = [IO.Path]::GetFullPath((Join-Path $root 'public-original'))
  $outside = [IO.Path]::GetFullPath((Join-Path $root 'outside-installation'))
  foreach ($ownedPath in @($publicPath, $publicBackup, $outside)) {
    if (-not $ownedPath.StartsWith(([IO.Path]::GetFullPath($root).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Refusing junction fixture outside its unique temporary root.'
    }
  }
  New-Item -ItemType Directory -Path $outside -Force | Out-Null
  $outsideMarker = Join-Path $outside 'sentinel.txt'
  [IO.File]::WriteAllText($outsideMarker, 'outside content must remain unchanged')
  Move-Item -LiteralPath $publicPath -Destination $publicBackup
  try {
    New-Item -ItemType Junction -Path $publicPath -Target $outside | Out-Null
    $junctionPresent = $true
    $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'junction-upgrade.log')`"")
    Assert-Check ($code -ne 0) 'Installer rejected an internal directory junction before writing through it.'
    Assert-Check ([IO.File]::ReadAllText($outsideMarker) -ceq 'outside content must remain unchanged') 'Rejected junction upgrade preserved the external sentinel bytes.'
    Assert-Check (@(Get-ChildItem -LiteralPath $outside -Force).Count -eq 1) 'Rejected junction upgrade wrote no payload into the external directory.'
  } finally {
    if ($junctionPresent) {
      if (-not ((Get-Item -LiteralPath $publicPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Junction fixture changed unexpectedly; refusing removal.'
      }
      # Delete only the link itself; never recursively remove its target.
      [IO.Directory]::Delete($publicPath)
      $junctionPresent = $false
    }
    Move-Item -LiteralPath $publicBackup -Destination $publicPath
  }

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
  if ($VerifyIntegration) {
    foreach ($entry in @($uninstallKey, $launchLink, $stopLink, $desktopLink)) {
      Assert-Check (-not (Test-Path -LiteralPath $entry)) "Uninstall removed owned integration: $entry"
    }
  }
  Assert-Check ((Read-IntegrationSnapshot) -ceq $before) 'Isolated lifecycle left user uninstall registration, startup values and Pilot shortcuts unchanged.'
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  $setupStream = [IO.File]::OpenRead($setup)
  try { $setupHash = [BitConverter]::ToString($hashAlgorithm.ComputeHash($setupStream)).Replace('-', '').ToLowerInvariant() }
  finally { $setupStream.Dispose(); $hashAlgorithm.Dispose() }
  $report = [pscustomobject]@{
    ok = $true; mode = $(if ($VerifyIntegration) { 'real-installer-runner-user-integration' } else { 'real-installer-no-user-integration' }); setupSha256 = $setupHash
    checks = $checks.ToArray(); limitations = @($(if (-not $VerifyIntegration) { 'Default registry and shortcut integration not exercised.' } else { 'Runner integration was checked without launching shortcut targets or a browser.' }), 'Reinstall uses the same build; migration from an older released installer is not established.', 'Only owned isolated application and dummy processes were started or stopped; no existing user process was modified.')
    retainedPath = $(if ($Keep) { $root } else { $null })
  }
} finally {
  if ($appProcess -and -not $appProcess.HasExited) { Stop-Process -Id $appProcess.Id -Force; $appProcess.WaitForExit() }
  if ($ownedProcess -and -not $ownedProcess.HasExited) { Stop-Process -Id $ownedProcess.Id -Force; $ownedProcess.WaitForExit() }
  if ($installed -and -not $junctionPresent -and (Test-Path -LiteralPath (Join-Path $app 'unins000.exe'))) {
    $null = Invoke-Installer (Join-Path $app 'unins000.exe') @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')
  }
  if (-not $Keep -and (Test-Path -LiteralPath $root)) {
    # Inno's temporary uninstaller may briefly hold the log after its parent exits.
    $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(15)
    while (Test-Path -LiteralPath $root) {
      Assert-OwnedCleanupPath $root
      try {
        Remove-Item -LiteralPath $root -Recurse -Force
      } catch {
        if ([DateTime]::UtcNow -ge $cleanupDeadline) {
          throw "Installer cleanup failed after 15 seconds; inspect retained test directory ${root}: $($_.Exception.Message)"
        }
        Start-Sleep -Milliseconds 250
      }
    }
  }
}
if ($report) { $report | ConvertTo-Json -Depth 5 }
