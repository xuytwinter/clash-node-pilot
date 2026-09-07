# Changelog

## [0.4.0] - 2026-09-08

- Add Apple Silicon and Intel macOS application bundles and DMGs with bundled Node.js, source metadata and checksums.
- Add a native menu-bar launcher with controller-file selection, instance health verification and owned-service shutdown.
- Isolate macOS configuration discovery and Application Support state paths from Windows integrations.
- Gate combined Windows/macOS publication on package lifecycle acceptance for each architecture.
- Verify Windows startup ownership against the process and listening socket, and add actual v0.3.0 installer upgrade acceptance.
- Document ad-hoc macOS signing and remaining notarization, physical-device and real-client acceptance limits.

## [0.3.0] - 2026-09-07

- Add a public bilingual delivery roadmap linked from both READMEs.
- Add an unsigned per-user Windows installer alongside the portable ZIP, with Start Menu launch/stop entries and optional desktop shortcuts.
- Verify real isolated installation, same-version reinstall, state-preserving uninstall, Unicode shortcuts and runner desktop integration.
- Reject running-runtime replacement and linked installation directories without stopping other applications.
- Track macOS application/DMG delivery and its remaining platform checks separately.

## [0.2.0] - 2026-09-07

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
