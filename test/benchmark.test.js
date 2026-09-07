const test = require('node:test');
const assert = require('node:assert/strict');
const { baseline, delayFor, SCENARIOS, summarizePolicy } = require('../scripts/benchmark');
const clock = require('../src/core/clock');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

test('real authenticated HTTP benchmark satisfies all continuous policy invariants', { timeout: 30000 }, () => {
  const output = execFileSync(process.execPath, [path.join(__dirname, '../scripts/benchmark.js'), '--json'], { encoding: 'utf8', timeout: 25000 });
  const report = JSON.parse(output);
  assert.equal(report.results.length, 12);
  assert.equal(report.schemaVersion, 2);
  assert.ok(report.results.every((item) => item.observations.length === 12));
});

test('seeded traces reproduce baseline costs and availability', () => {
  for (const scenario of SCENARIOS) {
    const naive = baseline(scenario, 42, 'naive-lowest-latency');
    assert.deepEqual(naive, baseline(scenario, 42, 'naive-lowest-latency'));
    assert.equal(naive.probeCount, 36);
    assert.equal(baseline(scenario, 42, 'fixed-initial').probeCount, 0);
  }
  const fixed = baseline('regional-failover', 42, 'fixed-initial');
  assert.equal(fixed.unavailableAfterActionSteps, 4);
  assert.equal(fixed.recoverySteps, 5);
  assert.equal(baseline('regional-failover', 42, 'naive-lowest-latency').unavailableAfterActionSteps, 0);
  assert.equal(baseline('threshold-noise', 42, 'naive-lowest-latency').switches, 12);
});

test('healthy latency improvements are not mislabeled as harmful switches', () => {
  const result = summarizePolicy('test', 'test', [{ availableBefore: true, availableAfter: true, latency: 50, activeAfter: 'b' }], [], [
    { fromServiceable: true, toServiceable: true },
    { fromServiceable: true, toServiceable: false }
  ]);
  assert.equal(result.healthyNodeSwitches, 1);
  assert.equal(result.harmfulSwitches, 1);
  assert.equal(result.recoverySteps, 0);
});

test('probe target failure is independent from regional service truth', () => {
  const input = { scenario: 'target-outage-auto', seed: 42, name: 'Japan 01', tick: 3 };
  assert.equal(delayFor({ ...input, targetUrl: 'https://www.gstatic.com/generate_204' }), null);
  assert.ok(delayFor({ ...input, targetUrl: 'https://cp.cloudflare.com/generate_204' }) > 0);
});

test('controlled clock advances without changing global Date.now', () => {
  const realNow = Date.now;
  try {
    clock.setForTesting(1000);
    assert.equal(clock.now(), 1000);
    clock.setForTesting(31000);
    assert.equal(clock.now(), 31000);
    assert.equal(Date.now, realNow);
    assert.throws(() => clock.setForTesting(NaN), TypeError);
  } finally {
    clock.reset();
  }
  assert.ok(Math.abs(clock.now() - Date.now()) < 1000);
});
