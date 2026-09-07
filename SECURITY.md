# Security Policy

## Local Boundary

Clash Node Pilot binds to `127.0.0.1` and reads local controller configuration on the backend. Controller secrets are excluded from browser API responses. It rejects remote controller addresses and restricts probe destinations to trusted HTTPS targets.

`GET /api/session` returns a per-process `{token}`. All other API requests except `/api/health` require `x-pilot-session: <token>`, including status and diagnostics. Host and origin validation protects the browser boundary; JSON POST requests require `application/json`. Tokens change when the service restarts. These controls do not protect against malicious local processes running as the same user, which can request a token or read local files.

## Operational Scope

The application changes compatible Mihomo selectors with PUT, then reads back the selection before reporting a confirmed switch. It does not edit subscriptions or provider files. Unknown commit results require checking the client state. Windows watchdog scripts check the local application health and do not terminate Clash processes.

## Diagnostic Sharing

Diagnostics export uses a fixed whitelist. Names, local paths, controller endpoints, secrets and arbitrary free text are omitted; identifiers become anonymous indices scoped to one report. Timestamps, timing statistics, counts, versions and fixed status codes remain. Review the report before sharing: omission of direct identifiers is not a guarantee that activity patterns cannot be recognized. Raw state files and logs are not equivalent to the exported report and should not be attached without inspection.

## State Protection

Compatible older state is migrated; invalid input is preserved and a valid backup is used when available. A newer unknown schema makes persistence and mutating operations read-only. Keep a pre-upgrade state backup for rollback with its matching application version.

## Reporting

Open a private GitHub Security Advisory for this repository. Do not post controller secrets, subscription URLs or personal configuration files in public issues.
