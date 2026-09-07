param([string]$Port = $env:PORT)
# Compatibility entry point for old startup registrations; Node owns the loop.
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'startup-watchdog.ps1') -Port $Port
