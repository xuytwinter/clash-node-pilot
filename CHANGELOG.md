# Changelog

## [0.2.0] - Unreleased Candidate

- Require a per-process local session token for API routes other than health and session bootstrap, including read-only APIs.
- Add whitelist-based diagnostics with report-local anonymous indices; timestamps and statistics remain for review before sharing.
- Reset demo history, health, results, locks and cooldown when changing scenes; reject changes during an active job with HTTP 409.
- Make Windows watchdog checks independent of controller availability and stop managing Clash processes.
- Unify PORT handling and quoted launch paths; remove duplicate PowerShell optimization scheduling.
- Use package.json as the default release version, retain old ZIPs, record build SHA and worktree state, and stop release steps on native failures.
- Document compatible-state migration, backup recovery, newer-schema read-only protection and rollback with matching saved state.
- Replace ambiguous benchmark time and false-switch claims with simulated step metrics, explicit baselines and unequal probe budgets; see [methodology](docs/benchmarks.md).
- Use Node.js 22.x as the documented CI-supported runtime.

Validation uses isolated tests and mocks; real-machine upgrade success is not claimed.

## [0.1.0] - 2026-07-26

Preview release for Windows 10/11 x64.

### Added

- Portable Windows x64 package with bundled official Node.js 22.x runtime.
- Local dashboard for Clash/Mihomo node testing and selector switching.
- Current-region recheck, multi-sample latency selection, switch hysteresis, and cross-region fallback only after total regional failure.
- Clash Verge UI proxy-group following, manual pause, monitor-only mode, run history, persistent settings, and node health scoring.
- Configurable region rules and LevelDB `.log`/`.ldb` discovery.
- Automatic discovery for Clash Verge Rev, Clash for Windows, and custom Clash/Mihomo controller configs.
- Safe read-only v2rayN 7.x detection for current node and inventory display.
- Windows startup scripts, two-minute watchdog, optimizer loop, uninstall scripts, CI checks, and security documentation.

### Changed

- Persistent state and logs now live under `%LOCALAPPDATA%\ClashNodePilot` by default.
- `CLASH_PILOT_STATE` remains the highest-priority explicit state-file override.
- First v0.1.0 startup copies legacy `data\state.json` once when the new state file does not exist.

### Notes

- Requires an already running Clash/Mihomo-compatible client for node discovery and switching.
- The HTTP service binds only to `127.0.0.1`.
- Mihomo controller secrets are never returned to the browser, logs, or Release assets.
