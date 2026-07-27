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
7. Tap Optimize Now for a one-shot delay test and Selector switch.
8. Tap Start Auto to keep the foreground service optimizing on its interval.

Expected result: the app reports successful pairing, one-shot optimization either switches to the fastest node or says the fastest node is already active, and Start Auto shows a persistent foreground-service notification.

## Smoke Cases

- Controller reachable: Probe can read `/version` and `/proxies`.
- Optimization: Optimize Now measures candidates and changes only a writable Selector group.
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
