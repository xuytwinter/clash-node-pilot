function Resolve-PilotPort([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return '3210' }
  $number = 0
  if ($Value -notmatch '^\d+$' -or -not [int]::TryParse($Value, [ref]$number) -or $number -lt 1 -or $number -gt 65535) {
    throw 'PORT must be an integer between 1 and 65535.'
  }
  return [string]$number
}
