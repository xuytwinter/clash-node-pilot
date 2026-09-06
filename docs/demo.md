# Demo Mode

Demo mode runs Clash Node Pilot against a fake Mihomo controller and a temporary state directory. It is for UI review, QA, and screenshots. It does not read or write real Clash, Mihomo, or v2rayN configuration.

## Run

```powershell
npm run demo
```

Open the printed `http://127.0.0.1:<port>` URL. The dashboard exposes only the fake backend and disables OS startup integrations.

Useful options:

```powershell
npm run demo -- --scenario healthy
npm run demo -- --scenario degraded
npm run demo -- --scenario regional-outage
npm run demo -- --scenario target-outage
npm run demo -- --no-auto
```

## Scenarios

| Scenario | Behavior |
| --- | --- |
| `healthy` | All demo nodes respond. |
| `degraded` | The active Japan node fails one fixed connectivity target, allowing heal behavior to be reviewed. |
| `regional-outage` | Japan demo nodes fail, allowing cross-region fallback behavior to be reviewed. |
| `target-outage` | One fixed target fails across providers, so the dashboard should show an indeterminate or target-outage decision instead of switching blindly. |

The dashboard includes a demo scenario selector when demo mode is active.

## Isolation Guarantees

The demo launcher sets:

- `CLASH_PILOT_DEMO=1`
- `CLASH_PILOT_DISABLE_OS_INTEGRATION=1`
- `CLASH_PILOT_DISABLE_AUTO_LOOP=1`
- `CLASH_CONFIG` pointing at a generated temp config
- `CLASH_PILOT_STATE` pointing at a generated temp state file

The fake controller and temp directory are printed at startup and are discarded by the operating system later.
