# macOS External Smoke Test

Use this checklist with the `clash-node-pilot-macos-preview-zips` artifact produced by GitHub Actions.

Chinese version: `docs/macos-external-smoke-test.zh-CN.md`.

## Install

1. Choose the zip for the test machine:
   - Apple Silicon: `darwin-arm64`
   - Intel: `darwin-x64`
2. Verify the matching `.sha256` file:

```sh
shasum -a 256 clash-node-pilot-v0.1.0-darwin-arm64-portable.zip
cat clash-node-pilot-v0.1.0-darwin-arm64-portable.zip.sha256
```

3. Extract the zip.
4. Control-click `start-clash-node-pilot.command`, choose Open, and approve the unsigned Preview prompt.

## Smoke Cases

- Launch: terminal starts Node Pilot and prints a local `127.0.0.1` URL.
- Web UI: browser opens the local dashboard.
- Manual pairing: pair only to a local fake or isolated Controller URL.
- Secret boundary: `/api/pairings` lists only id, name, and Controller URL; it must not return the secret.
- Quit: closing the terminal stops Node Pilot without altering Clash/Mihomo configuration.

## Evidence To Record

- Mac model, CPU architecture, and macOS version.
- Which artifact was tested.
- Gatekeeper prompt behavior.
- Pass/fail for each smoke case.
- Any Keychain prompt text, without sharing secrets.

The Preview is unsigned and not notarized. Do not claim App Store, notarization, or physical-device support until this checklist has passed on real Apple Silicon and Intel machines.
