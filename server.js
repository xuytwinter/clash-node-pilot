const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createDiagnosticsReport } = require('./src/core/diagnostics');
const { execFileSync } = require('node:child_process');
const { ControllerClient, parseConfig: parseControllerConfig, probeConfigBackend, safeBackend } = require('./src/core/controller');
const { createRegionResolver, loadRegions, summarizeRegions: summarizeRegionCounts } = require('./src/core/regions');
const { JobCoordinator } = require('./src/core/jobs');
const { normalizeProbeUrl, requireJsonContentType, securityHeaders, validateLocalApiRequest, createLocalSession } = require('./src/core/security');
const { STATE_SCHEMA_VERSION, clampNumber, sanitizeRuntimeSnapshot } = require('./src/core/state');
const connectivityCore = require('./src/core/connectivity');
const decisionCore = require('./src/core/decision');
const optimizerCore = require('./src/core/optimizer');
const clock = require('./src/core/clock');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
const DEMO_MODE = process.env.CLASH_PILOT_DEMO === '1';
const OS_INTEGRATION_DISABLED = DEMO_MODE || process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION === '1';
const STATIC_ROOT = path.join(__dirname, 'public');
const VERGE_CONFIG_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'io.github.clash-verge-rev.clash-verge-rev',
  'config.yaml'
);
const CFW_CONFIG_PATH = path.join(os.homedir(), '.config', 'clash', 'config.yaml');
const MIHOMO_BACKENDS = [
  ...(process.env.CLASH_CONFIG ? [{ id: DEMO_MODE ? 'demo' : 'custom', name: DEMO_MODE ? 'Demo Fake Mihomo' : 'Custom Clash/Mihomo', configPath: process.env.CLASH_CONFIG }] : []),
  ...(!DEMO_MODE ? [
    { id: 'clash-verge', name: 'Clash Verge Rev', configPath: VERGE_CONFIG_PATH },
    { id: 'clash-for-windows', name: 'Clash for Windows', configPath: CFW_CONFIG_PATH }
  ] : [])
];
const WEBVIEW_LEVELDB = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'io.github.clash-verge-rev.clash-verge-rev', 'EBWebView', 'Default', 'Local Storage', 'leveldb'
);
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const VERIFY_TEST_URL = 'https://cp.cloudflare.com/generate_204';
const CONNECTIVITY_TEST_URLS = connectivityCore.DEFAULT_CONNECTIVITY_TARGETS;
const TARGET_GROUP = process.env.CLASH_TARGET_GROUP || '🐟漏网之鱼';
const SWITCH_THRESHOLD_MS = Number(process.env.SWITCH_THRESHOLD_MS || 25);
const SWITCH_COOLDOWN_MINUTES = Number(process.env.SWITCH_COOLDOWN_MINUTES || 5);
const HEALTH_HALF_LIFE_MINUTES = Number(process.env.HEALTH_HALF_LIFE_MINUTES || 60);
const MANUAL_PAUSE_MS = Number(process.env.MANUAL_PAUSE_MINUTES || 15) * 60 * 1000;
const DEFAULT_JOB_BUDGET_MS = 120000;
const LEGACY_STATE_PATH = path.join(__dirname, 'data', 'state.json');
function resolvePilotDataDir(env = process.env) {
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ClashNodePilot');
}
function resolveStatePath(env = process.env) {
  return env.CLASH_PILOT_STATE ? path.resolve(env.CLASH_PILOT_STATE) : path.join(resolvePilotDataDir(env), 'state.json');
}
function migrateLegacyState(statePath = resolveStatePath(), legacyPath = LEGACY_STATE_PATH, env = process.env) {
  if (env.CLASH_PILOT_STATE || fsSync.existsSync(statePath) || !fsSync.existsSync(legacyPath)) return false;
  fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
  fsSync.copyFileSync(legacyPath, statePath);
  return true;
}
const STATE_PATH = resolveStatePath();
const DEFAULT_SETTINGS = {
  autoIntervalMinutes: 3,
  switchThresholdMs: SWITCH_THRESHOLD_MS,
  switchCooldownMinutes: SWITCH_COOLDOWN_MINUTES,
  healthHalfLifeMinutes: HEALTH_HALF_LIFE_MINUTES,
  manualTestUrl: DEFAULT_TEST_URL,
  manualTimeoutMs: 5000,
  samples: 2,
  manualPauseMinutes: MANUAL_PAUSE_MS / 60000,
  connectivityCheckMinutes: 1,
  connectivityTimeoutMs: 5000
};
const runtime = {
  history: [],
  health: {},
  lastResults: null,
  locks: new Map(),
  lastAuto: new Map(),
  lastSwitch: new Map(),
  nextRunAt: null,
  nextConnectivityCheckAt: null,
  monitorOnly: false,
  selectedBackend: null,
  settings: { ...DEFAULT_SETTINGS },
  diagnostics: [],
  persistence: { writable: true, code: 'ok', message: 'Runtime state is writable', restoredFromBackup: false }
};
const coordinator = new JobCoordinator({ now: clock.now });
const localSession = createLocalSession();

function addDiagnostic(code, message) {
  runtime.diagnostics.unshift({ at: new Date(clock.now()).toISOString(), code, message });
  runtime.diagnostics = runtime.diagnostics.slice(0, 50);
}

function stateError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function setPersistenceStatus(status) {
  runtime.persistence = { ...runtime.persistence, ...status };
}

function ensureStateWritable() {
  if (!runtime.persistence.writable && runtime.persistence.code !== 'state-save-failed') {
    throw stateError(runtime.persistence.message || 'Runtime state is read-only', 409, runtime.persistence.code || 'state-read-only');
  }
}

function applyRuntimeSnapshot(saved) {
  runtime.history = saved.history;
  runtime.health = saved.health;
  runtime.lastResults = saved.lastResults;
  runtime.monitorOnly = saved.monitorOnly;
  runtime.nextRunAt = saved.nextRunAt;
  runtime.nextConnectivityCheckAt = saved.nextConnectivityCheckAt;
  runtime.locks = new Map(Object.entries(saved.locks));
  runtime.lastAuto = new Map(Object.entries(saved.lastAuto));
  runtime.lastSwitch = new Map(Object.entries(saved.lastSwitch));
  runtime.settings = saved.settings;
  runtime.selectedBackend = saved.selectedBackend;
  runtime.diagnostics = saved.diagnostics;
}

function readRuntimeSnapshot(filePath) {
  const text = fsSync.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  return {
    upgraded: parsed?.schemaVersion !== STATE_SCHEMA_VERSION,
    saved: sanitizeRuntimeSnapshot(parsed, DEFAULT_SETTINGS, { now: clock.now() })
  };
}

function preserveUnreadableState(error) {
  const suffix = error.code === 'state-future-schema' ? 'future' : 'invalid';
  const preserved = `${STATE_PATH}.${suffix}`;
  fsSync.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fsSync.copyFileSync(STATE_PATH, preserved);
  return preserved;
}

function loadRuntimeState() {
  try {
    const { saved, upgraded } = readRuntimeSnapshot(STATE_PATH);
    applyRuntimeSnapshot(saved);
    setPersistenceStatus({ writable: true, code: 'ok', message: 'Runtime state is writable', restoredFromBackup: false });
    if (upgraded) addDiagnostic('state-upgraded', 'Runtime state was upgraded to the current schema');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    let preserved = null;
    let preserveError = null;
    try {
      preserved = preserveUnreadableState(error);
    } catch (copyError) {
      preserveError = copyError;
    }
    try {
      const { saved } = readRuntimeSnapshot(`${STATE_PATH}.bak`);
      applyRuntimeSnapshot(saved);
      setPersistenceStatus({
        writable: error.code !== 'state-future-schema',
        code: error.code === 'state-future-schema' ? 'state-future-schema' : 'state-restored-from-backup',
        message: error.code === 'state-future-schema'
          ? 'Runtime state was written by a newer version; writes are disabled to avoid overwriting it'
          : 'Runtime state was restored from backup and can be saved',
        restoredFromBackup: true
      });
      addDiagnostic('state-restored-from-backup', 'Runtime state was restored from the last backup');
      addDiagnostic(error.code || 'state-load-failed', preserved ? `Current runtime state was preserved at ${path.basename(preserved)}` : 'Current runtime state could not be loaded');
    } catch {
      setPersistenceStatus({
        writable: Boolean(preserved) && error.code !== 'state-future-schema',
        code: error.code === 'state-future-schema' ? 'state-future-schema' : (preserved ? 'state-reset-after-invalid' : 'state-load-failed'),
        message: error.code === 'state-future-schema'
          ? 'Runtime state was written by a newer version; writes are disabled to avoid overwriting it'
          : (preserved ? 'Runtime state could not be loaded and was preserved before using defaults' : 'Runtime state could not be loaded and writes are disabled'),
        restoredFromBackup: false
      });
      addDiagnostic(error.code || 'state-load-failed', preserved ? `Runtime state could not be loaded; preserved at ${path.basename(preserved)}` : 'Runtime state could not be loaded and was ignored');
    }
    if (preserveError) addDiagnostic('state-preserve-failed', 'Unreadable runtime state could not be copied aside');
  }
}

function persistRuntimeState(commitOutcome = coordinator.current?.commitOutcome) {
  ensureStateWritable();
  let temporary = null;
  try {
    fsSync.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    temporary = `${STATE_PATH}.tmp`;
    const snapshot = {
      schemaVersion: STATE_SCHEMA_VERSION,
      history: runtime.history,
      health: runtime.health,
      lastResults: runtime.lastResults,
      monitorOnly: runtime.monitorOnly,
      nextRunAt: runtime.nextRunAt,
      nextConnectivityCheckAt: runtime.nextConnectivityCheckAt,
      locks: Object.fromEntries(runtime.locks),
      lastAuto: Object.fromEntries(runtime.lastAuto),
      lastSwitch: Object.fromEntries(runtime.lastSwitch),
      settings: runtime.settings,
      selectedBackend: runtime.selectedBackend,
      diagnostics: runtime.diagnostics
    };
    fsSync.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), 'utf8');
    if (fsSync.existsSync(STATE_PATH) && !runtime.persistence.restoredFromBackup) fsSync.copyFileSync(STATE_PATH, `${STATE_PATH}.bak`);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        fsSync.renameSync(temporary, STATE_PATH);
        setPersistenceStatus({ writable: true, code: 'ok', message: 'Runtime state is writable', restoredFromBackup: false });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  } catch (error) {
    // Cleanup must not hide the save failure or a completed selector write.
    try { if (temporary) fsSync.rmSync(temporary, { force: true }); } catch {}
    addDiagnostic('state-save-failed', 'Runtime state could not be saved');
    setPersistenceStatus({ writable: false, code: 'state-save-failed', message: 'Runtime state could not be saved; retry after restoring storage access' });
    const failure = stateError('Runtime state could not be saved', 507, 'state-save-failed');
    if (commitOutcome) failure.commit = commitOutcome;
    throw failure;
  }
}

// Local settings mutations are synchronous, so rollback cannot overwrite another request.
function saveLocalMutation(mutate) {
  const keys = ['selectedBackend', 'monitorOnly', 'settings', 'locks', 'lastAuto', 'history', 'nextRunAt'];
  const previous = Object.fromEntries(keys.map((key) => [key, structuredClone(runtime[key])]));
  try {
    mutate();
    persistRuntimeState();
  } catch (error) {
    Object.assign(runtime, previous);
    throw error;
  }
}

migrateLegacyState();
loadRuntimeState();

const REGIONS = loadRegions(__dirname);
const resolveRegion = createRegionResolver(REGIONS);

function parseConfig(text) {
  return parseControllerConfig(text);
}

function regionFor(name) {
  return resolveRegion(name);
}

async function probeBackend(backend) {
  return probeConfigBackend(backend);
}

async function discoverBackends() {
  return Promise.all(MIHOMO_BACKENDS.map(probeBackend));
}

function discoverV2rayNHome() {
  if (OS_INTEGRATION_DISABLED) return null;
  if (process.env.V2RAYN_HOME && fsSync.existsSync(path.join(process.env.V2RAYN_HOME, 'v2rayN.exe'))) return process.env.V2RAYN_HOME;
  if (process.platform !== 'win32') return null;
  try {
    const executable = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process v2rayN -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
    return executable ? path.dirname(executable) : null;
  } catch { return null; }
}

function detectV2rayN() {
  const home = discoverV2rayNHome();
  if (!home) return { id: 'v2rayn', name: 'v2rayN', online: false, writable: false };
  try {
    const configPath = path.join(home, 'guiConfigs', 'guiNConfig.json');
    const config = JSON.parse(fsSync.readFileSync(configPath, 'utf8'));
    const result = { id: 'v2rayn', name: 'v2rayN', online: true, writable: false, mode: 'read-only' };
    try {
      const { DatabaseSync } = require('node:sqlite');
      const database = new DatabaseSync(path.join(home, 'guiConfigs', 'guiNDB.db'), { readOnly: true });
      const current = database.prepare('select p.Remarks as name, p.Subid as groupId, coalesce(e.Delay,0) as delay from ProfileItem p left join ProfileExItem e on e.IndexId=p.IndexId where p.IndexId=?').get(config.IndexId);
      const count = database.prepare('select count(*) as count from ProfileItem').get().count;
      database.close();
      result.current = current ? { name: current.name, delay: current.delay } : null;
      result.nodeCount = count;
    } catch { result.current = null; }
    return result;
  } catch { return { id: 'v2rayn', name: 'v2rayN', online: true, writable: false, mode: 'read-only', error: 'Configuration could not be read' }; }
}

function startupStatus() {
  if (OS_INTEGRATION_DISABLED) return { supported: false, enabled: false, source: null, disabled: true, reason: DEMO_MODE ? 'demo-mode' : 'os-integration-disabled' };
  if (process.platform !== 'win32') return { supported: false, enabled: false, source: null };
  try {
    execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Clash Node Pilot Startup'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Clash Node Pilot Optimizer'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return { supported: true, enabled: true, source: 'current-user' };
  } catch { /* check elevated scheduled tasks next */ }
  try {
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Startup'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Watchdog'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    execFileSync('schtasks.exe', ['/Query', '/TN', 'Clash Node Pilot Optimizer'], { stdio: 'ignore', timeout: 1500, windowsHide: true });
    return { supported: true, enabled: true, source: 'scheduled-task' };
  } catch { return { supported: true, enabled: false, source: null }; }
}

function setStartupEnabled(enabled) {
  if (OS_INTEGRATION_DISABLED) throw Object.assign(new Error('Startup management is disabled in demo mode'), { status: 403, code: 'startup-disabled' });
  if (process.platform !== 'win32') throw new Error('Startup management is currently available on Windows only');
  const current = startupStatus();
  if (!enabled && current.source === 'scheduled-task') throw new Error('当前使用管理员恢复任务，请以管理员身份运行 uninstall-autostart.ps1 关闭');
  const script = path.join(__dirname, enabled ? 'install-pilot-autostart.ps1' : 'uninstall-pilot-autostart.ps1');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'ignore', timeout: 10000, windowsHide: true });
  return startupStatus();
}

async function activeBackend() {
  const backends = await discoverBackends();
  return backends.find((item) => item.online && item.id === runtime.selectedBackend) || backends.find((item) => item.online) || null;
}

function controllerRequestForBackend(backend, job = null) {
  const client = new ControllerClient({ controller: backend.config.controller, secret: backend.config.secret });
  return (route, options = {}) => {
    const requestOptions = { ...options };
    if (!Object.hasOwn(requestOptions, 'signal')) requestOptions.signal = job?.signal;
    return client.request(route, requestOptions);
  };
}

async function controllerRequest(route, options = {}) {
  const { backend: fixedBackend, ...requestOptions } = options;
  const backend = fixedBackend || await activeBackend();
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  return controllerRequestForBackend(backend)(route, requestOptions);
}

async function inventoryForBackend(backend, request = controllerRequestForBackend(backend)) {
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  const payload = await request('/proxies');
  const { proxies, groups } = optimizerCore.selectorGroupsFromPayload(payload);
  return { proxies, groups, backend };
}

async function inventory() {
  return inventoryForBackend(await activeBackend());
}

async function selectedUiGroup(groups) {
  try {
    const files = (await fs.readdir(WEBVIEW_LEVELDB, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (entry.name.endsWith('.log') || entry.name.endsWith('.ldb')));
    const ranked = await Promise.all(files.map(async (entry) => ({ name: entry.name, mtime: (await fs.stat(path.join(WEBVIEW_LEVELDB, entry.name))).mtimeMs })));
    ranked.sort((a, b) => b.mtime - a.mtime);
    const data = await fs.readFile(path.join(WEBVIEW_LEVELDB, ranked[0].name));
    return detectSelectedGroupFromBuffer(data, groups);
  } catch {
    return null;
  }
}

function detectSelectedGroupFromBuffer(data, groups) {
  const key = Buffer.from('clash-verge-selected-proxy-group:');
  const position = data.lastIndexOf(key);
  if (position < 0) return null;
  const record = data.subarray(position, position + 512);
  return groups.find((group) => record.includes(Buffer.from(group.name, 'utf16le')))?.name || null;
}

async function pickPrimaryGroup(groups, backend) {
  const selected = backend?.id === 'clash-verge' ? await selectedUiGroup(groups) : null;
  return groups.find((group) => group.name === selected)
    || groups.find((group) => group.name === TARGET_GROUP)
    || groups.find((group) => /漏网之鱼|final|match/i.test(group.name))
    || groups.find((group) => /节点选择|proxy|select/i.test(group.name))
    || groups[0];
}

function summarizeRegions(members) {
  return summarizeRegionCounts(members, REGIONS, regionFor);
}

async function diagnosticsReport() {
  const backends = await discoverBackends();
  const backend = backends.find((item) => item.online && item.id === runtime.selectedBackend) || backends.find((item) => item.online);
  let controller = { connected: Boolean(backend), groups: [], inventory: { ok: false } };
  if (backend) {
    try {
      const { groups } = await inventoryForBackend(backend);
      controller = { connected: true, groups, inventory: { ok: true, groupCount: groups.length } };
    } catch (error) { controller.inventory.error = { code: error.code, status: error.status }; }
  }
  return createDiagnosticsReport({
    generatedAt: new Date(clock.now()).toISOString(),
    app: { version: require('./package.json').version },
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    environment: { demoMode: DEMO_MODE, osIntegrationDisabled: OS_INTEGRATION_DISABLED, autoLoopDisabled: process.env.CLASH_PILOT_DISABLE_AUTO_LOOP === '1' },
    server: { port: listeningPort() }, startup: startupStatus(), backend, backends, controller,
    automation: { ...runtime, running: Boolean(coordinator.snapshot()), currentJob: coordinator.snapshot(), activeLocks: [...runtime.locks.values()].filter((at) => at > clock.now()).length },
    persistence: runtime.persistence, health: runtime.health, lastResults: runtime.lastResults, history: runtime.history, diagnostics: runtime.diagnostics
  });
}

async function measureNode(name, testUrl, timeout, request = controllerRequest) {
  return optimizerCore.measureNode(request, name, testUrl, timeout);
}

async function measureNodeStable(name, testUrl, timeout, samples = 2, request = controllerRequest, job = null) {
  return optimizerCore.measureNodeStable(request, name, testUrl, timeout, samples, { signal: job?.signal });
}

function addHistory(entry) {
  runtime.history.unshift({ at: new Date(clock.now()).toISOString(), ...entry });
  runtime.history = runtime.history.slice(0, 100);
  persistRuntimeState(entry.commit);
}

function scopedGroupKey(backend, groupName) {
  return `${encodeURIComponent(backend?.id || 'default')}|${encodeURIComponent(groupName)}`;
}

function scopedHealth(backend, groupName) {
  return { backendId: backend?.id || 'default', group: groupName };
}

function lockRemainingFor(backend, groupName) {
  const scoped = runtime.locks.get(scopedGroupKey(backend, groupName)) || 0;
  const legacy = runtime.locks.get(groupName) || 0;
  return Math.max(0, Math.max(scoped, legacy) - clock.now());
}

function lockGroup(backend, groupName, durationMs = runtime.settings.manualPauseMinutes * 60000) {
  const expiresAt = clock.now() + durationMs;
  runtime.locks.set(scopedGroupKey(backend, groupName), expiresAt);
  runtime.locks.delete(groupName);
  return durationMs;
}

function clearGroupLock(backend, groupName) {
  runtime.locks.delete(scopedGroupKey(backend, groupName));
  runtime.locks.delete(groupName);
}

function getLastAuto(backend, groupName) {
  return runtime.lastAuto.get(scopedGroupKey(backend, groupName)) || runtime.lastAuto.get(groupName);
}

function setLastAuto(backend, groupName, value) {
  runtime.lastAuto.set(scopedGroupKey(backend, groupName), value);
  runtime.lastAuto.delete(groupName);
}

function clearLastAuto(backend, groupName) {
  runtime.lastAuto.delete(scopedGroupKey(backend, groupName));
  runtime.lastAuto.delete(groupName);
}

function getLastSwitch(backend, groupName) {
  const scoped = scopedGroupKey(backend, groupName);
  return runtime.lastSwitch.has(scoped) ? runtime.lastSwitch.get(scoped) : runtime.lastSwitch.get(groupName);
}

function setLastSwitch(backend, groupName, value = clock.now()) {
  runtime.lastSwitch.set(scopedGroupKey(backend, groupName), value);
  runtime.lastSwitch.delete(groupName);
}

function boundedNumber(value, fallback, min, max, { integer = true } = {}) {
  return clampNumber(value, fallback, min, max, { integer });
}

function nextAutoRunIso(now = clock.now()) {
  return new Date(now + runtime.settings.autoIntervalMinutes * 60000).toISOString();
}

function updateSettings(settings = {}) {
  const input = settings && typeof settings === 'object' ? settings : {};
  runtime.settings = {
    autoIntervalMinutes: Object.hasOwn(input, 'autoIntervalMinutes') ? boundedNumber(input.autoIntervalMinutes, runtime.settings.autoIntervalMinutes, 1, 60) : runtime.settings.autoIntervalMinutes,
    switchThresholdMs: Object.hasOwn(input, 'switchThresholdMs') ? boundedNumber(input.switchThresholdMs, runtime.settings.switchThresholdMs, 0, 500) : runtime.settings.switchThresholdMs,
    switchCooldownMinutes: Object.hasOwn(input, 'switchCooldownMinutes') ? boundedNumber(input.switchCooldownMinutes, runtime.settings.switchCooldownMinutes, 0, 1440) : runtime.settings.switchCooldownMinutes,
    healthHalfLifeMinutes: Object.hasOwn(input, 'healthHalfLifeMinutes') ? boundedNumber(input.healthHalfLifeMinutes, runtime.settings.healthHalfLifeMinutes, 1, 10080) : runtime.settings.healthHalfLifeMinutes,
    manualTestUrl: Object.hasOwn(input, 'manualTestUrl') ? normalizeTestUrl(input.manualTestUrl) : runtime.settings.manualTestUrl,
    manualTimeoutMs: Object.hasOwn(input, 'manualTimeoutMs') ? boundedNumber(input.manualTimeoutMs, runtime.settings.manualTimeoutMs, 1000, 10000) : runtime.settings.manualTimeoutMs,
    samples: Object.hasOwn(input, 'samples') ? boundedNumber(input.samples, runtime.settings.samples, 1, 5) : runtime.settings.samples,
    manualPauseMinutes: Object.hasOwn(input, 'manualPauseMinutes') ? boundedNumber(input.manualPauseMinutes, runtime.settings.manualPauseMinutes, 1, 1440) : runtime.settings.manualPauseMinutes,
    connectivityCheckMinutes: Object.hasOwn(input, 'connectivityCheckMinutes') ? boundedNumber(input.connectivityCheckMinutes, runtime.settings.connectivityCheckMinutes, 1, 30) : runtime.settings.connectivityCheckMinutes,
    connectivityTimeoutMs: Object.hasOwn(input, 'connectivityTimeoutMs') ? boundedNumber(input.connectivityTimeoutMs, runtime.settings.connectivityTimeoutMs, 1000, 10000) : runtime.settings.connectivityTimeoutMs
  };
}

function normalizeTestUrl(value) {
  return normalizeProbeUrl(value, { allowed: new Set([DEFAULT_TEST_URL, VERIFY_TEST_URL]) });
}

async function readGroupNow(request, groupName) {
  const payload = await request('/proxies');
  const active = payload.proxies?.[groupName]?.now;
  if (typeof active !== 'string') throw Object.assign(new Error('Selector group disappeared during optimization'), { status: 409, code: 'group-stale' });
  return active;
}

async function applySelectorDecision({ backend, request, group, target, allowSwitch, jobKind, job = null }) {
  if (!allowSwitch) return { active: group.now, switched: false, reasonCode: 'switch-disabled', commit: selectorCommitState({ reasonCode: 'switch-disabled', active: group.now, target }) };
  if (runtime.monitorOnly) return { active: group.now, switched: false, reasonCode: 'monitor-only', commit: selectorCommitState({ reasonCode: 'monitor-only', active: group.now, target }) };
  if (group.now === target) return { active: group.now, switched: false, reasonCode: 'already-active', commit: selectorCommitState({ reasonCode: 'already-active', active: group.now, target }) };

  const current = await readGroupNow(request, group.name);
  if (current !== group.now) {
    const lockMs = lockGroup(backend, group.name);
    persistRuntimeState();
    return { active: current, switched: false, reasonCode: 'external-change', lockMs, commit: selectorCommitState({ reasonCode: 'external-change', active: current, target }) };
  }

  optimizerCore.throwIfAborted(job?.signal);
  job?.beginCommit?.();
  const commitRequest = (route, options = {}) => request(route, { ...options, signal: null });
  let active;
  try {
    await commitRequest(`/proxies/${encodeURIComponent(group.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ name: target })
    });
    active = await readGroupNow(commitRequest, group.name);
  } catch (error) {
    const commit = selectorCommitState({ started: true, writeResult: 'unknown', verified: false, reasonCode: 'write-result-unknown', active: null, target, job, error });
    if (job) Object.defineProperty(job, 'commitOutcome', { configurable: true, value: commit });
    return {
      active: group.now,
      switched: false,
      reasonCode: 'write-result-unknown',
      commit
    };
  }
  const switched = active === target;
  if (job) Object.defineProperty(job, 'commitOutcome', {
    configurable: true,
    value: selectorCommitState({ started: true, writeResult: switched ? 'verified' : 'not-applied', verified: switched, reasonCode: switched ? 'switched' : 'write-not-applied', active, target, job })
  });
  if (switched) setLastSwitch(backend, group.name);
  if (switched && jobKind === 'manual') {
    lockGroup(backend, group.name);
    persistRuntimeState();
  }
  return {
    active,
    switched,
    reasonCode: switched ? 'switched' : 'write-not-applied',
    commit: selectorCommitState({
      started: true,
      writeResult: switched ? 'verified' : 'not-applied',
      verified: switched,
      reasonCode: switched ? 'switched' : 'write-not-applied',
      active,
      target,
      job
    })
  };
}

function updateHealth(results, scope = {}) {
  optimizerCore.updateHealth(runtime.health, results, scope, {
    now: clock.now(),
    healthHalfLifeMinutes: runtime.settings.healthHalfLifeMinutes
  });
}

function healthScore(result, scope = {}) {
  return decisionCore.scoreNode(result, runtime.health[optimizerCore.scopedNodeKey(scope, result.name)] || runtime.health[result.name], optimizerCore.scopedNodeKey(scope, result.name), runtime.settings, { now: clock.now() }).score;
}

function healthSnapshot() {
  return Object.fromEntries(Object.entries(runtime.health).map(([key, value]) => [
    key,
    { ...value, latencies: Array.isArray(value.latencies) ? [...value.latencies] : [] }
  ]));
}

function healthScoreFrom(result, scope = {}, health = runtime.health) {
  const key = optimizerCore.scopedNodeKey(scope, result.name);
  return decisionCore.scoreNode(result, health[key] || health[result.name], key, runtime.settings, { now: clock.now() }).score;
}

function healthByName(results, scope = {}, health = runtime.health) {
  const entries = {};
  for (const result of results) {
    entries[result.name] = health[optimizerCore.scopedNodeKey(scope, result.name)] || health[result.name];
  }
  return entries;
}

function scoredResult(score) {
  if (!score?.result) return null;
  return {
    ...score.result,
    score: score.scoreMs,
    scoring: {
      components: score.components,
      evidence: score.evidence
    }
  };
}

function scoredResultsFromDecision(decisionEvent) {
  return (decisionEvent.evidence?.ranked || []).map(scoredResult).filter(Boolean);
}

function selectorCommitState({ started = false, writeResult = 'not-started', verified = false, reasonCode = null, active = null, target = null, job = null, error = null } = {}) {
  return {
    started: Boolean(started),
    writeResult,
    verified: Boolean(verified),
    reasonCode,
    active,
    target,
    cancelPolicy: started ? 'finish-after-commit-started' : 'cancel-before-commit',
    cancelledAfterCommit: Boolean(started && job?.signal?.aborted),
    ...(error ? { error: { code: error.code || error.name || 'commit-error', message: error.message || 'Selector write result is unknown' } } : {})
  };
}

function compactEvidence(result) {
  if (!result) return null;
  return {
    name: result.name,
    ok: Boolean(result.ok),
    scoreMs: result.score ?? result.delay ?? null,
    components: result.scoring?.components || {
      latencyMs: result.delay ?? null,
      failurePenaltyMs: result.failureCount ? result.failureCount * 200 : 0,
      jitterPenaltyMs: result.jitter ? Math.round(result.jitter * 0.5) : 0
    },
    evidence: result.scoring?.evidence || {
      successCount: result.successCount || 0,
      failureCount: result.failureCount || 0,
      sampleCount: (result.successCount || 0) + (result.failureCount || 0)
    },
    result
  };
}

function selectorDecisionEvent({ code, reason, currentName, active, best, current, results = [], allowSwitch = true, commit = null }) {
  const action = code === 'target-service-outage' || code === 'common-probe-failure' || code === 'all-candidates-failed' || code === 'no-healthy-candidate' || code === 'write-result-unknown'
    ? 'uncertain'
    : (code === 'switched' ? 'switch' : 'hold');
  return {
    at: new Date(clock.now()).toISOString(),
    action,
    code,
    reason,
    current: currentName || current?.name || active || null,
    target: best?.name || active || null,
    thresholdMs: null,
    scoreDeltaMs: null,
    protection: {
      monitorOnly: Boolean(runtime.monitorOnly),
      allowSwitch: Boolean(allowSwitch),
      cooldownMs: 0,
      remainingCooldownMs: 0,
      cooldownBypassed: false,
      hardFailure: Boolean(current && current.ok === false)
    },
    evidence: {
      current: compactEvidence(current),
      best: compactEvidence(best),
      ranked: results.map(compactEvidence).filter(Boolean)
    },
    commit: commit || selectorCommitState({ reasonCode: code, active: currentName || current?.name || active || null, target: best?.name || active || null })
  };
}

function finalizedDecisionEvent(policyEvent, decision) {
  const uncertain = decision.reasonCode === 'write-result-unknown';
  return {
    ...policyEvent,
    code: decision.reasonCode,
    reason: decision.reasonCode,
    action: decision.switched ? 'switch' : (uncertain ? 'uncertain' : 'hold'),
    commit: decision.commit || selectorCommitState({ reasonCode: decision.reasonCode, active: decision.active || policyEvent.current, target: policyEvent.target })
  };
}

async function mapLimit(items, limit, mapper, options = {}) {
  return optimizerCore.mapLimit(items, limit, mapper, options);
}

async function measureTargets(name, targets, timeout, request, job = null) {
  const checks = [];
  for (const target of targets) {
    optimizerCore.throwIfAborted(job?.signal);
    checks.push({ ...target, ...(await measureNode(name, target.url, timeout, request)) });
  }
  const okChecks = checks.filter((item) => item.ok);
  return {
    name,
    ok: okChecks.length === checks.length,
    delay: okChecks.length ? Math.max(...okChecks.map((item) => item.delay)) : null,
    checks,
    successCount: okChecks.length,
    failureCount: checks.length - okChecks.length
  };
}

function addMeasured(results, batch) {
  results.push(...batch);
}

function realMembers(proxies, groupName) {
  return connectivityCore.realMembers(proxies, groupName, optimizerCore.GROUP_TYPES);
}

function resolveEffectiveSelector(proxies, groupName) {
  return connectivityCore.resolveEffectiveSelector(proxies, groupName);
}

async function runConnectivityHeal(body = {}) {
  const backend = await activeBackend();
  if (!backend) throw apiError('No supported Clash/Mihomo controller is online', 503, 'controller-offline');
  const now = clock.now();

  return coordinator.run('connectivity-heal', { backend, timeoutMs: jobBudgetFromBody(body, 60000) }, async (job) => {
    runtime.nextConnectivityCheckAt = new Date(now + runtime.settings.connectivityCheckMinutes * 60000).toISOString();
    persistRuntimeState();

    const request = controllerRequestForBackend(backend, job);
    const { proxies, groups } = await inventoryForBackend(backend, request);
    const selected = backend.id === 'clash-verge' ? await selectedUiGroup(groups) : null;
    const groupNames = connectivityCore.connectivityGroupCandidates(proxies, groups, selected, TARGET_GROUP);
    const checkedControls = new Set();
    const attempts = [];
    const targets = CONNECTIVITY_TEST_URLS;
    const timeout = boundedNumber(body.timeout, runtime.settings.connectivityTimeoutMs, 1000, 10000);

    for (const groupName of groupNames) {
      const resolved = resolveEffectiveSelector(proxies, groupName);
      const controlGroup = resolved.controlGroup;
      if (checkedControls.has(controlGroup)) continue;
      checkedControls.add(controlGroup);
      job.group = controlGroup;

      if (resolved.unsupported || !resolved.leaf || !connectivityCore.isRealNode(proxies, resolved.leaf, optimizerCore.GROUP_TYPES)) {
        const reason = '当前选择不是可安全控制的真实节点';
        attempts.push({ group: groupName, controlGroup, skipped: true, reason, code: 'unsupported-selector-chain', resolved, decision: selectorDecisionEvent({ code: 'unsupported-selector-chain', reason, active: resolved.leaf, allowSwitch: body.switch !== false }) });
        continue;
      }

      const locked = lockRemainingFor(backend, controlGroup);
      if (locked > 0) {
        const reason = '手动保护中';
        attempts.push({ group: groupName, controlGroup, skipped: true, reason, code: 'manual-protection', lockMs: locked, resolved, decision: selectorDecisionEvent({ code: 'manual-protection', reason, active: resolved.leaf, allowSwitch: body.switch !== false }) });
        continue;
      }

      const previousAuto = getLastAuto(backend, controlGroup);
      if (previousAuto && previousAuto !== resolved.leaf) {
        const lockMs = lockGroup(backend, controlGroup);
        persistRuntimeState();
        const reason = '检测到手动切换，已暂停保通切换';
        attempts.push({ group: groupName, controlGroup, skipped: true, reason, code: 'external-change', lockMs, resolved, decision: selectorDecisionEvent({ code: 'external-change', reason, active: resolved.leaf, allowSwitch: body.switch !== false }) });
        continue;
      }

      const scope = scopedHealth(backend, controlGroup);
      const healthView = healthSnapshot();
      const measuredForHealth = [];
      const current = await measureTargets(resolved.leaf, targets, timeout, request, job);
      measuredForHealth.push(current);
      if (current.ok) {
        updateHealth(measuredForHealth, scope);
        setLastAuto(backend, controlGroup, resolved.leaf);
        const reason = '当前 Google/OpenAI 探测链路健康';
        attempts.push({ group: groupName, controlGroup, skipped: true, reason, code: 'current-healthy', resolved, current, decision: selectorDecisionEvent({ code: 'current-healthy', reason, active: resolved.leaf, current, results: [current], allowSwitch: body.switch !== false }) });
        continue;
      }

      const members = realMembers(proxies, controlGroup).filter((name) => name !== resolved.leaf);
      const currentRegion = regionFor(resolved.leaf);
      const sameRegion = currentRegion === 'other' ? [] : members.filter((name) => regionFor(name) === currentRegion);
      const alternatives = members.filter((name) => !sameRegion.includes(name));
      const batches = [
        { fallbackFrom: null, candidates: sameRegion },
        { fallbackFrom: currentRegion === 'other' ? null : currentRegion, candidates: alternatives }
      ].filter((batch) => batch.candidates.length > 0);

      let results = [];
      const resultBatches = [];
      let best = null;
      let fallbackFrom = null;
      for (const batch of batches) {
        const batchResults = await mapLimit(batch.candidates, 4, (name) => measureTargets(name, targets, timeout, request, job), { signal: job.signal });
        measuredForHealth.push(...batchResults);
        batchResults.sort((a, b) => (a.ok ? healthScoreFrom(a, scope, healthView) : Infinity) - (b.ok ? healthScoreFrom(b, scope, healthView) : Infinity));
        resultBatches.push({ fallbackFrom: batch.fallbackFrom, candidates: [...batch.candidates], results: batchResults });
        results = batchResults;
        best = batchResults.find((item) => item.ok);
        fallbackFrom = batch.fallbackFrom;
        if (best) break;
      }
      const evidenceResults = resultBatches.flatMap((batch) => batch.results);

      if (!best) {
        const targetIds = targets.map((target) => target.id);
        const diagnosis = connectivityCore.targetOutageDiagnosis(current, evidenceResults, targetIds);
        const reason = {
          'target-service-outage': '目标探测服务可能不可用，保持当前节点',
          'common-probe-failure': '所有探测目标在所有候选节点上均失败，无法判断是目标故障还是本地网络不可用',
          'all-candidates-failed': '候选节点无法同时通过 Google/OpenAI 保通检查'
        }[diagnosis.code] || '候选节点无法同时通过 Google/OpenAI 保通检查';
        updateHealth(measuredForHealth, scope);
        const attempt = { group: groupName, controlGroup, skipped: true, reason, code: diagnosis.code, diagnosis: diagnosis.confidence, resolved, current, fallbackFrom, results: evidenceResults, resultBatches, targetSummary: diagnosis.targetSummary, decision: selectorDecisionEvent({ code: diagnosis.code, reason, active: resolved.leaf, current, results: evidenceResults, allowSwitch: body.switch !== false }) };
        attempts.push(attempt);
        if (diagnosis.code === 'target-service-outage' || diagnosis.code === 'common-probe-failure') return { status: 200, body: { jobId: job.id, source: 'connectivity-heal', backend: backend.id, ...attempt, attempts } };
        continue;
      }
      const orderedResults = [best, ...evidenceResults.filter((item) => item.name !== best.name)];

      const decision = await applySelectorDecision({
        backend,
        request,
        group: { name: controlGroup, now: resolved.leaf },
        target: best.name,
        allowSwitch: body.switch !== false,
        jobKind: 'heal',
        job
      });
      setLastAuto(backend, controlGroup, decision.active);
      updateHealth(measuredForHealth, scope);
      const reason = 'Google/OpenAI 探测链路失败，已选择健康备用节点';
      const entry = { group: groupName, controlGroup, skipped: false, reason, code: decision.reasonCode, resolved, previous: resolved.leaf, active: decision.active, current, best, switched: decision.switched, fallbackFrom, results: orderedResults, resultBatches, commit: decision.commit, decision: selectorDecisionEvent({ code: decision.reasonCode, reason, currentName: resolved.leaf, active: decision.active, best, current, results: orderedResults, allowSwitch: body.switch !== false, commit: decision.commit }) };
      return { status: 200, body: { jobId: job.id, source: 'connectivity-heal', backend: backend.id, ...entry, attempts: [...attempts, entry] } };
    }

    return { status: 200, body: { jobId: job.id, source: 'connectivity-heal', backend: backend.id, skipped: true, reason: '未发现需要切换的 Google/OpenAI 出站链路', code: 'no-actionable-group', attempts } };
  });
}

function recordConnectivityResult(result) {
  runtime.lastResults = {
    at: new Date(clock.now()).toISOString(),
    source: 'connectivity-heal',
    backend: result.backend,
    group: result.group,
    controlGroup: result.controlGroup,
    active: result.active,
    reasonCode: result.code,
    decision: result.decision,
    results: (result.results || []).map(({ name, delay, ok, checks }) => ({ name, delay, ok, checks: checks?.map(({ id, ok, delay, error }) => ({ id, ok, delay, error })) }))
  };
  addHistory({ source: 'connectivity-heal', ...result });
}

function apiError(message, status = 400, code = 'bad-request') {
  return Object.assign(new Error(message), { status, code });
}

function jobBudgetFromBody(body, fallback = DEFAULT_JOB_BUDGET_MS) {
  return boundedNumber(body?.budgetMs, fallback, 10000, 300000);
}

async function runManualOptimize(body) {
  if (typeof body.group !== 'string' || !body.group) throw apiError('group must be a non-empty string', 400, 'invalid-group');
  if (typeof body.region !== 'string') throw apiError('region must be a string', 400, 'invalid-region');
  if (Object.hasOwn(body, 'switch') && typeof body.switch !== 'boolean') throw apiError('switch must be a boolean', 400, 'invalid-switch');
  const region = REGIONS.find((item) => item.id === body.region);
  if (!region) throw apiError('请选择有效地区', 400, 'invalid-region');
  const timeout = boundedNumber(body.timeout, runtime.settings.manualTimeoutMs, 1000, 10000);
  const testUrl = normalizeTestUrl(body.testUrl || runtime.settings.manualTestUrl);
  const backend = await activeBackend();
  if (!backend) throw apiError('No supported Clash/Mihomo controller is online', 503, 'controller-offline');

  return coordinator.run('manual-optimize', { backend, timeoutMs: jobBudgetFromBody(body) }, async (job) => {
    const request = controllerRequestForBackend(backend, job);
    const { groups } = await inventoryForBackend(backend, request);
    const group = groups.find((item) => item.name === body.group);
    if (!group) throw apiError('代理组不存在或不是手动选择组', 400, 'invalid-group');
    job.group = group.name;
    const candidates = group.members.filter((name) => regionFor(name) === region.id);
    if (!candidates.length) throw apiError(`${region.label}没有可测速节点`, 404, 'no-region-candidates');

    const results = await mapLimit(candidates, 6, (name) => measureNode(name, testUrl, timeout, request), { signal: job.signal });
    results.sort((a, b) => (a.delay ?? Infinity) - (b.delay ?? Infinity));
    const best = results.find((item) => item.ok);
    if (!best) {
      const commit = selectorCommitState({ reasonCode: 'all-candidates-failed', active: group.now });
      const decision = selectorDecisionEvent({ code: 'all-candidates-failed', reason: 'all-candidates-failed', active: group.now, results, allowSwitch: body.switch !== false, commit });
      return { status: 502, body: { error: `${region.label}节点全部测速失败`, code: 'all-candidates-failed', reasonCode: 'all-candidates-failed', switched: false, decision, commit, results } };
    }

    const decision = await applySelectorDecision({
      backend,
      request,
      group,
      target: best.name,
      allowSwitch: body.switch !== false,
      jobKind: 'manual',
      job
    });
    const decisionEvent = selectorDecisionEvent({
      code: decision.reasonCode,
      reason: decision.reasonCode,
      currentName: group.now,
      active: decision.active,
      best,
      current: results.find((item) => item.name === group.now),
      results,
      allowSwitch: body.switch !== false,
      commit: decision.commit
    });
    return {
      status: 200,
      body: {
        jobId: job.id,
        backend: safeBackend(backend),
        region: region.label,
        group: group.name,
        previous: group.now,
        active: decision.active,
        best,
        switched: decision.switched,
        reasonCode: decision.reasonCode,
        decision: decisionEvent,
        commit: decision.commit,
        lockMs: decision.lockMs || lockRemainingFor(backend, group.name),
        results
      }
    };
  });
}

async function runAutomaticOptimize(body = {}) {
  const now = clock.now();
  const nextRunAt = Date.parse(runtime.nextRunAt || '');
  if (!body.force && Number.isFinite(nextRunAt) && nextRunAt > now) {
    return { status: 200, body: { skipped: true, reason: 'Not due yet', code: 'not-due', nextRunAt: runtime.nextRunAt } };
  }
  const backend = await activeBackend();
  if (!backend) throw apiError('No supported Clash/Mihomo controller is online', 503, 'controller-offline');

  return coordinator.run('auto-optimize', { backend, timeoutMs: jobBudgetFromBody(body) }, async (job) => {
    runtime.nextRunAt = nextAutoRunIso(now);
    persistRuntimeState();

    const request = controllerRequestForBackend(backend, job);
    const { groups } = await inventoryForBackend(backend, request);
    const group = await pickPrimaryGroup(groups, backend);
    if (!group) return { status: 404, body: { skipped: true, reason: '没有可用的手动代理组', code: 'no-selector-group' } };
    job.group = group.name;

    const locked = lockRemainingFor(backend, group.name);
    if (locked > 0) {
      const body = { skipped: true, reason: '手动保护中', code: 'manual-protection', lockMs: locked, group: group.name };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: body.reason, code: body.code, lockMs: locked });
      return { status: 200, body };
    }

    const previousAuto = getLastAuto(backend, group.name);
    if (previousAuto && previousAuto !== group.now) {
      const pauseMs = lockGroup(backend, group.name);
      persistRuntimeState();
      const body = { skipped: true, reason: '检测到手动切换，已暂停自动切换', code: 'external-change', lockMs: pauseMs, group: group.name, active: group.now };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: '检测到手动切换', code: body.code, lockMs: pauseMs });
      return { status: 200, body };
    }

    const currentRegion = regionFor(group.now);
    if (currentRegion === 'other') return { status: 200, body: { skipped: true, reason: '当前节点地区无法识别', code: 'unknown-current-region', group: group.name, current: group.now } };

    const scope = scopedHealth(backend, group.name);
    const decisionHealth = healthSnapshot();
    const measuredForHealth = [];
    const samples = runtime.settings.samples;
    const candidates = group.members.filter((name) => regionFor(name) === currentRegion);
    let results = candidates.length ? await mapLimit(candidates, 6, (name) => measureNodeStable(name, DEFAULT_TEST_URL, 5000, samples, request, job), { signal: job.signal }) : [];
    addMeasured(measuredForHealth, results);
    let currentResult = results.find((item) => item.name === group.now) || null;
    let ranked = decisionCore.rankCandidates(results, healthByName(results, scope, decisionHealth), runtime.settings, { now: clock.now(), scopeKey: scopedGroupKey(backend, group.name) });
    let best = ranked.best?.result || null;
    let fallbackFrom = null;
    let hardFailure = Boolean(currentResult && !currentResult.ok);
    const resultBatches = candidates.length ? [{ target: DEFAULT_TEST_URL, fallbackFrom: null, candidates: [...candidates], results }] : [];

    if (!best) {
      const sameRegionVerify = candidates.length ? await mapLimit(candidates, 6, (name) => measureNodeStable(name, VERIFY_TEST_URL, 5000, samples, request, job), { signal: job.signal }) : [];
      addMeasured(measuredForHealth, sameRegionVerify);
      if (sameRegionVerify.length) resultBatches.push({ target: VERIFY_TEST_URL, fallbackFrom: null, candidates: [...candidates], results: sameRegionVerify });
      const verifyRanked = decisionCore.rankCandidates(sameRegionVerify, healthByName(sameRegionVerify, scope, decisionHealth), runtime.settings, { now: clock.now(), scopeKey: scopedGroupKey(backend, group.name) });
      const verifyBest = verifyRanked.best?.result || null;
      if (verifyBest) {
        updateHealth(measuredForHealth, scope);
        const reason = '默认探测目标可能不可用，已保留当前节点';
        const decision = selectorDecisionEvent({ code: 'target-service-outage', reason, active: group.now, best: verifyBest, current: currentResult, results: sameRegionVerify, allowSwitch: true });
        const body = { skipped: true, switched: false, reason, code: 'target-service-outage', reasonCode: 'target-service-outage', group: group.name, region: currentRegion, active: group.now, best: verifyBest, results: sameRegionVerify, resultBatches, decision, commit: decision.commit };
        addHistory({ group: group.name, backend: backend.id, skipped: true, reason, code: body.code, region: currentRegion });
        return { status: 200, body };
      }

      fallbackFrom = currentRegion;
      hardFailure = true;
      const alternatives = group.members.filter((name) => {
        const region = regionFor(name);
        return region !== 'other' && region !== currentRegion;
      });
      const fallbackResults = await mapLimit(alternatives, 6, (name) => measureNodeStable(name, VERIFY_TEST_URL, 5000, samples, request, job), { signal: job.signal });
      addMeasured(measuredForHealth, fallbackResults);
      if (fallbackResults.length) resultBatches.push({ target: VERIFY_TEST_URL, fallbackFrom, candidates: [...alternatives], results: fallbackResults });
      const decisionInputs = currentResult ? [...fallbackResults, currentResult] : fallbackResults;
      ranked = decisionCore.rankCandidates(decisionInputs, healthByName(decisionInputs, scope, decisionHealth), runtime.settings, { now: clock.now(), scopeKey: scopedGroupKey(backend, group.name) });
      best = ranked.scored.filter((item) => fallbackResults.some((result) => result.name === item.name)).find((item) => item.ok)?.result || null;
      results = fallbackResults;
    }

    if (!best) {
      updateHealth(measuredForHealth, scope);
      const decision = selectorDecisionEvent({ code: 'all-candidates-failed', reason: '所有可识别地区节点测速全部失败', active: group.now, current: currentResult, results, allowSwitch: true });
      const body = { skipped: true, switched: false, reason: '所有可识别地区节点测速全部失败', code: 'all-candidates-failed', reasonCode: 'all-candidates-failed', group: group.name, region: currentRegion, fallbackFrom, results, resultBatches, decision, commit: decision.commit };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: body.reason, code: body.code, region: currentRegion });
      return { status: 200, body };
    }

    const decisionEvent = decisionCore.decideSwitch({
      currentName: group.now,
      results,
      currentResult,
      healthByName: healthByName(currentResult ? [...results, currentResult] : results, scope, decisionHealth),
      settings: runtime.settings,
      lastSwitchAt: getLastSwitch(backend, group.name),
      allowSwitch: true,
      monitorOnly: runtime.monitorOnly,
      hardFailure,
      now: clock.now(),
      scopeKey: scopedGroupKey(backend, group.name)
    });
    const orderedResults = scoredResultsFromDecision(decisionEvent);
    best = scoredResult(decisionEvent.evidence.best) || best;
    const improvement = decisionEvent.scoreDeltaRoundedMs;
    let decision = { active: group.now, switched: false, reasonCode: decisionEvent.code, decisionEvent, commit: selectorCommitState({ reasonCode: decisionEvent.code, active: group.now, target: decisionEvent.target }) };
    let finalDecisionEvent = { ...decisionEvent, commit: decision.commit };
    if (decisionEvent.action === 'switch') {
      decision = {
        ...(await applySelectorDecision({ backend, request, group, target: decisionEvent.target, allowSwitch: true, jobKind: 'auto', job })),
        decisionEvent
      };
      finalDecisionEvent = finalizedDecisionEvent(decisionEvent, decision);
    }
    const selectedRegion = regionFor(finalDecisionEvent.target || decision.active || best.name);

    if (decision.reasonCode === 'external-change') {
      updateHealth(measuredForHealth, scope);
      const body = { skipped: true, reason: '检测到手动切换，已暂停自动切换', code: decision.reasonCode, lockMs: decision.lockMs, group: group.name, active: decision.active, results: orderedResults, decision: finalDecisionEvent, commit: decision.commit };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: body.reason, code: body.code, lockMs: decision.lockMs });
      return { status: 200, body };
    }

    setLastAuto(backend, group.name, decision.active);
    updateHealth(measuredForHealth, scope);
    runtime.lastResults = {
      at: new Date(clock.now()).toISOString(),
      source: 'automatic',
      backend: backend.id,
      group: group.name,
      active: decision.active,
      region: selectedRegion,
      reasonCode: decision.reasonCode,
      decision: finalDecisionEvent,
      results: orderedResults.map(({ name, delay, ok, error, successCount, failureCount, jitter, score, scoring }) => ({ name, delay, ok, error, successCount, failureCount, jitter, score, scoring }))
    };
    persistRuntimeState();

    const entry = {
      skipped: false,
      region: selectedRegion,
      fallbackFrom,
      group: group.name,
      backend: backend.id,
      previous: group.now,
      active: decision.active,
      best,
      switched: decision.switched,
      success: orderedResults.filter((item) => item.ok).length,
      candidates: orderedResults.length,
      improvement,
      score: best.score ?? Math.round(healthScore(best, scope)),
      decision: finalDecisionEvent,
      reasonCode: decision.reasonCode,
      commit: decision.commit
    };
    addHistory(entry);
    return { status: 200, body: { jobId: job.id, ...entry, lockMs: lockRemainingFor(backend, group.name), results: orderedResults, commit: decision.commit } };
  });
}

async function runScheduledOptimize(body = {}) {
  const now = clock.now();
  const nextRunAt = Date.parse(runtime.nextRunAt || '');
  const nextConnectivityCheckAt = Date.parse(runtime.nextConnectivityCheckAt || '');
  const optimizationDue = body.force || !Number.isFinite(nextRunAt) || nextRunAt <= now;
  const connectivityDue = body.force || !Number.isFinite(nextConnectivityCheckAt) || nextConnectivityCheckAt <= now;

  if (connectivityDue) {
    const heal = await runConnectivityHeal({ ...body, switch: true });
    persistRuntimeState(heal.body.commit);
    const result = heal.body;
    if (!result.skipped || result.code === 'target-service-outage' || result.code === 'common-probe-failure' || result.code === 'all-candidates-failed') {
      recordConnectivityResult(result);
      persistRuntimeState(result.commit);
      return heal;
    }
  }

  if (optimizationDue) return runAutomaticOptimize({ ...body, force: true });

  return {
    status: 200,
    body: {
      skipped: true,
      reason: 'Not due yet',
      code: 'not-due',
      nextRunAt: runtime.nextRunAt,
      nextConnectivityCheckAt: runtime.nextConnectivityCheckAt
    }
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 64 * 1024) throw apiError('Request body too large', 413, 'request-body-too-large');
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON body must be an object');
    return body;
  } catch {
    throw apiError('Request body must be valid JSON object', 400, 'invalid-json');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...securityHeaders() });
  res.end(JSON.stringify(data));
}

function listeningPort() {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : PORT;
}

async function demoStatus(backend) {
  if (!DEMO_MODE || !backend?.online) return { enabled: false };
  try {
    const request = controllerRequestForBackend(backend);
    const state = await request('/demo/state', { timeout: 1000 });
    return {
      enabled: true,
      scenario: state.scenario || null,
      scenarios: state.scenarios || []
    };
  } catch {
    return { enabled: true, scenario: null, scenarios: [] };
  }
}

async function apiHandler(req, res, url) {
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  }
  if (req.method === 'POST') requireJsonContentType(req);

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      name: 'Clash Node Pilot',
      version: require('./package.json').version,
      host: HOST,
      port: listeningPort()
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    return sendJson(res, 200, await diagnosticsReport());
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const { groups, backend } = await inventory();
    const targetGroup = await pickPrimaryGroup(groups, backend);
    const discovered = await discoverBackends();
    const v2rayN = detectV2rayN();
    const currentJob = coordinator.snapshot();
    const demo = await demoStatus(backend);
    return sendJson(res, 200, {
      connected: true,
      startup: startupStatus(),
      backend: safeBackend(backend),
      backends: discovered.map((item) => safeBackend(item)),
      detectedClients: [...discovered.map((item) => ({ ...safeBackend(item), writable: true })), v2rayN],
      groups: groups.map((group) => ({ name: group.name, now: group.now, nodeCount: group.members.length, regions: summarizeRegions(group.members) })),
      targetGroup: targetGroup?.name,
      targetSource: backend.id === 'clash-verge' && (await selectedUiGroup(groups)) ? 'clash-verge-ui' : 'fallback',
      automation: { schedulerEnabled: process.env.CLASH_PILOT_DISABLE_AUTO_LOOP !== '1' || process.env.CLASH_PILOT_DEMO_AUTO === '1', running: Boolean(currentJob), currentJob, startedAt: currentJob?.startedAt || null, history: runtime.history, lastResults: runtime.lastResults, nextRunAt: runtime.nextRunAt, nextConnectivityCheckAt: runtime.nextConnectivityCheckAt, lockMs: targetGroup ? lockRemainingFor(backend, targetGroup.name) : 0, monitorOnly: Boolean(runtime.monitorOnly), settings: runtime.settings, trackedNodes: Object.keys(runtime.health).length },
      persistence: runtime.persistence,
      demo,
      diagnostics: runtime.diagnostics,
      defaults: { testUrl: runtime.settings.manualTestUrl || DEFAULT_TEST_URL, timeout: runtime.settings.manualTimeoutMs || 5000 }
    });
  }
  if (DEMO_MODE && url.pathname === '/api/demo-scenario' && req.method === 'POST') {
    const body = await readJson(req);
    if (typeof body.scenario !== 'string' || !body.scenario) throw apiError('scenario must be a non-empty string', 400, 'invalid-scenario');
    const backend = await activeBackend();
    if (!backend) throw apiError('Demo controller is offline', 503, 'controller-offline');
    ensureStateWritable();
    const result = await coordinator.run('demo-reset', { backend, timeoutMs: 15000 }, async (job) => {
      const request = controllerRequestForBackend(backend);
      job.beginCommit();
      await request('/demo/scenario', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ scenario: body.scenario })
      });
      runtime.history = [];
      runtime.health = {};
      runtime.lastResults = null;
      runtime.locks.clear();
      runtime.lastAuto.clear();
      runtime.lastSwitch.clear();
      runtime.nextRunAt = null;
      runtime.nextConnectivityCheckAt = null;
      runtime.monitorOnly = false;
      persistRuntimeState();
      return demoStatus(backend);
    });
    return sendJson(res, 200, result);
  }
  if (url.pathname === '/api/startup' && req.method === 'POST') {
    const body = await readJson(req);
    if (typeof body.enabled !== 'boolean') throw apiError('enabled must be a boolean', 400, 'invalid-enabled');
    const startup = setStartupEnabled(body.enabled);
    return sendJson(res, 200, startup);
  }
  if (req.method === 'POST' && url.pathname === '/api/automation') {
    const body = await readJson(req);
    const actions = new Set(['backend', 'cancel', 'lock', 'unlock', 'monitor', 'clear-history', 'settings']);
    if (typeof body.action !== 'string' || !actions.has(body.action)) throw apiError('Unsupported automation action', 400, 'unsupported-action');
    if (body.action === 'cancel') {
      return sendJson(res, 200, { cancelled: coordinator.cancel('Cancelled from dashboard') });
    }
    ensureStateWritable();
    if (body.action === 'backend') {
      if (typeof body.value !== 'string') throw apiError('backend value must be a string', 400, 'invalid-backend');
      const available = await discoverBackends();
      const selected = available.find((item) => item.id === body.value && item.online);
      if (!selected) return sendJson(res, 400, { error: 'Selected backend is offline or unavailable' });
      saveLocalMutation(() => { runtime.selectedBackend = selected.id; });
      return sendJson(res, 200, { backend: safeBackend(selected) });
    }
    const { groups, backend } = await inventory();
    const group = await pickPrimaryGroup(groups, backend);
    if (!group) return sendJson(res, 404, { error: 'No active selector group' });
    saveLocalMutation(() => {
      if (body.action === 'lock') lockGroup(backend, group.name);
      if (body.action === 'unlock') { clearGroupLock(backend, group.name); clearLastAuto(backend, group.name); }
      if (body.action === 'monitor') {
        if (typeof body.value !== 'boolean') throw apiError('monitor value must be a boolean', 400, 'invalid-monitor');
        runtime.monitorOnly = body.value;
      }
      if (body.action === 'clear-history') runtime.history = [];
      if (body.action === 'settings') {
        if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) throw apiError('settings must be an object', 400, 'invalid-settings');
        updateSettings(body.settings);
        runtime.nextRunAt = nextAutoRunIso();
      }
    });
    return sendJson(res, 200, { lockMs: lockRemainingFor(backend, group.name), monitorOnly: Boolean(runtime.monitorOnly), settings: runtime.settings });
  }
  if (req.method === 'POST' && url.pathname === '/api/optimize') {
    const body = await readJson(req);
    if (body.switch !== false) ensureStateWritable();
    const result = await runManualOptimize(body);
    return sendJson(res, result.status, result.body);
  }
  if (req.method === 'POST' && url.pathname === '/api/connectivity-heal') {
    const body = await readJson(req);
    if (Object.hasOwn(body, 'switch') && typeof body.switch !== 'boolean') throw apiError('switch must be a boolean', 400, 'invalid-switch');
    ensureStateWritable();
    const result = await runConnectivityHeal(body);
    recordConnectivityResult(result.body);
    persistRuntimeState(result.body.commit);
    return sendJson(res, result.status, result.body);
  }
  if (req.method === 'POST' && url.pathname === '/api/auto-optimize') {
    const body = req.headers['content-length'] === '0' ? {} : await readJson(req);
    if (Object.hasOwn(body, 'force') && typeof body.force !== 'boolean') throw apiError('force must be a boolean', 400, 'invalid-force');
    ensureStateWritable();
    const result = await runScheduledOptimize(body);
    return sendJson(res, result.status, result.body);
  }
  sendJson(res, 404, { error: 'Not found' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
async function staticHandler(res, url) {
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const file = path.resolve(STATIC_ROOT, relative);
  const containment = path.relative(STATIC_ROOT, file);
  if (containment.startsWith('..') || path.isAbsolute(containment)) return sendJson(res, 403, { error: 'Forbidden', code: 'static-forbidden' });
  const data = await fs.readFile(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...securityHeaders({ html: path.extname(file) === '.html' }) });
  res.end(data);
}

const server = http.createServer({ maxHeaderSize: 8192 }, async (req, res) => {
  try {
    validateLocalApiRequest(req, { port: listeningPort() });
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    if (url.pathname === '/api/session') return localSession.bootstrap(req, res, { port: listeningPort() });
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') localSession.authorize(req, { port: listeningPort() });
    if (url.pathname.startsWith('/api/')) await apiHandler(req, res, url);
    else await staticHandler(res, url);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error.name === 'TimeoutError' ? 504 : error.status || 500;
    const message = status === 500 ? `无法连接 Clash Verge：${error.message}` : error.message;
    sendJson(res, status, { error: message, code: error.code || 'internal-error', ...(error.commit ? { commit: error.commit, active: error.commit.active, switched: error.commit.verified, persistence: runtime.persistence } : {}) });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const boundPort = listeningPort();
    console.log(`Clash Node Pilot: http://${HOST}:${boundPort}`);
    if (process.env.CLASH_PILOT_DISABLE_AUTO_LOOP !== '1') {
      const runAutomaticCheck = async () => {
        try {
          const { token } = await (await fetch(`http://${HOST}:${boundPort}/api/session`)).json();
          await fetch(`http://${HOST}:${boundPort}/api/auto-optimize`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pilot-session': token }, body: '{}' });
        } catch {}
        const nextRunAt = Date.parse(runtime.nextRunAt || '');
        const delay = Number.isFinite(nextRunAt) ? Math.min(60000, Math.max(5000, nextRunAt - clock.now())) : 30000;
        setTimeout(runAutomaticCheck, delay);
      };
      setTimeout(runAutomaticCheck, 10000);
    }
  });
}

module.exports = { parseConfig, regionFor, summarizeRegions, diagnosticsReport, mapLimit, detectSelectedGroupFromBuffer, resolvePilotDataDir, resolveStatePath, migrateLegacyState, resolveEffectiveSelector, realMembers, server };
