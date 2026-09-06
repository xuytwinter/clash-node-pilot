const STATE_SCHEMA_VERSION = 2;

function stateSchemaError(message, code) {
  return Object.assign(new Error(message), { code });
}

function assertSupportedStateSchema(saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;
  if (!Object.hasOwn(saved, 'schemaVersion') || saved.schemaVersion === undefined || saved.schemaVersion === null) return;
  const version = Number(saved.schemaVersion);
  if (!Number.isInteger(version) || version < 0) {
    throw stateSchemaError('Runtime state schema version is invalid', 'state-invalid-schema');
  }
  if (version > STATE_SCHEMA_VERSION) {
    throw stateSchemaError('Runtime state was written by a newer version', 'state-future-schema');
  }
}

function clampNumber(value, fallback, min, max, { integer = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return integer ? Math.trunc(clamped) : clamped;
}

function sanitizeSettings(saved, defaults) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  return {
    autoIntervalMinutes: clampNumber(source.autoIntervalMinutes, defaults.autoIntervalMinutes, 1, 60),
    switchThresholdMs: clampNumber(source.switchThresholdMs, defaults.switchThresholdMs, 0, 500),
    switchCooldownMinutes: clampNumber(source.switchCooldownMinutes, defaults.switchCooldownMinutes, 0, 1440),
    healthHalfLifeMinutes: clampNumber(source.healthHalfLifeMinutes, defaults.healthHalfLifeMinutes, 1, 10080),
    manualTestUrl: typeof source.manualTestUrl === 'string' && source.manualTestUrl ? source.manualTestUrl : defaults.manualTestUrl,
    manualTimeoutMs: clampNumber(source.manualTimeoutMs, defaults.manualTimeoutMs, 1000, 10000),
    samples: clampNumber(source.samples, defaults.samples, 1, 5),
    manualPauseMinutes: clampNumber(source.manualPauseMinutes, defaults.manualPauseMinutes, 1, 1440),
    connectivityCheckMinutes: clampNumber(source.connectivityCheckMinutes, defaults.connectivityCheckMinutes, 1, 30),
    connectivityTimeoutMs: clampNumber(source.connectivityTimeoutMs, defaults.connectivityTimeoutMs, 1000, 10000)
  };
}

function sanitizeTimestamp(value) {
  if (typeof value !== 'string') return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function sanitizeMapEntries(input, { now = Date.now(), futureOnly = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => {
    if (typeof key !== 'string' || !key) return [];
    const number = Number(value);
    if (!Number.isFinite(number)) return [];
    if (futureOnly && number <= now) return [];
    return [[key, number]];
  });
}

function sanitizeLastAuto(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.entries(input).flatMap(([key, value]) => (
    typeof key === 'string' && key && typeof value === 'string' && value ? [[key, value]] : []
  ));
}

function sanitizeHealth(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const health = {};
  for (const [key, value] of Object.entries(input)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const success = clampNumber(value.success, 0, 0, 100000, { integer: false });
    const failure = clampNumber(value.failure, 0, 0, 100000, { integer: false });
    const latencies = Array.isArray(value.latencies)
      ? value.latencies.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0).slice(0, 20)
      : [];
    let fallbackName = key.split('|').at(-1) || key;
    try {
      fallbackName = decodeURIComponent(fallbackName);
    } catch { /* keep the raw key fragment */ }
    health[key] = {
      name: typeof value.name === 'string' ? value.name : fallbackName,
      backendId: typeof value.backendId === 'string' ? value.backendId : null,
      group: typeof value.group === 'string' ? value.group : null,
      success,
      failure,
      latencies,
      jitter: clampNumber(value.jitter, 0, 0, 10000, { integer: false }),
      updatedAt: sanitizeTimestamp(value.updatedAt) || new Date(0).toISOString()
    };
  }
  return health;
}

function sanitizeDiagnostics(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 50).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    return [{
      at: sanitizeTimestamp(item.at) || new Date(0).toISOString(),
      code: typeof item.code === 'string' ? item.code : 'unknown',
      message: typeof item.message === 'string' ? item.message : 'Diagnostic event'
    }];
  });
}

function sanitizeRuntimeSnapshot(saved, defaults, { now = Date.now() } = {}) {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  assertSupportedStateSchema(source);
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    history: Array.isArray(source.history) ? source.history.filter((item) => item && typeof item === 'object').slice(0, 100) : [],
    health: sanitizeHealth(source.health),
    lastResults: source.lastResults && typeof source.lastResults === 'object' ? source.lastResults : null,
    monitorOnly: Boolean(source.monitorOnly),
    nextRunAt: sanitizeTimestamp(source.nextRunAt),
    nextConnectivityCheckAt: sanitizeTimestamp(source.nextConnectivityCheckAt),
    locks: Object.fromEntries(sanitizeMapEntries(source.locks, { now, futureOnly: true })),
    lastAuto: Object.fromEntries(sanitizeLastAuto(source.lastAuto)),
    lastSwitch: Object.fromEntries(sanitizeMapEntries(source.lastSwitch, { now })),
    settings: sanitizeSettings(source.settings, defaults),
    selectedBackend: typeof source.selectedBackend === 'string' ? source.selectedBackend : null,
    diagnostics: sanitizeDiagnostics(source.diagnostics)
  };
}

module.exports = {
  STATE_SCHEMA_VERSION,
  assertSupportedStateSchema,
  clampNumber,
  sanitizeHealth,
  sanitizeRuntimeSnapshot,
  sanitizeSettings
};
