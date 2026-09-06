const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decideSwitch,
  decayedHealth,
  rankCandidates,
  scoreNode
} = require('../src/core/decision');

const now = Date.parse('2026-09-07T00:00:00.000Z');

test('score ranks a stable slightly slower node over a flaky fast node', () => {
  const results = [
    { name: 'Fast Flaky', ok: true, delay: 42, successCount: 1, failureCount: 4, jitter: 12 },
    { name: 'Stable Slow', ok: true, delay: 70, successCount: 5, failureCount: 0, jitter: 2 }
  ];
  const ranked = rankCandidates(results, {}, { failurePenaltyMs: 200, jitterPenaltyRatio: 0.5 }, { now });

  assert.equal(ranked.best.name, 'Stable Slow');
  assert.equal(ranked.scored[0].components.failurePenaltyMs, 0);
  assert.ok(ranked.scored[1].components.failurePenaltyMs > 100);
});

test('old failure evidence decays before new successful samples are scored', () => {
  const health = {
    success: 0,
    failure: 8,
    jitter: 0,
    updatedAt: new Date(now - 4 * 60 * 60 * 1000).toISOString()
  };
  const recovered = scoreNode(
    { name: 'Recovered', ok: true, delay: 80, successCount: 2, failureCount: 0, jitter: 0 },
    health,
    'scope',
    { healthHalfLifeMinutes: 30 },
    { now }
  );

  assert.ok(recovered.evidence.historicalFailure < 0.04);
  assert.ok(recovered.scoreMs < 85);
  assert.equal(decayedHealth(health, { now, halfLife: 30 * 60 * 1000 }).failure < 0.04, true);
});

test('cooldown holds an otherwise better node when current is still healthy', () => {
  const decision = decideSwitch({
    currentName: 'Node A',
    results: [
      { name: 'Node A', ok: true, delay: 100, successCount: 2, failureCount: 0 },
      { name: 'Node B', ok: true, delay: 60, successCount: 2, failureCount: 0 }
    ],
    settings: { switchThresholdMs: 25, switchCooldownMinutes: 5 },
    lastSwitchAt: now - 2 * 60 * 1000,
    now
  });

  assert.equal(decision.action, 'hold');
  assert.equal(decision.code, 'cooldown-active');
  assert.equal(decision.protection.remainingCooldownMs, 3 * 60 * 1000);
});

test('cooldown treats unix epoch zero as a valid switch timestamp', () => {
  const decision = decideSwitch({
    currentName: 'Node A',
    results: [
      { name: 'Node A', ok: true, delay: 100, successCount: 1, failureCount: 0 },
      { name: 'Node B', ok: true, delay: 60, successCount: 1, failureCount: 0 }
    ],
    settings: { switchThresholdMs: 25, switchCooldownMinutes: 5 },
    lastSwitchAt: 0,
    now: 2 * 60 * 1000
  });

  assert.equal(decision.action, 'hold');
  assert.equal(decision.code, 'cooldown-active');
  assert.equal(decision.protection.remainingCooldownMs, 3 * 60 * 1000);
});

test('hard failure bypasses cooldown and approves a switch', () => {
  const decision = decideSwitch({
    currentName: 'Node A',
    currentResult: { name: 'Node A', ok: false, delay: null, successCount: 0, failureCount: 2 },
    results: [
      { name: 'Node B', ok: true, delay: 90, successCount: 2, failureCount: 0 }
    ],
    settings: { switchThresholdMs: 25, switchCooldownMinutes: 5 },
    lastSwitchAt: now - 30 * 1000,
    hardFailure: true,
    now
  });

  assert.equal(decision.action, 'switch');
  assert.equal(decision.code, 'switch-approved');
  assert.equal(decision.protection.cooldownBypassed, true);
});

test('score delta threshold uses the same scored ranking as recommendation', () => {
  const decision = decideSwitch({
    currentName: 'Stable',
    results: [
      { name: 'Stable', ok: true, delay: 80, successCount: 5, failureCount: 0, jitter: 0 },
      { name: 'Fast Flaky', ok: true, delay: 60, successCount: 1, failureCount: 2, jitter: 0 }
    ],
    settings: { switchThresholdMs: 25, switchCooldownMinutes: 0, failurePenaltyMs: 200 },
    now
  });

  assert.equal(decision.evidence.best.name, 'Stable');
  assert.equal(decision.action, 'hold');
  assert.equal(decision.code, 'current-best');
});

test('score delta threshold compares raw scores before display rounding', () => {
  const decision = decideSwitch({
    currentName: 'Node A',
    results: [
      { name: 'Node A', ok: true, delay: 100, successCount: 1, failureCount: 0 },
      { name: 'Node B', ok: true, delay: 75.4, successCount: 1, failureCount: 0 }
    ],
    settings: { switchThresholdMs: 25, switchCooldownMinutes: 0 },
    now
  });

  assert.equal(decision.action, 'hold');
  assert.equal(decision.code, 'below-threshold');
  assert.equal(decision.scoreDeltaRoundedMs, 25);
  assert.ok(Math.abs(decision.scoreDeltaMs - 24.6) < 0.000001);
});
