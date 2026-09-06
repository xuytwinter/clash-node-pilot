param(
  [string]$Version = '0.1.0',
  [string]$NodeVersion = '22.23.1'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
if ($package.version -ne $Version) {
  throw "package.json version $($package.version) does not match release version $Version"
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'Windows x64 packaging requires a 64-bit operating system'
}

$nodeBaseName = "node-v$NodeVersion-win-x64"
$nodeArchiveName = "$nodeBaseName.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeArchiveName"
$cacheDir = Join-Path $root 'work\node-runtime-cache'
$downloadPath = Join-Path $cacheDir $nodeArchiveName
$checksumPath = Join-Path $cacheDir 'SHASUMS256.txt'
$buildDir = Join-Path $root 'work\release'
$stageName = "clash-node-pilot-v$Version-windows-x64"
$stageDir = Join-Path $buildDir $stageName
$outDir = Join-Path $root 'outputs'
$zipName = "$stageName-portable.zip"
$zipPath = Join-Path $outDir $zipName
$shaPath = "$zipPath.sha256"

Remove-Item -LiteralPath $buildDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $cacheDir, $stageDir, $outDir -Force | Out-Null
Get-ChildItem -LiteralPath $outDir -Filter 'clash-node-pilot-*.zip*' -File -ErrorAction SilentlyContinue | Remove-Item -Force

if (-not (Test-Path $downloadPath)) {
  Invoke-WebRequest -Uri $nodeUrl -OutFile $downloadPath
}
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $checksumPath
$expected = (Select-String -LiteralPath $checksumPath -Pattern "\s$([regex]::Escape($nodeArchiveName))$").Line.Split(' ')[0]
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadPath).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
  throw "Node runtime checksum mismatch for $nodeArchiveName"
}

$nodeExtract = Join-Path $buildDir 'node'
Expand-Archive -LiteralPath $downloadPath -DestinationPath $nodeExtract -Force
$nodeRoot = Join-Path $nodeExtract $nodeBaseName
$runtimeDir = Join-Path $stageDir 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $nodeRoot 'node.exe') -Destination $runtimeDir
foreach ($licenseFile in @('LICENSE', 'NOTICE', 'README.md', 'CHANGELOG.md')) {
  $source = Join-Path $nodeRoot $licenseFile
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeDir "NODE-$licenseFile")
  }
}

$nodeExe = Join-Path $runtimeDir 'node.exe'
$resolvedNodeVersion = (& $nodeExe --version).Trim()
if ($resolvedNodeVersion -ne "v$NodeVersion") {
  throw "Bundled node.exe reports $resolvedNodeVersion, expected v$NodeVersion"
}
@"
Clash Node Pilot $Version portable runtime
Node.js: $resolvedNodeVersion
Architecture: win-x64
Source: $nodeUrl
Node archive SHA256: $actual
"@ | Set-Content -LiteralPath (Join-Path $runtimeDir 'NODE-RUNTIME.txt') -Encoding UTF8

$items = @(
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'RELEASE_NOTES.md',
  'server.js',
  'src',
  'scripts',
  'docs',
  'regions.json',
  'public',
  'start-clash-node-pilot.cmd',
  'install-pilot-autostart.ps1',
  'uninstall-pilot-autostart.ps1',
  'install-autostart.ps1',
  'install-autostart-admin.ps1',
  'uninstall-autostart.ps1',
  'startup-watchdog.ps1',
  'auto-optimize.ps1',
  'auto-loop.ps1',
  'run-powershell-hidden.vbs'
)
foreach ($item in $items) {
  $source = Join-Path $root $item
  if (-not (Test-Path $source)) { throw "Required release file missing: $item" }
  Copy-Item -LiteralPath $source -Destination $stageDir -Recurse
}

$forbidden = @('.git', 'test', 'work', 'data', 'node_modules')
foreach ($name in $forbidden) {
  if (Test-Path (Join-Path $stageDir $name)) { throw "Forbidden path included in staging: $name" }
}
if (-not (Test-Path (Join-Path $stageDir 'runtime\node.exe'))) { throw 'runtime/node.exe missing from staging' }

$requiredRuntimeFiles = @(
  'server.js',
  'src\core\controller.js',
  'src\core\optimizer.js',
  'src\core\security.js',
  'src\core\state.js'
)
foreach ($item in $requiredRuntimeFiles) {
  if (-not (Test-Path (Join-Path $stageDir $item))) { throw "Required runtime file missing from staging: $item" }
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Test-PilotLaunch {
  param([string]$AppDir)

  $smokeDir = Join-Path $buildDir ("smoke-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $smokeDir -Force | Out-Null
  $configPath = Join-Path $smokeDir 'config.yaml'
  Set-Content -LiteralPath $configPath -Value 'external-controller: 127.0.0.1:9' -Encoding UTF8
  $port = Get-FreeTcpPort
  $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $processInfo.FileName = Join-Path $AppDir 'runtime\node.exe'
  $serverScript = Join-Path $AppDir 'server.js'
  $processInfo.Arguments = "`"$serverScript`""
  $processInfo.WorkingDirectory = $AppDir
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $processInfo.CreateNoWindow = $true
  $processInfo.Environment['PORT'] = [string]$port
  $processInfo.Environment['CLASH_CONFIG'] = $configPath
  $processInfo.Environment['CLASH_PILOT_STATE'] = Join-Path $smokeDir 'state.json'
  $processInfo.Environment['CLASH_PILOT_DEMO'] = '1'
  $processInfo.Environment['CLASH_PILOT_DISABLE_AUTO_LOOP'] = '1'
  $processInfo.Environment['CLASH_PILOT_DISABLE_OS_INTEGRATION'] = '1'
  $processInfo.Environment['APPDATA'] = Join-Path $smokeDir 'Roaming'
  $processInfo.Environment['LOCALAPPDATA'] = Join-Path $smokeDir 'Local'
  $process = [System.Diagnostics.Process]::Start($processInfo)
  try {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    $healthy = $false
    while ([DateTime]::UtcNow -lt $deadline) {
      if ($process.HasExited) { break }
      try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2
        if ($response.ok -eq $true -and [int]$response.port -eq $port) {
          $healthy = $true
          break
        }
      } catch {
        Start-Sleep -Milliseconds 250
      }
    }
    if (-not $healthy) {
      if (-not $process.HasExited) {
        $process.Kill()
        $process.WaitForExit(5000) | Out-Null
      }
      $stdout = $process.StandardOutput.ReadToEnd()
      $stderr = $process.StandardError.ReadToEnd()
      throw "Portable launch smoke failed for $AppDir. stdout=$stdout stderr=$stderr"
    }
  } finally {
    if (-not $process.HasExited) {
      $process.Kill()
      $process.WaitForExit(5000) | Out-Null
    }
    Remove-Item -LiteralPath $smokeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$checkFiles = @(
  (Join-Path $stageDir 'server.js'),
  (Join-Path $stageDir 'public\app.js')
) + (Get-ChildItem -LiteralPath (Join-Path $stageDir 'src') -Recurse -Filter *.js | ForEach-Object { $_.FullName })
foreach ($file in $checkFiles) {
  & $nodeExe --check $file
  if ($LASTEXITCODE -ne 0) { throw "Syntax check failed in staged file: $file" }
}
Test-PilotLaunch -AppDir $stageDir

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
try {
  $archive = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $fixedTime = [DateTimeOffset]::Parse('2026-07-26T00:00:00Z')
    $files = Get-ChildItem -LiteralPath $stageDir -Recurse -File | Sort-Object FullName
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($buildDir.Length + 1).Replace('\', '/')
      $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $fixedTime
      $entryStream = $entry.Open()
      try {
        $inputStream = [System.IO.File]::OpenRead($file.FullName)
        try {
          $inputStream.CopyTo($entryStream)
        } finally {
          $inputStream.Dispose()
        }
      } finally {
        $entryStream.Dispose()
      }
    }
  } finally {
    $archive.Dispose()
  }
} finally {
  $zipStream.Dispose()
}

$extractDir = Join-Path $buildDir 'extract-smoke'
Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
$extractedAppDir = Join-Path $extractDir $stageName
if (-not (Test-Path $extractedAppDir)) { throw "Extracted release directory missing: $stageName" }
Test-PilotLaunch -AppDir $extractedAppDir

$releaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
"$releaseHash  $zipName" | Set-Content -LiteralPath $shaPath -Encoding ASCII

Write-Host "Created $zipPath"
Write-Host "Created $shaPath"
Write-Host "Bundled Node.js $resolvedNodeVersion"
