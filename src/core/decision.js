const DEFAULT_DECISION_SETTINGS = Object.freeze({
  switchThresholdMs: 25,
  switchCooldownMinutes: 5,
  healthHalfLifeMinutes: 60,
  failurePenaltyMs: 200,
  jitterPenaltyRatio: 0.5
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function halfLifeMs(settings = {}) {
  return Math.max(60000, finiteNumber(settings.healthHalfLifeMinutes, DEFAULT_DECISION_SETTINGS.healthHalfLifeMinutes) * 60000);
}

function ageMs(updatedAt, now) {
  const parsed = Date.parse(updatedAt || '');
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : Infinity;
}

function decayFactor(updatedAt, now = Date.now(), halfLife = halfLifeMs()) {
  const age = ageMs(updatedAt, now);
  if (!Number.isFinite(age)) return 0;
  return 0.5 ** (age / halfLife);
}

function decayedHealth(entry = {}, { now = Date.now(), halfLife = halfLifeMs() } = {}) {
  const factor = decayFactor(entry.updatedAt, now, halfLife);
  return {
    success: finiteNumber(entry.success) * factor,
    failure: finiteNumber(entry.failure) * factor,
    jitter: finiteNumber(entry.jitter),
    updatedAt: entry.updatedAt || null,
    decayFactor: factor
  };
}

function currentSampleCounts(result = {}) {
  const successCount = result.ok ? finiteNumber(result.successCount, 1) : 0;
  const failureFallback = result.ok ? 0 : 1;
  const failureCount = finiteNumber(result.failureCount, failureFallback);
  return { successCount, failureCount, sampleCount: successCount + failureCount };
}

function scoreNode(result, health = {}, scopeKey, settings = {}, { now = Date.now() } = {}) {
  const mergedSettings = { ...DEFAULT_DECISION_SETTINGS, ...settings };
  const historical = decayedHealth(health || {}, { now, halfLife: halfLifeMs(mergedSettings) });
  const samples = currentSampleCounts(result);
  const totalSuccess = historical.success + samples.successCount;
  const totalFailure = historical.failure + samples.failureCount;
  const totalSamples = totalSuccess + totalFailure;
  const failureRate = totalSamples > 0 ? totalFailure / totalSamples : 0;
  const latencyMs = result.ok ? finiteNumber(result.delay, Infinity) : Infinity;
  const jitterMs = finiteNumber(result.jitter ?? historical.jitter, 0);
  const failurePenaltyMs = failureRate * finiteNumber(mergedSettings.failurePenaltyMs, DEFAULT_DECISION_SETTINGS.failurePenaltyMs);
  const jitterPenaltyMs = jitterMs * finiteNumber(mergedSettings.jitterPenaltyRatio, DEFAULT_DECISION_SETTINGS.jitterPenaltyRatio);
  const score = result.ok ? latencyMs + failurePenaltyMs + jitterPenaltyMs : Infinity;

  return {
    name: result.name,
    ok: Boolean(result.ok) && Number.isFinite(score),
    score,
    scoreMs: Number.isFinite(score) ? Math.round(score) : null,
    scopeKey,
    components: {
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
      failurePenaltyMs: Math.round(failurePenaltyMs),
      jitterPenaltyMs: Math.round(jitterPenaltyMs)
    },
    evidence: {
      successCount: samples.successCount,
      failureCount: samples.failureCount,
      sampleCount: samples.sampleCount,
      historicalSuccess: Number(historical.success.toFixed(3)),
      historicalFailure: Number(historical.failure.toFixed(3)),
      historicalDecayFactor: Number(historical.decayFactor.toFixed(4)),
      failureRate: Number(failureRate.toFixed(4)),
      updatedAt: historical.updatedAt
    },
    result
  };
}

function rankCandidates(results, healthByName = {}, settings = {}, options = {}) {
  const scored = results.map((result) => scoreNode(result, healthByName[result.name], options.scopeKey, settings, options));
  scored.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.score ?? Infinity) - (b.score ?? Infinity);
  });
  return {
    best: scored.find((item) => item.ok) || null,
    scored
  };
}

function parseTimestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function decideSwitch({
  currentName,
  results,
  currentResult = null,
  healthByName = {},
  settings = {},
  lastSwitchAt = null,
  allowSwitch = true,
  monitorOnly = false,
  hardFailure = false,
  now = Date.now(),
  scopeKey = null
}) {
  const mergedSettings = { ...DEFAULT_DECISION_SETTINGS, ...settings };
  const currentIncluded = results.some((item) => item.name === currentName);
  const decisionResults = currentIncluded || !currentResult ? results : [...results, currentResult];
  const ranking = rankCandidates(decisionResults, healthByName, mergedSettings, { now, scopeKey });
  const rankedCandidates = ranking.scored.filter((item) => results.some((result) => result.name === item.name));
  const best = rankedCandidates.find((item) => item.ok) || null;
  const currentScore = ranking.scored.find((item) => item.name === currentName) || null;
  const thresholdMs = Math.max(0, finiteNumber(mergedSettings.switchThresholdMs, DEFAULT_DECISION_SETTINGS.switchThresholdMs));
  const cooldownMs = Math.max(0, finiteNumber(mergedSettings.switchCooldownMinutes, DEFAULT_DECISION_SETTINGS.switchCooldownMinutes) * 60000);
  const lastSwitchTime = parseTimestamp(lastSwitchAt);
  const remainingCooldownMs = lastSwitchTime !== null && cooldownMs ? Math.max(0, (lastSwitchTime + cooldownMs) - now) : 0;
  const currentHardFailed = Boolean(hardFailure || currentResult?.ok === false || (currentScore && !currentScore.ok));
  const scoreDeltaMs = best && currentScore && Number.isFinite(currentScore.score)
    ? currentScore.score - best.score
    : (best ? null : 0);
  const scoreDeltaRoundedMs = scoreDeltaMs === null ? null : Math.round(scoreDeltaMs);
  const base = {
    at: new Date(now).toISOString(),
    current: currentName,
    target: best?.name || null,
    thresholdMs,
    scoreDeltaMs,
    scoreDeltaRoundedMs,
    protection: {
      monitorOnly: Boolean(monitorOnly),
      allowSwitch: Boolean(allowSwitch),
      cooldownMs,
      remainingCooldownMs,
      cooldownBypassed: false,
      hardFailure: currentHardFailed
    },
    evidence: {
      current: currentScore,
      best,
      ranked: rankedCandidates
    }
  };

  if (!best) {
    return { ...base, action: 'uncertain', code: 'no-healthy-candidate', reason: 'No healthy candidate was measured' };
  }
  if (currentName === best.name) {
    return { ...base, action: 'hold', code: 'current-best', reason: 'Current node has the best score' };
  }
  if (!allowSwitch) {
    return { ...base, action: 'hold', code: 'switch-disabled', reason: 'Switching was disabled for this request' };
  }
  if (monitorOnly) {
    return { ...base, action: 'hold', code: 'monitor-only', reason: 'Monitor-only mode forbids selector writes' };
  }
  if (remainingCooldownMs > 0 && !currentHardFailed) {
    return { ...base, action: 'hold', code: 'cooldown-active', reason: 'Recent switch cooldown is still active' };
  }
  if (remainingCooldownMs > 0 && currentHardFailed) {
    base.protection.cooldownBypassed = true;
  }
  if (scoreDeltaMs !== null && scoreDeltaMs < thresholdMs && !currentHardFailed) {
    return { ...base, action: 'hold', code: 'below-threshold', reason: 'Best candidate score improvement is below the configured threshold' };
  }
  return { ...base, action: 'switch', code: 'switch-approved', reason: 'Best candidate score improvement satisfies the policy' };
}

module.exports = {
  DEFAULT_DECISION_SETTINGS,
  decideSwitch,
  decayedHealth,
  rankCandidates,
  scoreNode
};
