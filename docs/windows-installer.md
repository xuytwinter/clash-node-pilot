# Windows Installer

The installer is a per-user distribution of the same local-browser application as the portable ZIP. It does not install a proxy core or change proxy subscriptions. Published assets are listed in [Releases](https://github.com/xuytwinter/clash-node-pilot/releases).

## Install and Run

Choose `clash-node-pilot-v<VERSION>-windows-x64-setup.exe` and verify its `.sha256`. Installation defaults to `%LOCALAPPDATA%\Programs\Clash Node Pilot` and does not request administrator privileges. The Start Menu shortcut opens the local dashboard; a desktop shortcut is optional. Installation does not enable autostart or automatically launch the application.

Initial installers are unsigned. The SHA256 verifies file integrity, not publisher identity or SmartScreen reputation. Do not describe these builds as signed Windows releases.

Version 0.4.1 uses the sunglasses-cat icon and a hidden Windows Script Host launcher. VBScript/Windows Script Host must be available; managed systems may disable it. Startup failures produce an error dialog and `launcher.log` beside the state file. A process occupying the requested port is reported, not stopped. Optional Authenticode signing uses a trusted private-key certificate in the build account's certificate store via `CLASH_PILOT_SIGNING_THUMBPRINT`; no such certificate is configured for this release.

## Stop, Upgrade and Uninstall

Closing the browser leaves the local service running. Use the installed Stop Node Pilot shortcut before upgrading or uninstalling. The stop helper only targets the exact bundled runtime and server command belonging to that installation. Other Node scripts and proxy-client processes are not selected.

The installer refuses to replace a running bundled runtime and does not stop processes automatically. It also rejects occupied directories without its installation marker and paths through symbolic links or junctions. Keep the installation in its own directory.

Back up user state before upgrading. Default state remains under `%LOCALAPPDATA%\ClashNodePilot`; a custom `CLASH_PILOT_STATE` remains your responsibility. Uninstall removes installed program files, not user-created state. An unknown newer state schema remains read-only; rolling back the executable does not downgrade that schema.

If an older portable instance already occupies port 3210, stop it through its own process controls before starting the installation, or configure a different `PORT`. Startup verifies both the exact runtime/server command and ownership of the requested listening socket before reusing a service. The new installation's stop helper deliberately does not stop another installation. Remove any manually configured autostart entry from the old location before moving; installation does not migrate such entries implicitly.

## Build and Verify

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File release.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-installer.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-installer.ps1 -SetupPath outputs/clash-node-pilot-v0.4.1-windows-x64-setup.exe
```

The builder checks portable payload checksums and clean source metadata. It obtains a pinned Inno Setup compiler in `work`, without installing the compiler system-wide. Existing output is preserved instead of overwritten. Installer provenance is recorded alongside its checksum.

Lifecycle acceptance uses the actual EXE with `/NOINTEGRATION=1` in a unique temporary directory containing Chinese characters and spaces. This suppresses real user shortcuts and uninstall registration while exercising file installation, same-version reinstall, server startup, process ownership checks and uninstall. CI also supplies `-PreviousSetupPath` with the published v0.3.0 installer after verifying its pinned SHA256. That flow checks replacement with the current version and preservation of external and unmanaged portable state. It does not establish historical runtime-state migration or downgrade compatibility.

Windows runner acceptance also exercises default Start Menu launch/stop links, optional desktop links, uninstall registration and their removal, with Unicode shell-link inspection. It confirms installation does not enable autostart. Evidence: [installer acceptance workflow](https://github.com/xuytwinter/clash-node-pilot/actions/workflows/installer.yml). Real-client migration, older-release downgrades and SmartScreen behavior remain unverified.

Version 0.3.0 to 0.4.0 isolated installation upgrade and desktop integration passed on source `65a9cda`: [acceptance run](https://github.com/xuytwinter/clash-node-pilot/actions/runs/34156504909). This preserves synthetic state files; it does not claim a user's historical runtime-state migration.

See the [delivery roadmap](ROADMAP.md) for remaining gates.
