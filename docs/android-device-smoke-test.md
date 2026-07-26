# Android Device Smoke Test

Use this checklist with the `clash-node-pilot-android-debug-apk` artifact produced by GitHub Actions.

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
5. Tap Pair and start.

Expected result: the app reports successful pairing and shows a persistent foreground-service notification.

## Smoke Cases

- Controller reachable: notification says the Controller is reachable.
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
