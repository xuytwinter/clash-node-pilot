# macOS app bundle

The repository's `scripts/build-macos.sh` builds `ClashNodePilot.app` with the Node 22 runtime and the local server/UI under `Contents/Resources`. Run it on macOS with Xcode Command Line Tools installed:

```sh
./scripts/build-macos.sh
CLASH_PILOT_NO_BROWSER=1 ./dist/ClashNodePilot.app/Contents/MacOS/ClashNodePilot
```

The launcher requires a free `PORT` (default `3210`) and verifies `/api/health` from the child process before opening the dashboard. `CLASH_CONFIG` is passed through only when it points to an existing file; the menu's **Choose Controller Config** stores only that path in `UserDefaults`. The fallback path is `~/Library/Application Support/ClashNodePilot/controller.yaml`.

For headless smoke tests, set `CLASH_PILOT_NO_BROWSER=1`; failures are written to stderr and return a non-zero exit code without presenting a modal dialog. `Quit` sends SIGTERM to the launcher-owned Node PID, waits two seconds, then SIGKILLs only that PID if needed.
