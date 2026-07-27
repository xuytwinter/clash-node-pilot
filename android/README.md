# Android Companion Preview

This directory contains the native Android companion source for the first non-root Preview. It is intentionally a companion, not a VPN client and not a Mihomo distribution.

## Scope

- No root, ADB, AccessibilityService, private app files, GUI automation, or same-signature/shared-UID assumptions.
- One explicit pairing screen for a local Clash/Mihomo Controller URL and optional secret.
- Secret storage uses Android Keystore-backed AES/GCM encryption with app-private SharedPreferences ciphertext.
- A foreground service keeps a visible notification while it measures candidate nodes and switches the selected Selector through the standard Controller API.
- Manual "optimize now" supports an optional target Selector group and optional node-name keyword filter.
- Boot and package-replaced receivers restart only after a pairing already exists.
- Revoking pairing clears local pairing state and stops the foreground service.

## Build Preparation

Install Android Studio or a compatible Android SDK plus Gradle, then run from the repository root:

```sh
gradle -p android :app:assembleDebug
```

For a GitHub Release signed APK, provide these environment variables before `:app:assembleRelease`:

```sh
export ANDROID_KEYSTORE_PATH=/secure/path/node-pilot-release.jks
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
gradle -p android :app:assembleRelease
```

Do not commit keystores, passwords, Controller secrets, subscription URLs, or generated APKs.

## Remaining Device Validation

The code path still requires real Android validation for notification permission behavior, battery optimization prompts, reboot persistence, process death, and the exact pairing capability of the user's chosen Android Clash/Mihomo client.

When GitHub Actions runs, download the `clash-node-pilot-android-debug-apk` artifact and follow `docs/android-device-smoke-test.md` on a real phone.
