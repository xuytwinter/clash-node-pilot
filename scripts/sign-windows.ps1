param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Thumbprint = $env:CLASH_PILOT_SIGNING_THUMBPRINT,
  [switch]$RequireSigned
)
$ErrorActionPreference = 'Stop'
$target = (Resolve-Path -LiteralPath $Path).Path
if ($Thumbprint) {
  if ($Thumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid signing certificate thumbprint.' }
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$Thumbprint" -ErrorAction Stop
  if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -le (Get-Date)) { throw 'Signing certificate must have a private key and be unexpired.' }
  $result = Set-AuthenticodeSignature -LiteralPath $target -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  if ($result.Status -ne 'Valid' -or -not $result.TimeStamperCertificate) { throw 'Signing or trusted timestamp validation failed.' }
}
$signature = Get-AuthenticodeSignature -LiteralPath $target
if (($RequireSigned -or $Thumbprint) -and $signature.Status -ne 'Valid') { throw 'A valid trusted Authenticode signature is required.' }
[pscustomobject]@{
  signed = ($signature.Status -eq 'Valid')
  signatureStatus = [string]$signature.Status
  signer = $(if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null })
  timestamped = ($null -ne $signature.TimeStamperCertificate)
}
