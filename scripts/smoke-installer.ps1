param(
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [string]$PreviousSetupPath,
  [switch]$Keep,
  [switch]$VerifyIntegration
)

$ErrorActionPreference = 'Stop'
if ($VerifyIntegration -and ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows')) {
  throw 'VerifyIntegration requires a GitHub Actions Windows runner. Local user integration is forbidden.'
}
if ($PreviousSetupPath -and $VerifyIntegration) {
  throw 'PreviousSetupPath requires isolated /NOINTEGRATION mode.'
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$previousSetup = if ($PreviousSetupPath) { (Resolve-Path -LiteralPath $PreviousSetupPath).Path } else { $null }
$expectedVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$unicodeLabel = [string][char]0x4e2d + [char]0x6587
$root = Join-Path ([IO.Path]::GetTempPath()) ("pilot installer $unicodeLabel " + [Guid]::NewGuid().ToString('N'))
$app = Join-Path $root 'application space'
$data = Join-Path $root 'private data'
$ownedProcess = $null
$appProcess = $null
$installed = $false
$junctionPresent = $false
$report = $null
$phase = 'initialize'
$originalFailure = $null
$checks = New-Object System.Collections.Generic.List[string]
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6E17E88E-073F-4827-9377-49523373F319}_is1'
$launchLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Clash Node Pilot.lnk'
$stopLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Stop Clash Node Pilot.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Clash Node Pilot.lnk'

Add-Type -TypeDefinition @'
using System.Text;
using System;
using System.Runtime.InteropServices;
public static class PilotInstallerPaths {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern uint GetLongPathName(string path, StringBuilder result, uint length);
}
[ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPilotShellLinkW {
    void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count, IntPtr findData, uint flags);
    void GetIDList(out IntPtr value);
    void SetIDList(IntPtr value);
    void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count);
    void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string value);
    void GetHotkey(out short value);
    void SetHotkey(short value);
    void GetShowCmd(out int value);
    void SetShowCmd(int value);
    void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder value, int count, out int index);
    void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string value, int index);
    void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string value, uint reserved);
    void Resolve(IntPtr window, uint flags);
    void SetPath([MarshalAs(UnmanagedType.LPWStr)] string value);
}
public sealed class PilotShortcutValues {
    public string TargetPath;
    public string WorkingDirectory;
    public string Arguments;
}
public static class PilotUnicodeShortcut {
    private static object Create() {
        return Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
    }
    public static PilotShortcutValues Read(string path) {
        object instance = Create();
        try {
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)instance).Load(path, 0);
            IPilotShellLinkW link = (IPilotShellLinkW)instance;
            StringBuilder target = new StringBuilder(32768), working = new StringBuilder(32768), args = new StringBuilder(32768);
            link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
            link.GetWorkingDirectory(working, working.Capacity);
            link.GetArguments(args, args.Capacity);
            return new PilotShortcutValues { TargetPath = target.ToString(), WorkingDirectory = working.ToString(), Arguments = args.ToString() };
        } finally { Marshal.FinalReleaseComObject(instance); }
    }
    public static void WriteTestFixture(string path, string target, string working, string args) {
        object instance = Create();
        try {
            IPilotShellLinkW link = (IPilotShellLinkW)instance;
            link.SetPath(target); link.SetWorkingDirectory(working); link.SetArguments(args);
            ((System.Runtime.InteropServices.ComTypes.IPersistFile)instance).Save(path, true);
        } finally { Marshal.FinalReleaseComObject(instance); }
    }
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
  $script:phase = "shortcut:$(Split-Path -Leaf $LinkPath)"
  Assert-Check (Test-Path -LiteralPath $LinkPath -PathType Leaf) "Installer created $(Split-Path -Leaf $LinkPath)."
    $link = [PilotUnicodeShortcut]::Read($LinkPath)
    $context = @{ link = $LinkPath; target = $link.TargetPath; workingDirectory = $link.WorkingDirectory; arguments = $link.Arguments; targetCodepoints = @($link.TargetPath.ToCharArray() | ForEach-Object { 'U+{0:X4}' -f [int]$_ }); workingCodepoints = @($link.WorkingDirectory.ToCharArray() | ForEach-Object { 'U+{0:X4}' -f [int]$_ }) } | ConvertTo-Json -Compress
    try {
      $actualTarget = Get-LongExistingPath (ConvertFrom-ShortcutPath $link.TargetPath)
      $actualWorkingDirectory = Get-LongExistingPath (ConvertFrom-ShortcutPath $link.WorkingDirectory)
    } catch {
      throw "Shortcut path parsing failed: $context. $($_.Exception.Message)"
    }
    Assert-Check ($actualTarget -ieq (Get-LongExistingPath $Target)) "Shortcut $(Split-Path -Leaf $LinkPath) targets the installed application. $context"
    Assert-Check ($link.Arguments -ceq $Arguments) "Shortcut $(Split-Path -Leaf $LinkPath) has the expected arguments. $context"
    Assert-Check ($actualWorkingDirectory -ieq $app) "Shortcut $(Split-Path -Leaf $LinkPath) uses its installation directory. $context"
}

function ConvertFrom-ShortcutPath([string]$Value) {
  # IShellLink fields can preserve a single surrounding quote pair, unlike filesystem paths.
  if ($Value.Length -ge 2 -and $Value[0] -eq [char]34 -and $Value[$Value.Length - 1] -eq [char]34) {
    $Value = $Value.Substring(1, $Value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Contains([string][char]34) -or $Value.Contains([string][char]0)) {
    throw 'Shortcut path is empty or contains malformed quoting or a null character.'
  }
  if (-not [IO.Path]::IsPathRooted($Value)) { throw 'Shortcut path must be absolute.' }
  return $Value
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
  if ($previousSetup) {
    $phase = 'previous-install'
    $previousArgs = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/NOINTEGRATION=1', "/DIR=`"$app`"", "/LOG=`"$(Join-Path $root 'previous-install.log')`"")
    $code = Invoke-Installer $previousSetup $previousArgs
    Assert-Check ($code -eq 0) 'Previous released installer completed in the isolated upgrade directory.'
    $installed = $true
    Assert-Check (Test-Path -LiteralPath (Join-Path $app 'server.js') -PathType Leaf) 'Previous installer payload is present before upgrade.'
    $previousPackage = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
    Assert-Check ($previousPackage.version -eq '0.3.0') 'Previous installer payload reports the expected v0.3.0 version.'
    $portableState = Join-Path $app 'data\state.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $portableState) -Force | Out-Null
    [IO.File]::WriteAllText($portableState, $stateBytes)
  }
  $phase = 'install'
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'install.log')`"")
  Assert-Check ($code -eq 0) 'Isolated real installer completed in a Chinese and spaced directory.'
  $installed = $true
  $currentPackage = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
  Assert-Check ($currentPackage.version -eq $expectedVersion) "Current installer payload reports the expected v$expectedVersion version."
  if ($VerifyIntegration) {
    Assert-Shortcut $launchLink (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $app 'start-clash-node-pilot.vbs')`""
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
  if (-not $portableState) {
    $portableState = Join-Path $app 'data\state.json'
    New-Item -ItemType Directory -Path (Split-Path -Parent $portableState) -Force | Out-Null
    [IO.File]::WriteAllText($portableState, $stateBytes)
  }
  $phase = 'reinstall'
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'reinstall.log')`"")
  Assert-Check ($code -eq 0) 'Same-version installation over an existing installation completed.'
  if ($VerifyIntegration) {
    Assert-Shortcut $desktopLink (Join-Path $env:WINDIR 'System32\wscript.exe') "`"$(Join-Path $app 'start-clash-node-pilot.vbs')`""
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
  $phase = 'junction-upgrade'
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
  $phase = 'running-upgrade'
  [IO.File]::WriteAllText($runner, 'setInterval(() => {}, 1000);')
  $ownedProcess = Start-Process -FilePath $node -ArgumentList "`"$runner`"" -WindowStyle Hidden -PassThru
  Start-Sleep -Milliseconds 300
  Assert-Check (-not $ownedProcess.HasExited) 'Owned installed runtime process is active for upgrade-conflict injection.'
  $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'running-upgrade.log')`"")
  Assert-Check ($code -ne 0) 'Installer rejected replacement while its installed runtime was active.'
  $ownedProcess.Refresh()
  Assert-Check (-not $ownedProcess.HasExited) 'Installer did not kill the active runtime.'

  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
  $phase = 'installed-server'
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
    $launcher = Join-Path $app 'start-clash-node-pilot.vbs'
    $code = Invoke-Installer (Join-Path $env:WINDIR 'System32\wscript.exe') @("`"$launcher`"")
    Assert-Check ($code -eq 0) 'Installed hidden VBS launcher completed successfully.'
  } finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
  }
  $health = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not $appProcess) {
      $candidate = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.ExecutablePath -ieq $node -and $_.CommandLine -and $_.CommandLine.Contains((Join-Path $app 'server.js'))
      } | Select-Object -First 1)
      if ($candidate) { $appProcess = Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction SilentlyContinue }
    }
    if ($appProcess -and $appProcess.HasExited) { throw 'Installed server exited before becoming healthy.' }
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
      if ($health.ok) { break }
    } catch { Start-Sleep -Milliseconds 150 }
  }
  Assert-Check ($null -ne $appProcess -and -not $appProcess.HasExited) 'Installed VBS launcher started the bundled Node server process.'
  Assert-Check ($health.ok -eq $true -and [int]$health.port -eq $port) 'Installed bundled runtime served health on an isolated random port.'
  $package = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json
  Assert-Check ($health.version -eq $package.version) 'Installed health reports the packaged version.'
  $code = Invoke-Installer 'powershell.exe' @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $app 'startup-watchdog.ps1')`"", '-Port', "$port")
  Assert-Check ($code -eq 0 -and -not $appProcess.HasExited) 'Installed watchdog recognized its exact process and listening socket.'
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

  $phase = 'automatic-running-upgrade'
  foreach ($key in $environment.Keys) { [Environment]::SetEnvironmentVariable($key, $environment[$key], 'Process') }
  try {
    $appProcess = Start-Process -FilePath $node -ArgumentList "`"$(Join-Path $app 'server.js')`"" -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    Assert-Check (-not $appProcess.HasExited) 'Real server is running before automatic upgrade.'
    $code = Invoke-Installer $setup ($installArgs + "/LOG=`"$(Join-Path $root 'automatic-upgrade.log')`"")
    Assert-Check ($code -eq 0) 'Installer automatically stopped its server and updated successfully.'
    Assert-Check ($appProcess.WaitForExit(10000)) 'Automatic upgrade stopped the old server.'
    Assert-Check ([IO.File]::ReadAllText($state) -ceq $stateBytes) 'Automatic upgrade preserved user state.'
    $appProcess = $null
  } finally {
    foreach ($key in $previousEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $previousEnvironment[$key], 'Process') }
  }

  $phase = 'uninstall'
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
  $mode = if ($VerifyIntegration) { 'real-installer-runner-user-integration' } elseif ($previousSetup) { 'real-installer-previous-upgrade' } else { 'real-installer-no-user-integration' }
  $migrationLimit = if ($previousSetup) { 'Runtime state schema migration semantics and downgrade from other historical releases remain unverified.' } else { 'Cross-version migration from an older released installer is not established.' }
  $report = [pscustomobject]@{
    ok = $true; mode = $mode; setupSha256 = $setupHash
    checks = $checks.ToArray(); limitations = @($(if (-not $VerifyIntegration) { 'Default registry and shortcut integration not exercised.' } else { 'Runner integration was checked without launching shortcut targets or a browser.' }), $(if ($previousSetup) { 'Previous installer upgrade used the supplied setup executable; its provenance must be verified separately.' } else { 'Reinstall uses the same build.' }), $migrationLimit, 'Only owned isolated application and dummy processes were started or stopped; no existing user process was modified.')
    retainedPath = $(if ($Keep) { $root } else { $null })
  }
} catch {
  $originalFailure = $_
  Write-Warning "Installer verification failed in phase ${phase}: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
  throw
} finally {
  try {
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
  } catch {
    if ($originalFailure) {
      Write-Warning "Cleanup also failed; original verification error remains primary: $($_.Exception.Message)`n$($_.ScriptStackTrace)"
    } else { throw }
  }
}
if ($report) { $report | ConvertTo-Json -Depth 5 }
