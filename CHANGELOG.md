# Changelog

## Unreleased

- Added stable multi-sample latency selection with switch hysteresis.
- Added current-region recheck and cross-region fallback only after total regional failure.
- Added Clash Verge UI proxy-group following, manual pause, monitor-only mode, and run history.
- Added configurable region rules and LevelDB `.log`/`.ldb` discovery.
- Added Windows auto-start, uninstall, release tooling, and security documentation.
- Persisted history, settings, manual locks, and node health across service restarts.
- Added configurable sampling, switch threshold, and manual-protection settings.
- Added persistent failure-rate health scoring and recent latency visualization.
- Added automatic discovery and selection of Clash Verge, Clash for Windows, and custom Clash/Mihomo controllers.
- Added safe read-only v2rayN 7.x detection for the current node, historical delay, and inventory size.
- Replaced fragile direct logon tasks with a network-aware Mihomo health watchdog.
- Added automatic recovery for the case where the Clash Verge window exists but the core/controller is unavailable.
