# macOS Application

[Roadmap](ROADMAP.md) | [Project overview](../README.md)

Version 0.4.0 provides a native AppKit menu-bar launcher and local-browser dashboard inside architecture-specific DMGs. Node.js is bundled. macOS 13 is the deployment target; automated application acceptance runs on macOS 15 for Apple Silicon and Intel separately.

## Install

1. Obtain the `macos-arm64.dmg` for Apple Silicon or `macos-x64.dmg` for Intel, plus its `.sha256`, from [Releases](https://github.com/xuytwinter/clash-node-pilot/releases).
2. In the download directory, verify with `shasum -a 256 -c <download-name>.dmg.sha256`.
3. Mount the DMG and drag **Clash Node Pilot.app** to Applications. Eject the disk image before launching the installed copy.
4. Open the app. The dashboard opens in your default browser. The **CN** menu-bar item provides **Open Dashboard**, **Choose Controller Config**, and **Quit**.

The application is ad-hoc signed, without Developer ID or Apple notarization. A downloaded app may be blocked by Gatekeeper. After verifying the source and checksum, use macOS **System Settings > Privacy & Security > Open Anyway** if macOS offers it. Managed devices may prohibit this. Do not disable Gatekeeper globally. This workflow has not been accepted on a physical user Mac.

## Controller and State

Pilot manages an existing local Clash/Mihomo external controller; it does not install a VPN or create subscriptions. Automatic discovery checks common Clash Verge Rev, Nyanpasu and ClashX-style configuration locations, but these are candidates, not verified client-version support claims. When discovery fails, choose the running client's YAML containing `external-controller` and `secret` through the menu. Only the selected path is stored in application preferences; the client file is read, not rewritten.

State defaults to `~/Library/Application Support/ClashNodePilot/state.json`. Back up this file and its `.bak` before upgrades. Application removal retains external state and preferences. Explicit `CLASH_PILOT_STATE`, `CLASH_CONFIG` and `PORT` environment overrides remain available when invoking the bundle executable from a terminal. Finder launches do not inherit shell profile variables.

```sh
PORT=43210 CLASH_CONFIG="$HOME/path/to/config.yaml" \
  "/Applications/Clash Node Pilot.app/Contents/MacOS/ClashNodePilot"
```

Default port is 3210. An occupied port is rejected; Pilot does not stop the occupying application. Reopening an already-running bundle opens its dashboard. Closing the browser keeps the service running. **Quit** terminates only the launcher's child service, with a bounded wait. Quit before replacing the application. Login startup, automatic updates and Keychain pairing are not implemented.

## Build and Acceptance

On a clean macOS checkout with Node.js 22 and Xcode Command Line Tools:

```sh
bash scripts/build-macos.sh
bash scripts/smoke-macos.sh
```

`ARCH=arm64` or `ARCH=x64` must match the runner. Builds verify the official Node archive checksum, package tracked application files, embed source/runtime metadata, ad-hoc sign the bundle, verify its signature and create a DMG with checksum and build manifest. Existing outputs are not overwritten.

[Application acceptance workflow](https://github.com/xuytwinter/clash-node-pilot/actions/workflows/macos.yml) builds on both architectures. Release publication requires both Mac jobs and Windows package acceptance. Core Node tests are separate from packaged application checks.

Remaining acceptance: physical-device Finder/Gatekeeper behavior, real controller-client versions, full configuration-picker interaction, macOS 13/14 and newer-version coverage, cross-version upgrade/rollback, Developer ID signing and notarization. Runner checks do not close these items. Report macOS version, CPU, release checksum and client version when filing a compatibility issue.

## Design History

The older `codex/macos-android-expansion-879c` prototype provided portable ZIP concepts, but predates current API sessions and persistence protection. Its LaunchAgent and Keychain wrappers were not imported. Current native application work retains the current server's authenticated API, job coordination, diagnostics and verified selector writes.
