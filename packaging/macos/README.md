# macOS app bundle

The repository's `scripts/build-macos.sh` builds `Clash Node Pilot.app` inside an architecture-specific DMG with Node 22 and the server/UI under `Contents/Resources/app`. Run from a clean checkout on macOS with Node 22 and Xcode Command Line Tools:

```sh
bash scripts/build-macos.sh
bash scripts/smoke-macos.sh
```

The launcher requires a free `PORT` (default `3210`) and verifies the child instance's `/api/health` before opening the dashboard. Invalid explicit `CLASH_CONFIG` files produce an error; **Choose Controller Config** stores only the chosen path in `UserDefaults`. The fallback path is `~/Library/Application Support/ClashNodePilot/controller.yaml`.

For headless smoke tests, set `CLASH_PILOT_NO_BROWSER=1`; failures are written to stderr and return a non-zero exit code without presenting a modal dialog. `Quit` sends SIGTERM to the launcher-owned Node PID, waits two seconds, then SIGKILLs only that PID if needed.
