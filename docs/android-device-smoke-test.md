# Android Device Smoke Test

Use this checklist with the `clash-node-pilot-android-debug-apk` artifact produced by GitHub Actions.

Chinese version: `docs/android-device-smoke-test.zh-CN.md`.

## Install

1. Download the APK artifact from the CI run.
2. Install it on the Android test phone.
3. Allow notification permission when prompted.
4. Do not enable root, ADB automation, AccessibilityService, or private-file access.

## Pairing

1. Start a compatible Clash/Mihomo Android client and enable its local Controller API.
2. Open Clash Node Pilot.
3. Enter an explicit local Controller URL, for example `http://127.0.0.1:9097`.
4. Enter the Controller secret only if the client requires one.
5. Tap Probe and confirm that a Selector group and candidate count are shown.
6. Tap Pair.
7. Switch between Pairing, Selection, and Results; the current screen should not be one long form.
8. Set the background selection interval, for example 3 minutes.
9. Tap Start Speed Test And Select to run a one-shot node selection and Selector switch.
10. Tap Enable Background Selection to keep the foreground service selecting nodes on its interval.

Expected result: the app reports successful pairing with a popup report, node selection either switches to the fastest node or says the fastest node is already active, and the result ranking lists each tested node with its delay. Background selection shows a persistent foreground-service notification.

## Smoke Cases

- Controller reachable: Probe can read `/version` and `/proxies`.
- Node selection: Start Speed Test And Select measures candidates, shows a delay ranking, and changes only a writable Selector group.
- Popup report: Probe, pairing, failures, and node-selection completion are visible in a dialog even if the user has scrolled away from the status area.
- Controller stopped: stop the Clash/Mihomo client; notification reports unavailable and performs no switching.
- Pairing revoked: tap Revoke pairing; notification disappears and stored pairing state is cleared.
- Process death: swipe the app away or let Android reclaim it; starting again should use the stored pairing without asking for the secret again.
- Reboot: after reboot, the foreground service should restart only when a pairing exists.
- Battery restriction: if the system restricts background work, record the exact manufacturer prompt or behavior.

## Evidence To Record

- Phone model, Android version, and client name/version.
- Whether notification permission was granted.
- Controller URL shape, without the secret.
- Pass/fail for each smoke case.
- Any battery optimization prompt or foreground-service warning text.

Do not share Controller secrets, subscription URLs, APK signing material, or private client configuration files.
