# Synthetic Policy Benchmarks

This harness compares policies on deterministic synthetic traces through the real authenticated server HTTP API and an isolated fake Mihomo controller. Target URLs are interpreted locally; no probe reaches an internet service. These are not internet speed tests or real recovery-time measurements.

## Run

```powershell
npm run benchmark
npm run benchmark -- --json
npm run benchmark -- --seed 20260907
npm run benchmark -- --scenario regional-failover
```

Each scenario runs 12 actions, 30 simulated seconds apart, starting at 2026-09-07T00:00:00Z. The injected in-process policy clock advances before every action. POST /api/auto-optimize with force:true runs the real scheduled policy: connectivity healing first, then latency optimization when applicable. Force bypasses due-time gating, but retains cooldown and manual protection. This establishes a common action cadence; it does not test normal scheduler frequency. Real HTTP deadlines remain real timers. There is no HTTP clock-control endpoint.

## Traces and Assertions

| Scenario | Trace and Pilot invariant |
| --- | --- |
| regional-failover | Both Japan nodes fail at steps 2-5. Select healthy US fallback at step 2 and remain available after every action. |
| target-outage-auto | All nodes lose the primary target at steps 2-7 while alternate targets work. Diagnose target-service-outage and retain the Japan region. |
| threshold-noise | Japan nodes alternate a 10 ms latency advantage with seeded jitter of up to 4 ms. Hold under the 25 ms threshold across 12 actions. |
| cooldown-expiry | Japan 02 is much faster at step 0; Japan 01 is much faster afterward. Exercise cooldown, forbid healthy switches at steps 1-3, and permit switching when the 120-second cooldown expires. |

Each run initializes fresh persisted state and controller selection. The harness asserts HTTP success and policy invariants. Simulated successful probes return immediately with seeded latency; failures return HTTP 504 immediately. Elapsed real timeout cost is not modeled.

## Comparisons and Costs

Every policy starts on Japan 01 with identical node/target/step outcomes and action cadence. Outcomes depend only on these values and seed, not query order.

- pilot-http runs the real composite scheduled policy, including healing, region preference, health scoring, 25 ms threshold and 120-second optimization cooldown. Every controller delay probe is counted, including healing and alternate-target verification.
- fixed-initial never probes or switches. This zero-probe baseline measures the availability cost of remaining on the initial node.
- naive-lowest-latency probes all three nodes against the primary target once per action and selects the lowest successful delay. It has no history, threshold, cooldown, region restriction or alternate-target verification. It holds if all probes fail, and spends exactly 36 probes per scenario.

These policies have unequal observation budgets. Compare latency, probes, switches and availability together; lower switch count alone does not establish better service. Extra verification costs probes, and region preference or cooldown can increase latency. These selected traces exercise branches rather than represent workload samples. Results do not establish production superiority or isolate the benefit of individual algorithm components.

## Metrics

| Field | Definition |
| --- | --- |
| recoverySteps | First unavailable pre-action observation through first available post-action observation, inclusive. Same-action recovery is 1, no outage is 0, unrecovered is null. Exogenous recovery counts too. |
| unavailableBeforeActionSteps | Steps with an unavailable selected node immediately before the action. |
| unavailableAfterActionSteps | Steps with an unavailable selected node immediately after the action. |
| switches | Accepted selector writes for Pilot; selection changes for baselines. |
| probeCount | Controller delay requests for Pilot; synthetic observations for baselines. Discovery and inventory reads are excluded. |
| harmfulSwitches | Switches from a serviceable node to an unavailable node in synthetic truth. |
| healthyNodeSwitches | Switches between serviceable nodes, which may be legitimate improvements and are not called false switches. |
| meanSelectedLatencyMs | Mean alternate-target synthetic latency of post-action selection over serviceable steps only. This is evaluator truth, not a charged policy probe. Consider unavailable steps separately. |
| observations | Per-step selections, availability, evaluator latency and simulated timestamps. |
| reasonCodes | Real HTTP policy codes for Pilot. |

Schema 2 replaces recoveryTimeSec, unavailableDurationSec and falseSwitches with explicit step metrics and a harmful-switch definition. The 30-second simulation step is not a measured outage duration. CLI flags remain compatible; JSON emits all baselines and observations.

Default seed 20260907, current implementation:

| Scenario | Policy | Recovery steps | Unavailable after | Switches | Probes | Mean latency ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| regional-failover | Pilot | 1 | 0 | 2 | 41 | 109.50 |
| regional-failover | Fixed | 5 | 4 | 0 | 0 | 89.13 |
| regional-failover | Naive | 1 | 0 | 3 | 36 | 75.92 |
| target-outage-auto | Pilot | 0 | 0 | 1 | 60 | 54.67 |
| target-outage-auto | Fixed | 0 | 0 | 0 | 0 | 90.25 |
| target-outage-auto | Naive | 0 | 0 | 1 | 36 | 54.67 |
| threshold-noise | Pilot | 0 | 0 | 0 | 48 | 95.08 |
| threshold-noise | Fixed | 0 | 0 | 0 | 0 | 95.08 |
| threshold-noise | Naive | 0 | 0 | 12 | 36 | 89.83 |
| cooldown-expiry | Pilot | 0 | 0 | 2 | 48 | 50.25 |
| cooldown-expiry | Fixed | 0 | 0 | 0 | 0 | 40.92 |
| cooldown-expiry | Naive | 0 | 0 | 2 | 36 | 34.83 |

These results include tradeoffs: Pilot uses more probes than naive in every trace, has higher latency after regional failover, and trades latency for stability during noise and cooldown. All policies have zero harmful switches on these traces. Re-run the command for evidence after policy changes.
