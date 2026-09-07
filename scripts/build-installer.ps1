param(
  [string]$ZipPath,
  [string]$CompilerPath,
  [string]$ExpectedSourceSha
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$installerSourceSha = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read installer source SHA' }
$installerStatus = & git -C $root status --porcelain=v1 --untracked-files=normal
if ($LASTEXITCODE -ne 0) { throw 'Cannot read installer working tree state' }
if ($ExpectedSourceSha -and ($installerSourceSha -ne $ExpectedSourceSha -or $installerStatus)) {
  throw 'Release installer requires clean HEAD matching ExpectedSourceSha'
}
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if (-not $ZipPath) { $ZipPath = Join-Path $root "outputs\clash-node-pilot-v$version-windows-x64-portable.zip" }
$ZipPath = [IO.Path]::GetFullPath($ZipPath)
if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw "Portable ZIP not found: $ZipPath" }
$hashLine = (Get-Content -LiteralPath "$ZipPath.sha256" -Raw).Trim()
if ($hashLine -notmatch '^([a-fA-F0-9]{64})\s+(.+)$') { throw 'Invalid portable checksum file' }
$expectedHash = $Matches[1]
if ($Matches[2] -ne [IO.Path]::GetFileName($ZipPath)) { throw 'Portable checksum filename mismatch' }
$zipHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash
if ($zipHash -ne $expectedHash) { throw 'Portable checksum mismatch' }

function Assert-LocalPath([string]$Path) {
  $target = [IO.Path]::GetFullPath($Path)
  if (-not $target.StartsWith("$root\", [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside workspace: $target" }
  $current = $target
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse point rejected: $current" }
    }
    $parent = Split-Path -Parent $current
    if ($parent -eq $current) { break }
    $current = $parent
  }
  return $target
}

$stage = Assert-LocalPath (Join-Path $root ("work\installer-" + [guid]::NewGuid().ToString('N')))
$outDir = Assert-LocalPath (Join-Path $root 'outputs')
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
  $seen = @{}
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\', '/')
    if ($name -match '(^/|:|(^|/)\.\.?(/|$))' -or $name -match '[\x00-\x1f]') { throw "Unsafe archive entry: $name" }
    if ($seen.ContainsKey($name)) { throw "Duplicate archive entry: $name" }
    $seen[$name] = $true
    $destination = [IO.Path]::GetFullPath((Join-Path $stage $name))
    if (-not $destination.StartsWith("$stage\", [StringComparison]::OrdinalIgnoreCase)) { throw "Archive entry escapes staging: $name" }
    $unixType = ($entry.ExternalAttributes -shr 16) -band 61440
    if ($unixType -eq 40960) { throw "Archive symlink rejected: $name" }
  }
} finally { $archive.Dispose() }
Expand-Archive -LiteralPath $ZipPath -DestinationPath $stage
$apps = @(Get-ChildItem -LiteralPath $stage -Directory)
if ($apps.Count -ne 1) { throw 'Expected exactly one portable application directory' }
$payload = $apps[0].FullName
$package = Get-Content -LiteralPath (Join-Path $payload 'package.json') -Raw | ConvertFrom-Json
$build = Get-Content -LiteralPath (Join-Path $payload 'BUILD-INFO.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $build.version -ne $version) { throw 'Portable package and build versions disagree' }
if ($apps[0].Name -ne "clash-node-pilot-v$version-windows-x64") { throw 'Unexpected portable root directory name' }
if ($build.sourceSha -notmatch '^[a-f0-9]{40}$' -or $build.workingTree -ne 'clean' -or @($build.sourceStatus).Count -ne 0) {
  throw 'Installer requires a clean portable source SHA'
}
if ($ExpectedSourceSha -and $build.sourceSha -ne $ExpectedSourceSha) { throw 'Portable source SHA mismatch' }
$sourcePackage = & git -C $root show "$($build.sourceSha):package.json"
if ($LASTEXITCODE -ne 0) { throw 'Portable source commit is not available locally; fetch its history first' }
if (($sourcePackage | ConvertFrom-Json).version -ne $version) { throw 'Source commit package version mismatch' }
foreach ($file in @('runtime\node.exe', 'runtime\NODE-LICENSE', 'runtime\NODE-RUNTIME.txt', 'server.js', 'start-clash-node-pilot.cmd', 'start-pilot.ps1', 'startup-watchdog.ps1', 'windows-common.ps1', 'public\index.html', 'src\core\security.js', 'src\core\state.js')) {
  if (-not (Test-Path -LiteralPath (Join-Path $payload $file) -PathType Leaf)) { throw "Missing payload file: $file" }
}
foreach ($item in Get-ChildItem -LiteralPath $payload -Recurse -Force) {
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Payload reparse point rejected: $($item.FullName)" }
  if ($item.Name -in @('.git', 'node_modules', 'state.json', '.clash-node-pilot-install') -or $item.Extension -in @('.log', '.zip')) { throw "Private or nested payload rejected: $($item.Name)" }
}
$nodeVersion = & (Join-Path $payload 'runtime\node.exe') --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne $build.nodeVersion) { throw 'Bundled runtime version mismatch' }

if (-not $CompilerPath) {
  $toolsDir = Assert-LocalPath (Join-Path $root 'work\installer-tools')
  New-Item -ItemType Directory -Path $toolsDir -Force | Out-Null
  $compilerZip = Join-Path $toolsDir 'inno-6.7.3.zip'
  $compilerRoot = Join-Path $stage 'compiler'
  if (-not (Test-Path -LiteralPath $compilerZip)) {
    Invoke-WebRequest 'https://api.nuget.org/v3-flatcontainer/tools.innosetup/6.7.3/tools.innosetup.6.7.3.nupkg' -OutFile $compilerZip
  }
  if ((Get-FileHash -LiteralPath $compilerZip -Algorithm SHA256).Hash -ne 'F780898E402FF80612CC8D9FCB8C6E02932BD1CB4C900FFDAA31F9341CFB49F4') { throw 'Inno Setup tool archive checksum mismatch' }
  Expand-Archive -LiteralPath $compilerZip -DestinationPath $compilerRoot
  $CompilerPath = Join-Path $compilerRoot 'tools\ISCC.exe'
}
$CompilerPath = [IO.Path]::GetFullPath($CompilerPath)
$signature = Get-AuthenticodeSignature -LiteralPath $CompilerPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Pyrsys B\.V\.') { throw 'Inno Setup compiler signature is invalid or unexpected' }
$setup = Join-Path $outDir "clash-node-pilot-v$version-windows-x64-setup.exe"
if (Test-Path -LiteralPath $setup) { throw "Installer already exists; preserve or move it before rebuilding: $setup" }
$compileOutput = & $CompilerPath "/DAppVersion=$version" "/DPayloadDir=$payload" "/DInstallerOutput=$outDir" (Join-Path $root 'packaging\windows\clash-node-pilot.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compiler failed' }
$engineLine = $compileOutput | Select-String '^Compiler engine version: (.+)$' | Select-Object -First 1
if (-not $engineLine) { throw 'Compiler did not report its engine version' }
$compilerVersion = $engineLine.Matches[0].Groups[1].Value.Trim() -replace '^Inno Setup ', ''
if ($compilerVersion -ne '6.7.3') { throw "Expected Inno Setup 6.7.3, found $compilerVersion" }
if (-not (Test-Path -LiteralPath $setup)) { throw 'Installer output missing' }
$setupHash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
"$setupHash  $([IO.Path]::GetFileName($setup))" | Set-Content -LiteralPath "$setup.sha256" -Encoding ASCII
@{ version=$version; portableSha256=$zipHash.ToLowerInvariant(); sourceSha=$build.sourceSha; installerSourceSha=$installerSourceSha; installerWorkingTree=$(if ($installerStatus) { 'dirty' } else { 'clean' }); installerSourceStatus=@($installerStatus); compilerVersion=$compilerVersion; signed=$false } |
  ConvertTo-Json | Set-Content -LiteralPath "$setup.build.json" -Encoding UTF8
Write-Host "Created unsigned installer: $setup"
Write-Host "Preserved isolated build staging: $stage"
