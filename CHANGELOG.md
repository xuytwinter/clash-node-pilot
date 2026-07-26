# Changelog

## Unreleased

- Extracted shared Controller, optimizer, region, capability, and diagnostic modules from the Windows service.
- Added fake Mihomo Controller tests for authenticated inventory, delay checks, and Selector switching.
- Added macOS Preview adapters, manual local Controller pairing, Keychain-backed secret storage, LaunchAgent plist generation, and darwin arm64/x64 portable packaging scripts.
- Added Android companion source with non-root pairing, Android Keystore-backed storage, foreground service notification, boot/package restart handling, and pairing revocation.
- Added cross-platform CI for Node core tests and Android source guards.

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
