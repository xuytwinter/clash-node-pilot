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

The local server binds to `127.0.0.1`. The browser never receives controller secrets. POST requests require local host/origin checks and `application/json`.

Primary API routes:

- `GET /api/health`
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

State writes are disabled if a newer schema version is detected, so older releases do not silently overwrite newer runtime state.
