# Benchmarks

The benchmark harness measures policy behavior, not real internet speed. It starts an isolated fake Mihomo controller, starts the real `server.js` local API, and drives the same HTTP endpoints used by the dashboard and scheduler.

## Run

```powershell
npm run benchmark
npm run benchmark -- --json
npm run benchmark -- --seed 20260907
npm run benchmark -- --scenario regional-failover
```

Default scenarios:

- `regional-failover`: current Japan nodes fail for a window; connectivity heal should switch to a healthy fallback.
- `target-outage-auto`: the default probe fails for Japan, but the alternate same-region probe works; automatic optimization should not cross regions.
- `threshold-noise`: a candidate appears about 25 ms faster but the raw score improvement is below threshold; automatic optimization should hold.

## Metrics

| Metric | Meaning |
| --- | --- |
| `recoveryTimeSec` | Simulated time from first unavailable active node to the first healthy active node after policy action. |
| `switches` | Number of selector `PUT` writes accepted by the fake controller. |
| `unavailableDurationSec` | Simulated time spent on an unavailable active node before each policy run. |
| `probeCount` | Number of fake controller `/delay` probes. |
| `falseSwitches` | Switches away from a node that was still serviceable in the simulation truth model. |
| `finalActive` | Final selected node. |
| `reasonCodes` | API decision codes returned by the real policy path. |

Default seed `20260907` currently reports:

| Scenario | Recovery | Switches | Unavailable | Probes | False | Final | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `regional-failover` | 30 | 1 | 30 | 20 | 0 | `US 01` | `no-actionable-group` |
| `target-outage-auto` | 0 | 0 | 0 | 4 | 0 | `Japan 01` | `target-service-outage` |
| `threshold-noise` | 0 | 0 | 0 | 2 | 0 | `Japan 01` | `below-threshold` |

The numbers are deterministic for a fixed seed and script version. They are intended for regression checks and release notes, not for comparing real proxy providers.
