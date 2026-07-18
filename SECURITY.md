# Security Policy

## Scope

Clash Node Pilot is intended to run on the local machine. The HTTP server binds to `127.0.0.1` and reads the Mihomo controller secret from the local Clash Verge configuration at runtime.

The secret is never returned by the API and is never written to the browser, Git history, or the optimizer log.

## Reporting a vulnerability

Please open a private GitHub Security Advisory for this repository. Do not include controller secrets, subscription URLs, or personal configuration files in an issue.

## Operational boundary

The tool switches only the selected Mihomo `Selector` group. It does not edit subscription files or publish proxy credentials.
