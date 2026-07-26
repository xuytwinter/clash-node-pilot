# Clash Node Pilot v0.1.0 Preview

## Cross-platform Preview branch

The next Preview branch adds shared Controller/optimizer core, macOS unsigned portable artifacts for Apple Silicon and Intel, and Android companion source prepared for signed APK builds. Android device validation and signed release material are still required before publishing an APK.

This is the first Preview release for Windows 10/11 x64.

## Supported Scope

- Windows 10/11 x64 only.
- Portable zip only: no Setup.exe, no Electron shell, no macOS, no mobile build.
- Requires an already running Clash/Mihomo-compatible client.
- The local service binds to `127.0.0.1:3210`.

## Three-Step Use

1. Download `clash-node-pilot-v0.1.0-windows-x64-portable.zip`.
2. Extract it to any local folder.
3. Double-click `start-clash-node-pilot.cmd`.

The package includes official Node.js 22.x for Windows x64, so users do not need Git, `npm install`, or a preinstalled Node.js runtime.

## Upgrade

Extract the new package over the old folder or into a new folder, then start it again. Runtime state and logs are stored under `%LOCALAPPDATA%\ClashNodePilot` by default, so they survive folder replacement.

## Uninstall Startup Entries

Run this from the extracted folder:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\uninstall-pilot-autostart.ps1
```

If administrator scheduled tasks were installed, run `uninstall-autostart.ps1` from an elevated PowerShell window.

## Known Limitations

- Clash Node Pilot does not start or configure your proxy subscription.
- v2rayN support is read-only in v0.1.0.
- The app only controls Mihomo-compatible `Selector` groups.

## SHA256 Verification

```powershell
Get-FileHash -Algorithm SHA256 .\clash-node-pilot-v0.1.0-windows-x64-portable.zip
Get-Content .\clash-node-pilot-v0.1.0-windows-x64-portable.zip.sha256
```
