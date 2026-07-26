# macOS Preview

Clash Node Pilot for macOS is an unsigned companion preview for users who already run a Clash/Mihomo-compatible macOS client. It does not bundle Mihomo, does not manage subscriptions, and does not automate any client GUI.

## Download

Choose the artifact that matches the Mac:

- Apple Silicon: `clash-node-pilot-v0.1.0-darwin-arm64-portable.zip`
- Intel: `clash-node-pilot-v0.1.0-darwin-x64-portable.zip`

Verify the checksum before first launch:

```sh
shasum -a 256 clash-node-pilot-v0.1.0-darwin-arm64-portable.zip
cat clash-node-pilot-v0.1.0-darwin-arm64-portable.zip.sha256
```

## Unsigned Preview Launch

Because the first macOS Preview is unsigned and not notarized, Gatekeeper may block a double-click launch. Use Finder to open the extracted folder, Control-click `start-clash-node-pilot.command`, choose Open, and confirm the unsigned preview prompt.

Release artifacts for macOS should be built on a macOS runner with `release-macos.sh` so the bundled `runtime/node` and launcher preserve executable permissions.

## Client Compatibility

The preview tries documented local config locations for maintained macOS clients and then falls back to manual Controller pairing. Pairing accepts only explicit local Controller URLs such as `http://127.0.0.1:9097`.

Secrets are stored in macOS Keychain by the local Node service. They are never returned by `/api/status`, `/api/pairings`, logs, or release notes.

## Login And Background

The macOS adapter can generate a LaunchAgent plist through `src/platform/macos.js`. Install it only after confirming the extracted app path and port. The Windows registry, PowerShell watchdog, and scheduled-task scripts are not used on macOS.

## Rollback

Quit the terminal running Node Pilot, remove the extracted folder, and delete any `com.clash-node-pilot.service.plist` file you installed under `~/Library/LaunchAgents`. Removing a manual pairing through `DELETE /api/pairings/{id}` also removes the matching Keychain item.
