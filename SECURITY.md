# Security Policy

## Scope

Clash Node Pilot is intended to run on the local machine. The HTTP server binds to `127.0.0.1` and reads the Mihomo controller secret from the local Clash Verge configuration at runtime.

The secret is never returned by the API and is never written to the browser, Git history, or the optimizer log. Manual macOS pairings store the Controller secret in Keychain through the local service; Android stores pairing material with Android Keystore-backed encryption. The local-file secret store is reserved for isolated tests, and the manual pairing API is disabled on production platforms that do not have an OS-backed secure store.

State-changing local API requests reject cross-origin browser writes before they can trigger Controller operations.

## Reporting a vulnerability

Please open a private GitHub Security Advisory for this repository. Do not include controller secrets, subscription URLs, or personal configuration files in an issue.

## Operational boundary

The tool switches only the selected Mihomo `Selector` group through the standard Controller API. It does not edit subscription files, automate client GUIs, use root or AccessibilityService privileges, or publish proxy credentials.
