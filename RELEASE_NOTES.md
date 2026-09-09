# Clash Node Pilot v0.4.2

## v0.4.2 update

- Windows Setup automatically stops its own installed server before updating, preserving settings and unrelated processes. Reopen the application after updating.
- Disabled scheduled tasks no longer appear as enabled startup; the current single Run entry is detected correctly.
- Administrator startup permission errors are no longer reported as Clash Verge connection failures.
- Both READMEs now display the sunglasses-cat icon and release navigation.

Legacy source-checkout administrator tasks are not automatically migrated. If they occupy port 3210, disable the old Startup, Watchdog and Optimizer tasks with administrator privileges, then stop the verified old server.

The following v0.4.1 features and signing limitations also apply to v0.4.2. Download filenames use v0.4.2 for this release.

Fix Windows desktop startup and adopt the sunglasses-cat icon across installers, shortcuts, macOS bundles and the browser tab.

## Fixes

- Installed Windows shortcuts use a hidden launcher instead of leaving a command window open.
- Detect an occupied local port even when the other service returns HTTP 404 for health. Report the conflict without stopping or adopting that service.
- Startup failures show an error dialog and write `launcher.log` beside the state file. Hidden launcher exit codes propagate to acceptance tests.
- Exercise the installed VBS launch chain during real installer acceptance, in addition to session, process ownership, upgrade and uninstall checks.
- Add optional trusted Authenticode certificate signing and record the actual signing status in installer build metadata.

## Downloads

| System | Package |
| --- | --- |
| Windows 10/11 x64 | `clash-node-pilot-v0.4.2-windows-x64-setup.exe` |
| Windows x64 portable | `clash-node-pilot-v0.4.2-windows-x64-portable.zip` |
| macOS 13+ Apple Silicon | `clash-node-pilot-v0.4.2-macos-arm64.dmg` |
| macOS 13+ Intel | `clash-node-pilot-v0.4.2-macos-x64.dmg` |

All packages bundle Node.js 22.23.1 and include SHA256 checksums. Windows Setup and Mac DMGs have build provenance manifests. Stop the existing Pilot instance before upgrading and back up `state.json` plus `.bak`. Closing the browser does not stop the service.

Windows users can launch from the Start Menu; use **Stop Clash Node Pilot** before uninstalling. Mac users mount the matching DMG, drag the app into Applications, and use the **CN** menu to open the dashboard or quit. Real node operations require an existing local Clash/Mihomo controller.

## Signing and Verification Limits

This release's Windows installer is **unsigned** because no trusted signing certificate is configured. SmartScreen or download warnings may still appear. The new icon and hidden launcher do not establish publisher reputation. Mac bundles remain ad-hoc signed, without Developer ID or Apple notarization.

Package acceptance runs on Windows and separate macOS 15 Apple Silicon/Intel runners. macOS 13 is the build target, not a claim that every supported OS/client combination has been tested. Physical Mac Gatekeeper acceptance, real-client version matrices and historical state downgrades remain open.

[Roadmap](https://github.com/xuytwinter/clash-node-pilot/blob/main/docs/ROADMAP.md) | [Windows guide](https://github.com/xuytwinter/clash-node-pilot/blob/main/docs/windows-installer.md)
