# Clash Node Pilot v0.2.0 Preview

Windows 10/11 x64 portable preview with official Node.js 22.x bundled. Requires an already-running compatible Clash/Mihomo controller for real node operations; v2rayN remains read-only.

## Changes

- Local session tokens protect API requests, including status and diagnostics.
- Diagnostic exports contain only whitelist fields with report-local anonymous identifiers. Timings and statistics remain; review before sharing.
- Demo scenario changes reset runtime history, health, results, locks and cooldown; active jobs return HTTP 409.
- Windows startup uses consistent PORT handling and quoted paths. The watchdog checks only Node Pilot health and does not terminate Clash. Node handles automatic scheduling without a second PowerShell optimizer loop.
- Build metadata records source SHA and working-tree status. Native command failures stop build and publication.
- Synthetic benchmarks now report simulated steps, probe costs and policy tradeoffs. [Budgets are unequal](docs/benchmarks.md); these are not real internet recovery measurements.

Manual tests rank single-run latency. Automatic optimization incorporates historical health, repeated samples, threshold and cooldown. Selector changes use PUT followed by readback before confirmed success is reported.

## Start

1. Obtain `clash-node-pilot-v0.2.0-windows-x64-portable.zip` and its `.sha256`.
2. Verify the SHA256 and extract to a separate local folder.
3. Run `start-clash-node-pilot.cmd`.

Default URL: `http://127.0.0.1:3210`. Set `PORT` for a different port. The package requires neither Git nor npm install nor a preinstalled Node runtime.

## Upgrade and Rollback

Stop the old Node Pilot instance and back up the state file plus its `.bak` before starting the new package. State defaults to `%LOCALAPPDATA%\ClashNodePilot\state.json`; preserve any custom `CLASH_PILOT_STATE`. Reinstall startup entries from the new application folder.

Compatible older state is sanitized and migrated. Invalid state is preserved and a valid backup is used when possible. A newer unknown schema disables state writes and mutating actions. Roll back using the older application with its matching pre-upgrade state copy at a separate path, rather than overwriting newer state. Isolated recovery tests do not establish a verified upgrade on a user's real machine.

## API and Limits

Get `{token}` from `GET /api/session`, then send `x-pilot-session: <token>` for every other API route except `/api/health`. JSON POST also requires `Content-Type: application/json`. Same-user malicious local processes are outside this security boundary.

No installer, Electron, mobile or non-Windows package is included. Only compatible writable selectors can be changed; proxy subscriptions are not configured.

## Verification and Startup Removal

```powershell
Get-FileHash -Algorithm SHA256 .\clash-node-pilot-v0.2.0-windows-x64-portable.zip
Get-Content .\clash-node-pilot-v0.2.0-windows-x64-portable.zip.sha256
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

Use elevated PowerShell to remove administrator-installed scheduled tasks when needed.
