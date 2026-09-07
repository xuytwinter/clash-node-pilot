function Resolve-PilotPort([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '3210' }
  $number = 0
  if ($Value -notmatch '^\d+$' -or -not [int]::TryParse($Value, [ref]$number) -or $number -lt 1 -or $number -gt 65535) {
    throw 'PORT must be an integer between 1 and 65535.'
  }
  return [string]$number
}

function Get-PilotServerProcesses([string]$NodePath, [string]$ServerPath, [int]$Port) {
  $node = [IO.Path]::GetFullPath($NodePath)
  $server = [IO.Path]::GetFullPath($ServerPath)
  $commandPattern = '^\s*"?' + [regex]::Escape($node) + '"?\s+"?' + [regex]::Escape($server) + '"?\s*$'
  $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $Port -State Listen -ErrorAction Stop)
  foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'")) {
    if ([string]::IsNullOrWhiteSpace([string]$candidate.ExecutablePath)) { continue }
    if ([string]$candidate.ExecutablePath -ine $node) { continue }
    if ([string]$candidate.CommandLine -notmatch $commandPattern) { continue }
    if (-not ($listeners | Where-Object { [int]$_.OwningProcess -eq [int]$candidate.ProcessId })) { continue }
    $candidate
  }
}
