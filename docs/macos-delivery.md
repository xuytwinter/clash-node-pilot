# macOS Delivery Plan

[Delivery roadmap](ROADMAP.md) | [Project overview](../README.md)

macOS delivery is planned work. The current supported release has no macOS application or DMG package, and this audit provides no real-Mac acceptance evidence. No delivery date is promised. The first target is an Apple Silicon preview; Intel requires separate packaging and acceptance before it is listed as supported.

## Source Audit

The reusable prototype is `origin/codex/macos-android-expansion-879c` at commit `6957326660045a6b9ee566e3eb663bd79d7244a4`, resolved with `git rev-parse`. The audit inspected source only: it did not build, install or run a macOS artifact.

That branch contains macOS configuration candidates, a LaunchAgent adapter, a Keychain wrapper and scripts that assemble Apple Silicon and Intel portable ZIPs. It does not contain an application bundle, a DMG build or a native application launcher.

The branch must not be merged wholesale. Its older server predates the current session authorization, job coordination and state-recovery behavior; its persistence code suppresses save failures. It also contains Android work outside this milestone. Selected components need adaptation to the current server and tests.

## Implementation Sequence

Platform foundation is implemented on the macOS preview branch: macOS state uses `~/Library/Application Support/ClashNodePilot`, explicit state/config overrides remain supported, configuration discovery uses macOS candidates, and Windows WebView/v2rayN process discovery is excluded on macOS. These candidates are not verified client-version support claims. The native launcher and DMG build remain unimplemented; no macOS download is published.

| Files | Reuse and required work |
| --- | --- |
| `release-macos.sh` | Reuse official Node archive downloads, SHA256 verification and license inclusion. Generate an `.app` containing the matching runtime, then a DMG on macOS. Record runtime version, architecture and source commit; validate executable permissions and deployment target. |
| New macOS launcher and `Info.plist` | Define bundle identity and version. Start the bundled service, wait for its health endpoint, and open the local dashboard. Handle repeated launch, occupied ports and quit using explicit process ownership. The prototype `.command` only runs Node in a terminal. |
| `server.js`, `src/platform/index.js` | Integrate platform adapters while retaining current API sessions, diagnostics, cancellation and verified selector writes. Store macOS state under `~/Library/Application Support/ClashNodePilot`, retaining explicit state-path overrides. Keep Windows discovery behavior intact. |
| `src/platform/macos.js` | Reuse client configuration candidates and XML escaping. Resolve home paths at runtime and verify candidates against actual client versions and active controller configuration. Keep an explicit configuration option when discovery fails. |
| `src/platform/macos.js`, launcher | Redesign LaunchAgent ownership before enabling login startup. Verify loaded state instead of relying on plist existence. Avoid a second service competing for the same port, and avoid stopping the API process before a startup-disable operation has finished. |
| `src/platform/secure-store.js` | Reuse the Keychain account model. Distinguish missing credentials from locked Keychain, denied access and timeout. Preserve secret bytes instead of trimming them. Prefer a native Security.framework bridge that does not pass secrets in command-line arguments. |
| `server.js`, `src/core/state.js`, `public/app.js` | If manual pairing is included, add authenticated API and UI support, validate local controller URLs, and persist only pairing metadata. Coordinate metadata and Keychain changes so failure does not leave inconsistent records. The current state schema does not retain prototype pairing fields. |
| macOS CI and release workflows | Build and inspect DMGs on macOS; exercise the packaged application and runtime. Publish architecture-specific checksums and accurate signing status only after the relevant gates pass. |

The prototype LaunchAgent uses unconditional `KeepAlive` and starts Node directly. Copying this behavior would make quit semantics ambiguous and could restart a service after the application exits. Process ownership must be settled before login startup is offered.

The PowerShell ZIP builder is not the macOS distribution path. A Windows-created archive cannot establish macOS executable permissions, application signing or DMG behavior. The prototype CI starts only the runtime matching its runner architecture; checking both archives exist is not evidence that both architectures run.

## Acceptance Checklist

Keep results separate for Apple Silicon and Intel. Record the artifact checksum, source commit, Mac model, CPU architecture, macOS version and controller-client version with each device run.

- [ ] DMG mounts and the application copies to Applications; the payload contains the expected runtime, licenses and source metadata, with no user state or secrets.
- [ ] First launch works from Finder without a preinstalled Node runtime; the UI reaches the authenticated local API. Paths containing spaces and non-ASCII characters work.
- [ ] Repeated launch reuses the owned service. An unrelated process on the desired port produces an actionable error rather than being stopped or mistaken for Pilot.
- [ ] Quit releases the owned process and listening port. Closing the browser, quitting the launcher and enabling login startup have documented, distinct behavior.
- [ ] Client discovery is verified against actual supported client versions. Explicit configuration and any manual pairing work when automatic discovery does not.
- [ ] Keychain save, read and removal work; denied access, locked Keychain and failed metadata writes produce recoverable errors. API responses and diagnostics omit secrets.
- [ ] Optional LaunchAgent enable, disable and next-login behavior work without duplicate processes or stale paths. Failed installation restores the previous state.
- [ ] Upgrade and rollback retain compatible user state. Removing the application has explicit behavior for login startup and stored credentials.
- [ ] Packaged fake-controller checks cover session rejection, diagnostics export, selector readback and shutdown. Core Node CI is reported separately from application and device tests.
- [ ] Developer ID signing, notarization and Gatekeeper results are recorded accurately. Unsigned or unnotarized previews are labeled accordingly; no general-release compatibility claim precedes real-device acceptance.

These gates define the work needed for a preview. A generated DMG, passing core tests or a successful CI runtime check alone does not complete macOS delivery.
