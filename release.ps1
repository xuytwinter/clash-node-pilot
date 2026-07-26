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
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'RELEASE_NOTES.md',
  'server.js',
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
$releaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
"$releaseHash  $zipName" | Set-Content -LiteralPath $shaPath -Encoding ASCII

Write-Host "Created $zipPath"
Write-Host "Created $shaPath"
Write-Host "Bundled Node.js $resolvedNodeVersion"
