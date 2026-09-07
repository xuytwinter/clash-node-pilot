$ErrorActionPreference = 'Stop'
$node = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runtime\node.exe'))
$server = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'server.js'))
$stopped = 0
foreach ($candidate in Get-CimInstance Win32_Process -Filter "Name = 'node.exe'") {
  if ($candidate.ExecutablePath -ne $node) { continue }
  # Only the exact launcher command is owned; other scripts using this runtime stay alive.
  $command = [string]$candidate.CommandLine
  $quoted = '^"?' + [regex]::Escape($node) + '"?\s+"' + [regex]::Escape($server) + '"\s*$'
  $unquoted = '^"?' + [regex]::Escape($node) + '"?\s+' + [regex]::Escape($server) + '\s*$'
  if ($command -notmatch $quoted -and $command -notmatch $unquoted) { continue }
  $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
  if (-not $process -or $process.Path -ne $node) { continue }
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($candidate.ProcessId)"
  if (-not $current -or $current.CreationDate -ne $candidate.CreationDate -or $current.CommandLine -ne $command) { continue }
  Stop-Process -InputObject $process
  $stopped++
}
Write-Host "Stopped $stopped Node Pilot instance(s) from this installation."
