const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STATE_SCHEMA_VERSION,
  assertSupportedStateSchema,
  sanitizeHealth,
  sanitizeRuntimeSnapshot,
  sanitizeSettings
} = require('../src/core/state');

const defaults = {
  autoIntervalMinutes: 3,
  switchThresholdMs: 25,
  switchCooldownMinutes: 5,
  healthHalfLifeMinutes: 60,
  manualTestUrl: 'https://www.gstatic.com/generate_204',
  manualTimeoutMs: 5000,
  samples: 2,
  manualPauseMinutes: 15,
  connectivityCheckMinutes: 1,
  connectivityTimeoutMs: 5000
};

test('state settings sanitizer clamps invalid persisted values without losing zero threshold', () => {
  assert.deepEqual(sanitizeSettings({
    autoIntervalMinutes: -5,
    switchThresholdMs: 0,
    switchCooldownMinutes: -2,
    healthHalfLifeMinutes: 20000,
    manualTestUrl: 'https://cp.cloudflare.com/generate_204',
    manualTimeoutMs: 250,
    samples: 99,
    manualPauseMinutes: 'bad',
    connectivityCheckMinutes: 45,
    connectivityTimeoutMs: 250
  }, defaults), {
    autoIntervalMinutes: 1,
    switchThresholdMs: 0,
    switchCooldownMinutes: 0,
    healthHalfLifeMinutes: 10080,
    manualTestUrl: 'https://cp.cloudflare.com/generate_204',
    manualTimeoutMs: 1000,
    samples: 5,
    manualPauseMinutes: 15,
    connectivityCheckMinutes: 30,
    connectivityTimeoutMs: 1000
  });
});

test('runtime snapshot sanitizer upgrades schema and discards expired or malformed records', () => {
  const snapshot = sanitizeRuntimeSnapshot({
    schemaVersion: 1,
    history: [{ ok: true }, null],
    health: {
      'backend|group|JP%2001': { success: -1, failure: 3.8, latencies: [50, 'bad', 60], jitter: 4 },
      bad: null
    },
    locks: { active: 2000, expired: 500, bad: 'x' },
    lastAuto: { active: 'JP 01', empty: '' },
    lastSwitch: { recent: 1200, bad: 'x' },
    settings: { switchThresholdMs: 0 },
    selectedBackend: 'clash-verge',
    nextRunAt: 'not-a-date',
    nextConnectivityCheckAt: '2026-09-06T00:00:00.000Z'
  }, defaults, { now: 1000 });

  assert.equal(snapshot.schemaVersion, STATE_SCHEMA_VERSION);
  assert.deepEqual(snapshot.history, [{ ok: true }]);
  assert.deepEqual(snapshot.locks, { active: 2000 });
  assert.deepEqual(snapshot.lastAuto, { active: 'JP 01' });
  assert.deepEqual(snapshot.lastSwitch, { recent: 1200 });
  assert.equal(snapshot.settings.switchThresholdMs, 0);
  assert.equal(snapshot.selectedBackend, 'clash-verge');
  assert.equal(snapshot.nextRunAt, null);
  assert.equal(snapshot.nextConnectivityCheckAt, '2026-09-06T00:00:00.000Z');
  assert.equal(snapshot.health['backend|group|JP%2001'].name, 'JP 01');
  assert.equal(snapshot.health['backend|group|JP%2001'].success, 0);
  assert.equal(snapshot.health['backend|group|JP%2001'].failure, 3.8);
  assert.deepEqual(snapshot.health['backend|group|JP%2001'].latencies, [50, 60]);
});

test('future runtime schema is rejected instead of silently downgraded', () => {
  assert.throws(
    () => assertSupportedStateSchema({ schemaVersion: STATE_SCHEMA_VERSION + 1 }),
    { code: 'state-future-schema' }
  );
  assert.throws(
    () => sanitizeRuntimeSnapshot({ schemaVersion: STATE_SCHEMA_VERSION + 1 }, defaults),
    { code: 'state-future-schema' }
  );
});

test('health sanitizer keeps malformed encoded keys loadable', () => {
  const health = sanitizeHealth({ 'backend|group|bad%key': { success: 1, failure: 0 } });
  assert.equal(health['backend|group|bad%key'].name, 'bad%key');
});
