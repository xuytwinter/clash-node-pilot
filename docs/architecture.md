# Architecture

Clash Node Pilot is a single local Node.js process with a static browser dashboard and a small HTTP JSON API. It is intentionally not an Electron app and does not include a cloud service.

## Runtime Pieces

- `server.js`: local HTTP server, backend discovery, API routes, scheduler loop, state persistence, startup integration boundary.
- `public/`: static dashboard and browser-side UI logic.
- `src/core/controller.js`: Mihomo controller client, config parsing, safe backend DTOs.
- `src/core/optimizer.js`: bounded concurrency, node measurement, region selector extraction, health updates.
- `src/core/decision.js`: scored ranking, switch thresholds, cooldown, manual/monitor protections.
- `src/core/connectivity.js`: effective selector resolution and fixed-target connectivity diagnosis.
- `src/core/state.js`: runtime state schema sanitization and forward-schema protection.
- `scripts/demo.js`: isolated fake-controller dashboard demo.
- `scripts/benchmark.js`: deterministic benchmark harness that drives the real HTTP API.

## Request Boundary

The local server binds to `127.0.0.1`. The browser never receives controller secrets. `GET /api/session` returns `{token}` for the current process. Every other API route except `/api/health` requires `x-pilot-session: <token>`, including read-only status and diagnostics. Host/origin checks apply, and JSON POST requests require `application/json`. Restarting the service changes the token. This boundary does not prevent a malicious process running as the same local user from obtaining a token.

Primary API routes:

- `GET /api/health`
- `GET /api/session`
- `GET /api/diagnostics`
- `GET /api/status`
- `POST /api/optimize`
- `POST /api/auto-optimize`
- `POST /api/connectivity-heal`
- `POST /api/automation`
- `POST /api/demo-scenario`

## Selector Writes

Selector writes go through a commit phase:

1. Read the selected group again to detect external manual changes.
2. Abort if the job was cancelled before commit starts.
3. Send `PUT /proxies/:selector`.
4. Read the selector again.
5. Report `switched` only when readback confirms the requested target.

The API reports explicit commit state:

- `not-started`
- `verified`
- `not-applied`
- `unknown`

## Decision Flow

Manual runs sort the selected region by one-time measurements. Automatic runs use the scored decision policy:

1. Measure current-region candidates with the default trusted probe.
2. Rank using a snapshot of health state taken before current samples are written.
3. Update health exactly once after the decision path finishes.
4. Apply threshold and cooldown unless the current node hard-failed.
5. If the default probe fails for the region, recheck the same region with the alternate trusted probe.
6. Only cross regions when the current region still has no healthy candidate after that recheck.

Connectivity heal resolves nested selectors to the writable selector that owns the real node, then checks fixed connectivity targets. It treats common probe failure and likely target outage as indeterminate and keeps the current selector.

## Persistence

Runtime state is stored at `%LOCALAPPDATA%\ClashNodePilot\state.json` unless `CLASH_PILOT_STATE` is set. The state file contains history, health, locks, last automatic selections, last switch timestamps, settings, selected backend, and diagnostics.

Supported older state is sanitized and migrated. Writes use a temporary file, previous-state backup and rename. Invalid state is preserved before recovery from a valid `.bak` or safe defaults. A newer unknown schema disables persistence and mutating actions; rollback must pair the old application with its compatible saved state. These behaviors are verified using isolated fixtures, not an established real-machine upgrade.

## Diagnostics and Demo Reset

Diagnostics are constructed from a fixed whitelist rather than recursively scrubbing arbitrary state. Names, paths, endpoints and free text are omitted. Identifiers are anonymous report-local indices; timestamps, timing statistics, counts and fixed codes remain. Reports require review before sharing.

Demo scenario changes use the job coordinator. An active job causes HTTP 409 instead of resetting state mid-operation. Successful reset clears history, health, latest results, manual locks, previous automatic selections, switch cooldown timestamps and scheduling timestamps; monitor-only returns to false. Settings remain configured.

## Windows Delivery

The watchdog checks `/api/health` independently of controller connection status and never terminates Clash processes. Node owns automatic scheduling; PowerShell compatibility loop entries only start the local service. PORT defaults to 3210 and is shared by launch, health checks and startup registration.

Node.js 22.x is the CI-supported runtime. Packaging records source SHA and working-tree state in BUILD-INFO.json, retains previous version assets and fails on native command errors. See [benchmark methodology](benchmarks.md) for the simulated clock, unequal probe budgets and limits of comparisons.
