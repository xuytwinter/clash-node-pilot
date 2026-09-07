# Compatibility

## 0.2.0 Candidate Target

| Area | Supported scope |
| --- | --- |
| Operating system | Windows 10/11 x64 portable ZIP |
| Runtime | Official Node.js 22.x Windows x64 bundled in the package |
| Source and CI | Node.js 22.x |
| UI | Local browser at `127.0.0.1`, port `3210` by default |

0.2.0 is a candidate awaiting publication. No macOS, Linux, mobile, browser-extension, Electron or installer package is included.

## Proxy Clients

| Client | Support | Condition |
| --- | --- | --- |
| Clash Verge Rev | Writable compatible selectors | Local config and external controller; UI group detection depends on readable local storage |
| Clash for Windows | Writable compatible selectors | An enabled Mihomo-compatible local controller |
| Other Clash/Mihomo clients | Custom configuration | Set `CLASH_CONFIG` with local `external-controller` and optional `secret` |
| v2rayN 7.x | Read-only detection | No database edits or Xray restart |

Compatibility depends on controller capabilities, not the client name alone. Required controller routes are `GET /version`, `GET /proxies`, `GET /proxies/:node/delay` and `PUT /proxies/:selector`. Selector PUT is followed by readback; success is reported only after confirmation. Remote controller addresses are rejected.

## Windows Launch

Launch scripts prefer `runtime\node.exe` and fall back to `node.exe` on PATH. Paths containing spaces, Chinese characters and single quotes are covered by isolated script tests. `PORT` or `-Port` sets the port consistently, including startup registration. Valid ports are 1 through 65535.

The watchdog checks Node Pilot's local health independently of controller connectivity. It neither restarts nor terminates Clash. Node owns automatic scheduling; legacy PowerShell loop scripts no longer run a second optimizer schedule.

## Upgrade and Rollback

1. Stop the existing Node Pilot instance.
2. Back up `%LOCALAPPDATA%\ClashNodePilot\state.json` and `state.json.bak`, or the corresponding files at `CLASH_PILOT_STATE`.
3. Extract the candidate into a separate folder and retain the old application and backup.
4. Start with the intended state path and inspect persistence status. Reinstall startup entries from the new folder.

Default state is outside the application folder. Legacy repository-local `data\state.json` is copied once only when the destination does not exist. Supported older schemas are sanitized and migrated. Invalid input is preserved as `.invalid`; a valid `.bak` may restore state, otherwise defaults are used only when preservation allows safe writes. A newer unknown schema is preserved as `.future` when possible, with state writes and mutating operations disabled.

Rollback requires the older application paired with its matching pre-upgrade state copy, preferably at a separate `CLASH_PILOT_STATE` path. Do not overwrite newer state with an older application. Recovery fixtures and portable smoke tests are isolated evidence; a real-machine upgrade has not been established by those tests.

## Probe Scope

Manual tests rank one-time latency measurements. Automatic optimization adds historical health, repeated samples, thresholds and cooldown. Trusted HTTPS probes and fixed connectivity targets are not integrations with the services being probed. [Synthetic benchmarks](benchmarks.md) use unequal probe budgets and report simulated steps, not measured real-world outage duration.
