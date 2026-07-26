# Compatibility Matrix

Clash Node Pilot is a companion for existing Clash/Mihomo clients. The compatibility contract is the standard Clash/Mihomo Controller API.

| Platform | Client | Discovery | Switching | Credential storage | Notes |
| --- | --- | --- | --- | --- | --- |
| Windows | Clash Verge Rev | Known config path | Supported | Existing local config read | v0.1.0 behavior preserved |
| Windows | Clash for Windows | Known config path | Supported | Existing local config read | v0.1.0 behavior preserved |
| Windows | v2rayN | Process/config read | Read-only | Not applicable | Diagnostics only |
| macOS Preview | Clash Verge Rev | Known config path | Supported when Controller API is enabled | Keychain for manual pairings | Unsigned preview |
| macOS Preview | Clash Nyanpasu | Known config path | Supported when Controller API is enabled | Keychain for manual pairings | Fixture-tested adapter path |
| macOS Preview | ClashX Meta | Known config path | Supported when Controller API is enabled | Keychain for manual pairings | Fixture-tested adapter path |
| macOS Preview | Unknown compatible client | Guided local Controller pairing | Supported after pairing | Keychain | No GUI automation |
| Android Preview | Compatible client exposing Controller API | Guided pairing | Supported after pairing | Android Keystore-backed storage | Non-root companion |
| Any | Client without Controller API | Not supported | Not supported | Not applicable | Diagnostic guidance only |

Unsupported approaches: root, ADB, AccessibilityService, private file edits, GUI click automation, same-signature/shared-UID assumptions, bundled VPN, bundled Mihomo, and subscription management.
