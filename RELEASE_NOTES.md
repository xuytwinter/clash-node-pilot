# Clash Node Pilot v0.4.0

Native macOS menu-bar application and Windows per-user installer, both with a bundled Node.js 22 runtime and the existing local-browser dashboard. Requires an already-running Clash/Mihomo local controller for real node operations.

## Downloads

| System | Asset |
| --- | --- |
| Windows 10/11 x64 | `clash-node-pilot-v0.4.0-windows-x64-setup.exe` |
| Windows x64 portable | `clash-node-pilot-v0.4.0-windows-x64-portable.zip` |
| macOS 13+ Apple Silicon | `clash-node-pilot-v0.4.0-macos-arm64.dmg` |
| macOS 13+ Intel | `clash-node-pilot-v0.4.0-macos-x64.dmg` |

Each package has a SHA256 file. Installer and DMG build manifests record the source commit and signing status. No Git, npm install or preinstalled Node runtime is required.

## Changes

- Add a native macOS menu-bar launcher, controller configuration file picker, bounded startup and owned-process shutdown.
- Verify the launched service's instance identifier before opening its dashboard; handle repeated launch and occupied ports.
- Store macOS state in `~/Library/Application Support/ClashNodePilot`; retain explicit `CLASH_PILOT_STATE` and `CLASH_CONFIG` overrides.
- Build and exercise Apple Silicon and Intel DMGs on their matching macOS runners, alongside Windows installer lifecycle checks. Publication waits for every package gate.
- Retain local API sessions, redacted diagnostics, coordinated jobs, state recovery, and selector PUT followed by readback.

## Install and Quit

On Windows, run Setup and use the Start Menu launch/stop entries, or extract the portable ZIP and run `start-clash-node-pilot.cmd`. On macOS, mount the matching DMG, drag **Clash Node Pilot.app** to Applications, then open it. The **CN** menu-bar item provides **Open Dashboard**, **Choose Controller Config**, and **Quit**. If discovery fails, select the running client's YAML containing its local external controller and secret.

The dashboard opens at `http://127.0.0.1:3210`. Closing a browser tab does not stop the service. Quit from the Mac menu or use Windows **Stop Clash Node Pilot** before upgrading.

## Verification Limits

Windows Setup is unsigned. macOS bundles use ad-hoc signing, without Developer ID or Apple notarization. Checksums verify file integrity, not publisher identity. Gatekeeper and SmartScreen may block or warn on downloaded applications; see [macOS installation guidance](https://github.com/xuytwinter/clash-node-pilot/blob/main/docs/macos-delivery.md). There is no automatic update or macOS login startup.

CI exercises real packages in isolated runners. It does not establish physical-device, every supported OS version, or real Clash-client compatibility. macOS 13 is the build deployment target; the application runners use macOS 15. Real-device Gatekeeper and client acceptance remain open, so this release does not claim signed, universally verified production support.

## State and Rollback

Back up the state file and its `.bak` before upgrading. Windows defaults to `%LOCALAPPDATA%\ClashNodePilot\state.json`; macOS uses the path above. Removing the application retains external user state. Use a matching backup and separate state path when rolling back; a newer unknown schema disables writes. Cross-version installer downgrade and real-client upgrades remain unverified.

[Roadmap](https://github.com/xuytwinter/clash-node-pilot/blob/main/docs/ROADMAP.md) | [Windows installer details](https://github.com/xuytwinter/clash-node-pilot/blob/main/docs/windows-installer.md)
