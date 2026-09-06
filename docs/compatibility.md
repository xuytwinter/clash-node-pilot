# Compatibility

## Supported Release Target

| Area | v0.1.0 scope |
| --- | --- |
| Operating system | Windows 10/11 x64 |
| Package type | Portable zip |
| Runtime | Bundled official Node.js 22.x Windows x64 |
| UI | Local browser dashboard at `127.0.0.1` |
| Source development | Node.js 18 or newer |

No macOS, Linux, Android, iOS, browser extension, Electron shell, installer, or mobile package is shipped in v0.1.0.

## Proxy Client Support

| Client | Support level | Notes |
| --- | --- | --- |
| Clash Verge Rev | Writable Mihomo selector support | Reads local config and can detect the selected UI group when local storage is readable. |
| Clash for Windows | Writable Mihomo selector support | Uses the local config file and Mihomo-compatible external controller. |
| Other Clash/Mihomo clients | Custom config support | Set `CLASH_CONFIG` to a config containing `external-controller` and optional `secret`. |
| v2rayN 7.x | Read-only detection | Shows detected current node information when available. v0.1.0 does not edit v2rayN data or restart Xray. |

## Required Mihomo Controller Surface

The configured client must expose a local controller with these compatible endpoints:

- `GET /version`
- `GET /proxies`
- `GET /proxies/:node/delay?timeout=...&url=...`
- `PUT /proxies/:selector`

The controller must be reachable from the local machine. Remote controller URLs are intentionally rejected.

## Path and State Behavior

- The portable folder may contain spaces or Chinese characters.
- Runtime state and logs live under `%LOCALAPPDATA%\ClashNodePilot` by default.
- `CLASH_PILOT_STATE` has highest priority for custom state-file location.
- On first v0.1.0 startup, legacy repository-local `data\state.json` is copied once when the new state file does not exist.
- `npm run smoke:package` extracts the portable zip to a temporary path with spaces and Chinese characters and launches the bundled demo with the bundled runtime.

## Network Probe Scope

Manual probe URLs are limited to trusted HTTPS endpoints. Connectivity heal uses fixed trusted targets to distinguish node failure from likely target or common probe failure. These probes do not create any product integration with the probed services.
