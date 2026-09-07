const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiagnosticsReport } = require('../src/core/diagnostics');

test('report only exports schema fields, canonical values, and report-local identifiers', () => {
  const secret = 'synthetic-secret-7Kx3';
  const localPath = 'C:\\Users\\Private Person\\config.yaml';
  const nodeName = 'Private Hong Kong Premium Node';
  const payload = { secret, path: localPath, nested: { message: secret } };
  const poisoned = { ...payload, at: localPath, source: secret, backend: secret, group: nodeName, active: nodeName, code: secret, reasonCode: localPath, status: secret, version: secret, message: localPath, extra: payload };
  const report = createDiagnosticsReport({
    ...poisoned, app: poisoned, runtime: { ...poisoned, node: secret, platform: secret, arch: localPath },
    environment: { demoMode: payload }, server: { host: secret, port: null }, startup: poisoned,
    backend: { ...poisoned, id: secret, name: nodeName, config: payload, capabilities: { discovery: secret }, diagnostic: poisoned },
    backends: [poisoned], detectedClients: [poisoned],
    controller: { connected: true, inventory: { error: poisoned }, groups: [{ name: nodeName, now: nodeName, members: [secret] }] },
    automation: { ...poisoned, currentJob: poisoned, settings: { ...poisoned, samples: payload, manualTestUrl: secret } },
    persistence: poisoned, health: { [secret]: { ...poisoned, success: null, failure: 2 } },
    history: [{ ...poisoned, best: { name: nodeName, delay: null, score: payload }, results: [{ name: secret, ok: true, delay: null }], decision: { ...poisoned, action: secret, evidence: { best: payload, current: payload }, commit: poisoned } }],
    lastResults: poisoned, diagnostics: [poisoned]
  });
  const serialized = JSON.stringify(report);
  for (const value of [secret, localPath, nodeName]) assert.equal(serialized.includes(value), false);
  assert.equal(serialized.includes('nested'), false);
  assert.equal(serialized.includes('manualTestUrl'), false);
  assert.equal(report.controller.groups[0].nameId, report.history[0].groupId);
  assert.equal(report.controller.groups[0].nowId, report.history[0].best.nameId);
  assert.equal(report.history[0].code, 'unknown');
  assert.equal(report.diagnostics[0].code, 'unknown');
  assert.equal('delay' in report.history[0].best, false);
  assert.equal('minDelay' in report.history[0].results, false);
  assert.equal('port' in report.server, false);
  assert.deepEqual(report.health, { trackedNodes: 1, successSamples: 0, failureSamples: 2 });
});

test('useful decision, runtime, persistence, and sample statistics survive export', () => {
  const report = createDiagnosticsReport({
    generatedAt: '2026-09-07T12:00:00.000Z', app: { version: '1.2.3' }, runtime: { node: 'v22.1.0', platform: 'win32', arch: 'x64' },
    controller: { inventory: { ok: false, error: { code: 'controller-timeout', status: 504, message: 'private' } } },
    persistence: { writable: false, code: 'state-save-failed', message: 'private' },
    automation: { running: false, activeLocks: 2, settings: { switchThresholdMs: 25, samples: 3, manualTestUrl: 'private' } },
    history: [{ switched: false, success: 1, candidates: 2, results: [{ ok: true, delay: 80 }, { ok: false, delay: null }], decision: { code: 'below-threshold', action: 'hold', thresholdMs: 25, scoreDeltaRoundedMs: 10, evidence: { best: { scoreMs: 80 } }, commit: { started: false, writeResult: 'not-started', verified: false, reasonCode: 'below-threshold' } } }]
  });
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.runtime.node, 'v22.1.0');
  assert.equal(report.app.version, '1.2.3');
  assert.equal(report.persistence.code, 'state-save-failed');
  assert.deepEqual(report.controller.inventory.error, { code: 'controller-timeout', status: 504 });
  assert.deepEqual(report.history[0].results, { count: 2, ok: 1, failed: 1, minDelay: 80, maxDelay: 80 });
  assert.equal(report.history[0].decision.action, 'hold');
  assert.equal(report.history[0].decision.code, 'below-threshold');
  assert.equal(report.history[0].decision.thresholdMs, 25);
  assert.equal(report.history[0].decision.evidence.best.scoreMs, 80);
  assert.equal(report.history[0].decision.commit.writeResult, 'not-started');
  assert.deepEqual(report.automation.settings, { switchThresholdMs: 25, samples: 3 });
});

test('identifiers expose neither name hashes nor a stable mapping across reports', () => {
  const first = createDiagnosticsReport({ history: [{ group: 'Alpha' }, { group: 'Beta' }] });
  const second = createDiagnosticsReport({ history: [{ group: 'Beta' }, { group: 'Alpha' }] });
  assert.equal(first.history[0].groupId, 'n1');
  assert.equal(second.history[0].groupId, 'n1');
  assert.notEqual(first.history[0].groupId, second.history[1].groupId);
  assert.equal(first.identifierScheme, 'report-local-index');
  assert.match(first.privacy, /review before sharing/);
});
