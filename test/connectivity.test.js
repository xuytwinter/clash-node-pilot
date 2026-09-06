const test = require('node:test');
const assert = require('node:assert/strict');

const {
  connectivityGroupCandidates,
  hasLikelyTargetOutage,
  resolveEffectiveSelector,
  targetOutageDiagnosis,
  targetOutageSummary
} = require('../src/core/connectivity');

test('connectivity candidates prefer AI groups and selected selector without duplicates', () => {
  const proxies = new Map([
    ['Proxy Select', { type: 'Selector', now: 'JP 01' }],
    ['AI Sites', { type: 'Selector', now: 'Proxy Select' }],
    ['Final', { type: 'Selector', now: 'US 01' }],
    ['JP 01', { type: 'Vless' }],
    ['US 01', { type: 'Vless' }]
  ]);
  const groups = [{ name: 'Final' }, { name: 'Proxy Select' }];
  assert.deepEqual(connectivityGroupCandidates(proxies, groups, 'Proxy Select', 'Final'), ['AI Sites', 'Proxy Select', 'Final']);
});

test('selector cycle is reported as unsupported instead of producing a writable leaf', () => {
  const proxies = new Map([
    ['A', { type: 'Selector', now: 'B' }],
    ['B', { type: 'Selector', now: 'A' }]
  ]);
  assert.equal(resolveEffectiveSelector(proxies, 'A').unsupported, 'selector-cycle');
});

test('target outage detection identifies a provider-wide probe failure', () => {
  const current = {
    name: 'Japan 01',
    checks: [
      { id: 'google-gstatic', ok: true },
      { id: 'openai-trace', ok: false }
    ]
  };
  const candidates = [
    { name: 'Japan 02', checks: [{ id: 'google-gstatic', ok: true }, { id: 'openai-trace', ok: false }] },
    { name: 'US 01', checks: [{ id: 'google-gstatic', ok: true }, { id: 'openai-trace', ok: false }] }
  ];
  const summary = targetOutageSummary(current, candidates, ['google-gstatic', 'openai-trace']);
  assert.deepEqual(summary.map(({ id, checks, successes, allFailed }) => ({ id, checks, successes, allFailed })), [
    { id: 'google-gstatic', checks: 3, successes: 3, allFailed: false },
    { id: 'openai-trace', checks: 3, successes: 0, allFailed: true }
  ]);
  assert.equal(hasLikelyTargetOutage(current, candidates, ['google-gstatic', 'openai-trace']), true);
  assert.equal(targetOutageDiagnosis(current, candidates, ['google-gstatic', 'openai-trace']).code, 'target-service-outage');
});

test('common probe failure remains indeterminate instead of target outage', () => {
  const current = {
    name: 'Japan 01',
    checks: [
      { id: 'google-gstatic', ok: false },
      { id: 'openai-trace', ok: false }
    ]
  };
  const candidates = [
    { name: 'Japan 02', checks: [{ id: 'google-gstatic', ok: false }, { id: 'openai-trace', ok: false }] },
    { name: 'US 01', checks: [{ id: 'google-gstatic', ok: false }, { id: 'openai-trace', ok: false }] }
  ];
  const diagnosis = targetOutageDiagnosis(current, candidates, ['google-gstatic', 'openai-trace']);
  assert.equal(diagnosis.code, 'common-probe-failure');
  assert.equal(diagnosis.confidence, 'indeterminate');
  assert.equal(hasLikelyTargetOutage(current, candidates, ['google-gstatic', 'openai-trace']), false);
});
