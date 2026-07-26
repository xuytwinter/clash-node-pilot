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

$cacheDir = Join-Path $root 'work/node-runtime-cache'
$buildDir = Join-Path $root 'work/release-macos'
$outDir = Join-Path $root 'outputs'
New-Item -ItemType Directory -Path $cacheDir, $buildDir, $outDir -Force | Out-Null
Get-ChildItem -LiteralPath $outDir -Filter "clash-node-pilot-v$Version-darwin-*.zip*" -File -ErrorAction SilentlyContinue | Remove-Item -Force

$checksumPath = Join-Path $cacheDir 'SHASUMS256.txt'
Invoke-WebRequest -Uri "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -OutFile $checksumPath

$items = @(
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'RELEASE_NOTES.md',
  'server.js',
  'regions.json',
  'src',
  'public',
  'docs',
  'start-clash-node-pilot.command'
)

foreach ($arch in @('arm64', 'x64')) {
  $nodeBaseName = "node-v$NodeVersion-darwin-$arch"
  $nodeArchiveName = "$nodeBaseName.tar.gz"
  $nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeArchiveName"
  $downloadPath = Join-Path $cacheDir $nodeArchiveName
  if (-not (Test-Path $downloadPath)) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $downloadPath
  }
  $expected = (Select-String -LiteralPath $checksumPath -Pattern "\s$([regex]::Escape($nodeArchiveName))$").Line.Split(' ')[0]
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $downloadPath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) {
    throw "Node runtime checksum mismatch for $nodeArchiveName"
  }

  $stageName = "clash-node-pilot-v$Version-darwin-$arch"
  $stageDir = Join-Path $buildDir $stageName
  Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
  tar -xzf $downloadPath -C $buildDir
  $nodeRoot = Join-Path $buildDir $nodeBaseName
  $runtimeDir = Join-Path $stageDir 'runtime'
  New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $nodeRoot 'bin/node') -Destination (Join-Path $runtimeDir 'node')
  foreach ($licenseFile in @('LICENSE', 'README.md', 'CHANGELOG.md')) {
    $source = Join-Path $nodeRoot $licenseFile
    if (Test-Path $source) {
      Copy-Item -LiteralPath $source -Destination (Join-Path $runtimeDir "NODE-$licenseFile")
    }
  }
  @"
Clash Node Pilot $Version macOS Preview runtime
Node.js: v$NodeVersion
Architecture: darwin-$arch
Source: $nodeUrl
Node archive SHA256: $actual
Unsigned preview: yes
"@ | Set-Content -LiteralPath (Join-Path $runtimeDir 'NODE-RUNTIME.txt') -Encoding UTF8

  foreach ($item in $items) {
    $source = Join-Path $root $item
    if (-not (Test-Path $source)) { throw "Required release file missing: $item" }
    Copy-Item -LiteralPath $source -Destination $stageDir -Recurse
  }

  $zipName = "$stageName-portable.zip"
  $zipPath = Join-Path $outDir $zipName
  Compress-Archive -Path $stageDir -DestinationPath $zipPath -Force
  $releaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
  "$releaseHash  $zipName" | Set-Content -LiteralPath "$zipPath.sha256" -Encoding ASCII
  Remove-Item -LiteralPath $nodeRoot -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Created $zipPath"
  Write-Host "Created $zipPath.sha256"
}
