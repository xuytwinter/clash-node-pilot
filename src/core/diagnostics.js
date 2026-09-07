const { DiagnosticCode, CapabilityState } = require('./capabilities');

const CODES = new Set([...Object.values(DiagnosticCode), ...(
  'ok controller-timeout invalid-controller-json controller-http-error operation-cancelled job-conflict job-cancelled job-timeout '
  + 'state-save-failed state-invalid-schema state-future-schema state-load-failed state-restored-from-backup state-read-only state-upgraded state-reset-after-invalid state-preserve-failed '
  + 'no-healthy-candidate current-best switch-disabled monitor-only cooldown-active below-threshold switch-approved '
  + 'group-stale already-active external-change write-result-unknown switched write-not-applied unsupported-selector-chain '
  + 'manual-protection current-healthy no-actionable-group no-selector-group unknown-current-region not-due '
  + 'common-probe-failure target-service-outage all-candidates-failed'
).split(' ')]);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = (value) => Array.isArray(value) ? value : [];
const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const pick = (value, allowed) => allowed.includes(value) ? value : null;
const code = (value) => CODES.has(value) ? value : 'unknown';
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
const fields = (value, names, parse) => compact(Object.fromEntries(names.split(' ').map((key) => [key, parse(object(value)[key])])));
const numbers = (value, names) => fields(value, names, number);
const booleans = (value, names) => fields(value, names, (item) => typeof item === 'boolean' ? item : null);
const version = (value) => typeof value === 'string' && /^v?\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value) ? value : null;
const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;

// Only fixed schema fields cross this boundary; identifiers have meaning within one report.
function createDiagnosticsReport(input = {}) {
  const ids = new Map();
  function id(value) {
    if (typeof value !== 'string' || !value) return null;
    if (!ids.has(value)) ids.set(value, `n${ids.size + 1}`);
    return ids.get(value);
  }
  const references = (value, names) => compact(Object.fromEntries(names.split(' ').map((key) => [`${key}Id`, id(object(value)[key])])));
  const error = (value) => ({ code: code(object(value).code), ...numbers(value, 'status controllerStatus') });
  const commit = (value) => compact({ ...booleans(value, 'started verified cancelledAfterCommit'), reasonCode: code(object(value).reasonCode), writeResult: pick(object(value).writeResult, ['not-started', 'verified', 'not-applied', 'unknown']) });
  const node = (value) => compact({ ...references(value, 'name'), ...booleans(value, 'ok'), ...numbers(value, 'delay score scoreMs successCount failureCount jitter') });
  function results(value) {
    const items = list(value);
    const delays = items.map((item) => number(item?.delay)).filter((item) => item !== null);
    const ok = items.filter((item) => item?.ok === true).length;
    return compact({ count: items.length, ok, failed: items.length - ok, minDelay: delays.length ? delays.reduce((a, b) => Math.min(a, b)) : null, maxDelay: delays.length ? delays.reduce((a, b) => Math.max(a, b)) : null });
  }
  function decision(value) {
    const item = object(value);
    return compact({ code: code(item.code), action: pick(item.action, ['hold', 'switch', 'uncertain']), ...references(item, 'target'), ...numbers(item, 'scoreDeltaRoundedMs thresholdMs'), protection: numbers(item.protection, 'remainingCooldownMs'), evidence: { best: node(item.evidence?.best), current: node(item.evidence?.current) }, commit: commit(item.commit) });
  }
  function history(value) {
    const item = object(value);
    return compact({ at: timestamp(item.at), source: pick(item.source, ['automatic', 'manual', 'connectivity-heal']), ...references(item, 'backend group controlGroup previous active'), code: code(item.reasonCode || item.code), ...booleans(item, 'skipped switched'), ...numbers(item, 'success candidates'), best: node(item.best), results: results(item.results), decision: decision(item.decision), commit: commit(item.commit) });
  }
  function backend(value) {
    const item = object(value);
    return compact({ id: id(item.id), ...booleans(item, 'online writable hasSecret'), version: version(item.version), nodeCount: number(item.nodeCount), current: node(item.current), diagnostic: error(item.diagnostic), capabilities: fields(item.capabilities, 'discovery authenticatedControl switching startupBackground readOnly', (state) => pick(state, Object.values(CapabilityState))) });
  }
  const automation = object(input.automation);
  const controller = object(input.controller);
  const health = Object.values(object(input.health)).filter((item) => item && typeof item === 'object' && !Array.isArray(item));
  return {
    schemaVersion: 1,
    identifierScheme: 'report-local-index',
    privacy: 'Names, paths, endpoints and free text are omitted. Timings and statistics remain; review before sharing.',
    generatedAt: timestamp(input.generatedAt),
    app: { name: 'Clash Node Pilot', version: version(input.app?.version) },
    runtime: compact({ node: version(input.runtime?.node), platform: pick(input.runtime?.platform, ['win32', 'linux', 'darwin', 'freebsd', 'openbsd', 'aix', 'sunos']), arch: pick(input.runtime?.arch, ['x64', 'arm64', 'ia32', 'arm', 'ppc64', 's390x', 'riscv64']), ...booleans(input.runtime, 'portableNode') }),
    environment: booleans(input.environment, 'demoMode osIntegrationDisabled autoLoopDisabled explicitConfig explicitStatePath v2raynHomeSet'),
    server: numbers(input.server, 'port'),
    startup: booleans(input.startup, 'supported enabled'),
    backend: input.backend ? backend(input.backend) : null,
    backends: list(input.backends).map(backend),
    detectedClients: list(input.detectedClients).map(backend),
    controller: { ...booleans(controller, 'connected'), inventory: { ...booleans(controller.inventory, 'ok'), ...numbers(controller.inventory, 'groupCount'), ...(controller.inventory?.error ? { error: error(controller.inventory.error) } : {}) }, groups: list(controller.groups).map((group) => ({ ...references(group, 'name now'), nodeCount: list(group?.members).length })) },
    automation: {
      ...booleans(automation, 'running monitorOnly'), ...numbers(automation, 'activeLocks lastAutoCount lastSwitchCount'),
      nextRunAt: timestamp(automation.nextRunAt), nextConnectivityCheckAt: timestamp(automation.nextConnectivityCheckAt),
      currentJob: automation.currentJob ? { ...references(automation.currentJob, 'group backendId'), ...numbers(automation.currentJob, 'timeoutMs'), ...booleans(automation.currentJob, 'commitStarted'), status: pick(automation.currentJob.status, ['running', 'committing']) } : null,
      settings: numbers(automation.settings, 'autoIntervalMinutes switchThresholdMs switchCooldownMinutes healthHalfLifeMinutes manualTimeoutMs samples manualPauseMinutes connectivityCheckMinutes connectivityTimeoutMs')
    },
    persistence: { ...booleans(input.persistence, 'writable restoredFromBackup'), code: code(input.persistence?.code) },
    health: { trackedNodes: health.length, successSamples: health.reduce((sum, item) => sum + (number(item.success) || 0), 0), failureSamples: health.reduce((sum, item) => sum + (number(item.failure) || 0), 0) },
    lastResults: input.lastResults ? history(input.lastResults) : null,
    history: list(input.history).slice(0, 25).map(history),
    diagnostics: list(input.diagnostics).slice(0, 25).map((item) => compact({ at: timestamp(item?.at), code: code(item?.code) }))
  };
}

module.exports = { createDiagnosticsReport };
