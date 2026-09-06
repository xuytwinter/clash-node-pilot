const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { ControllerClient, parseConfig: parseControllerConfig, probeConfigBackend, safeBackend } = require('./src/core/controller');
const { createRegionResolver, loadRegions, summarizeRegions: summarizeRegionCounts } = require('./src/core/regions');
const { JobCoordinator } = require('./src/core/jobs');
const { normalizeProbeUrl, requireJsonContentType, securityHeaders, validateLocalApiRequest } = require('./src/core/security');
const { STATE_SCHEMA_VERSION, clampNumber, sanitizeRuntimeSnapshot } = require('./src/core/state');
const connectivityCore = require('./src/core/connectivity');
const optimizerCore = require('./src/core/optimizer');

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
const DEFAULT_SETTINGS = { autoIntervalMinutes: 3, switchThresholdMs: SWITCH_THRESHOLD_MS, samples: 2, manualPauseMinutes: MANUAL_PAUSE_MS / 60000, connectivityCheckMinutes: 1, connectivityTimeoutMs: 5000 };
const runtime = {
  history: [],
  health: {},
  lastResults: null,
  locks: new Map(),
  lastAuto: new Map(),
  nextRunAt: null,
  nextConnectivityCheckAt: null,
  monitorOnly: false,
  selectedBackend: null,
  settings: { ...DEFAULT_SETTINGS },
  diagnostics: [],
  persistence: { writable: true, code: 'ok', message: 'Runtime state is writable', restoredFromBackup: false }
};
const coordinator = new JobCoordinator();

function addDiagnostic(code, message) {
  runtime.diagnostics.unshift({ at: new Date().toISOString(), code, message });
  runtime.diagnostics = runtime.diagnostics.slice(0, 50);
}

function stateError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function setPersistenceStatus(status) {
  runtime.persistence = { ...runtime.persistence, ...status };
}

function ensureStateWritable() {
  if (!runtime.persistence.writable) {
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
  runtime.settings = saved.settings;
  runtime.selectedBackend = saved.selectedBackend;
  runtime.diagnostics = saved.diagnostics;
}

function readRuntimeSnapshot(filePath) {
  const text = fsSync.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(text);
  return {
    upgraded: parsed?.schemaVersion !== STATE_SCHEMA_VERSION,
    saved: sanitizeRuntimeSnapshot(parsed, DEFAULT_SETTINGS)
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

function persistRuntimeState() {
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
    if (temporary) fsSync.rmSync(temporary, { force: true });
    addDiagnostic('state-save-failed', 'Runtime state could not be saved');
    throw stateError('Runtime state could not be saved', 507, 'state-save-failed');
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
  return (route, options = {}) => client.request(route, { ...options, signal: options.signal || job?.signal });
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

async function measureNode(name, testUrl, timeout, request = controllerRequest) {
  return optimizerCore.measureNode(request, name, testUrl, timeout);
}

async function measureNodeStable(name, testUrl, timeout, samples = 2, request = controllerRequest, job = null) {
  return optimizerCore.measureNodeStable(request, name, testUrl, timeout, samples, { signal: job?.signal });
}

function addHistory(entry) {
  runtime.history.unshift({ at: new Date().toISOString(), ...entry });
  runtime.history = runtime.history.slice(0, 100);
  persistRuntimeState();
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
  return Math.max(0, Math.max(scoped, legacy) - Date.now());
}

function lockGroup(backend, groupName, durationMs = runtime.settings.manualPauseMinutes * 60000) {
  const expiresAt = Date.now() + durationMs;
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

function boundedNumber(value, fallback, min, max, { integer = true } = {}) {
  return clampNumber(value, fallback, min, max, { integer });
}

function nextAutoRunIso(now = Date.now()) {
  return new Date(now + runtime.settings.autoIntervalMinutes * 60000).toISOString();
}

function updateSettings(settings = {}) {
  const input = settings && typeof settings === 'object' ? settings : {};
  runtime.settings = {
    autoIntervalMinutes: Object.hasOwn(input, 'autoIntervalMinutes') ? boundedNumber(input.autoIntervalMinutes, runtime.settings.autoIntervalMinutes, 1, 60) : runtime.settings.autoIntervalMinutes,
    switchThresholdMs: Object.hasOwn(input, 'switchThresholdMs') ? boundedNumber(input.switchThresholdMs, runtime.settings.switchThresholdMs, 0, 500) : runtime.settings.switchThresholdMs,
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

async function applySelectorDecision({ backend, request, group, target, allowSwitch, jobKind }) {
  if (!allowSwitch) return { active: group.now, switched: false, reasonCode: 'switch-disabled' };
  if (runtime.monitorOnly) return { active: group.now, switched: false, reasonCode: 'monitor-only' };
  if (group.now === target) return { active: group.now, switched: false, reasonCode: 'already-active' };

  const current = await readGroupNow(request, group.name);
  if (current !== group.now) {
    const lockMs = lockGroup(backend, group.name);
    persistRuntimeState();
    return { active: current, switched: false, reasonCode: 'external-change', lockMs };
  }

  await request(`/proxies/${encodeURIComponent(group.name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ name: target })
  });
  const active = await readGroupNow(request, group.name);
  const switched = active === target;
  if (switched && jobKind === 'manual') {
    lockGroup(backend, group.name);
    persistRuntimeState();
  }
  return { active, switched, reasonCode: switched ? 'switched' : 'write-not-applied' };
}

function updateHealth(results, scope = {}) {
  optimizerCore.updateHealth(runtime.health, results, scope);
}

function healthScore(result, scope = {}) {
  return optimizerCore.healthScore(result, runtime.health, scope);
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

function realMembers(proxies, groupName) {
  return connectivityCore.realMembers(proxies, groupName, optimizerCore.GROUP_TYPES);
}

function resolveEffectiveSelector(proxies, groupName) {
  return connectivityCore.resolveEffectiveSelector(proxies, groupName);
}

async function runConnectivityHeal(body = {}) {
  const backend = await activeBackend();
  if (!backend) throw apiError('No supported Clash/Mihomo controller is online', 503, 'controller-offline');
  const now = Date.now();

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
        attempts.push({ group: groupName, controlGroup, skipped: true, reason: '当前选择不是可安全控制的真实节点', code: 'unsupported-selector-chain', resolved });
        continue;
      }

      const locked = lockRemainingFor(backend, controlGroup);
      if (locked > 0) {
        attempts.push({ group: groupName, controlGroup, skipped: true, reason: '手动保护中', code: 'manual-protection', lockMs: locked, resolved });
        continue;
      }

      const previousAuto = getLastAuto(backend, controlGroup);
      if (previousAuto && previousAuto !== resolved.leaf) {
        const lockMs = lockGroup(backend, controlGroup);
        persistRuntimeState();
        attempts.push({ group: groupName, controlGroup, skipped: true, reason: '检测到手动切换，已暂停保通切换', code: 'external-change', lockMs, resolved });
        continue;
      }

      const scope = scopedHealth(backend, controlGroup);
      const current = await measureTargets(resolved.leaf, targets, timeout, request, job);
      updateHealth([current], scope);
      if (current.ok) {
        setLastAuto(backend, controlGroup, resolved.leaf);
        attempts.push({ group: groupName, controlGroup, skipped: true, reason: '当前 Google/OpenAI 探测链路健康', code: 'current-healthy', resolved, current });
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
        updateHealth(batchResults, scope);
        batchResults.sort((a, b) => (a.ok ? healthScore(a, scope) : Infinity) - (b.ok ? healthScore(b, scope) : Infinity));
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
        const attempt = { group: groupName, controlGroup, skipped: true, reason, code: diagnosis.code, diagnosis: diagnosis.confidence, resolved, current, fallbackFrom, results: evidenceResults, resultBatches, targetSummary: diagnosis.targetSummary };
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
        jobKind: 'heal'
      });
      setLastAuto(backend, controlGroup, decision.active);
      const entry = { group: groupName, controlGroup, skipped: false, reason: 'Google/OpenAI 探测链路失败，已选择健康备用节点', code: decision.reasonCode, resolved, previous: resolved.leaf, active: decision.active, current, best, switched: decision.switched, fallbackFrom, results: orderedResults, resultBatches };
      return { status: 200, body: { jobId: job.id, source: 'connectivity-heal', backend: backend.id, ...entry, attempts: [...attempts, entry] } };
    }

    return { status: 200, body: { jobId: job.id, source: 'connectivity-heal', backend: backend.id, skipped: true, reason: '未发现需要切换的 Google/OpenAI 出站链路', code: 'no-actionable-group', attempts } };
  });
}

function recordConnectivityResult(result) {
  runtime.lastResults = {
    at: new Date().toISOString(),
    source: 'connectivity-heal',
    backend: result.backend,
    group: result.group,
    controlGroup: result.controlGroup,
    active: result.active,
    reasonCode: result.code,
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
  const timeout = boundedNumber(body.timeout, 5000, 1000, 10000);
  const testUrl = normalizeTestUrl(body.testUrl);
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
    if (!best) return { status: 502, body: { error: `${region.label}节点全部测速失败`, code: 'all-candidates-failed', results } };

    const decision = await applySelectorDecision({
      backend,
      request,
      group,
      target: best.name,
      allowSwitch: body.switch !== false,
      jobKind: 'manual'
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
        lockMs: decision.lockMs || lockRemainingFor(backend, group.name),
        results
      }
    };
  });
}

async function runAutomaticOptimize(body = {}) {
  const now = Date.now();
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
    const samples = runtime.settings.samples;
    const candidates = group.members.filter((name) => regionFor(name) === currentRegion);
    let results = candidates.length ? await mapLimit(candidates, 6, (name) => measureNodeStable(name, DEFAULT_TEST_URL, 5000, samples, request, job), { signal: job.signal }) : [];
    updateHealth(results, scope);
    results.sort((a, b) => (a.ok ? healthScore(a, scope) : Infinity) - (b.ok ? healthScore(b, scope) : Infinity));
    let best = results.find((item) => item.ok);
    let fallbackFrom = null;

    if (!best) {
      fallbackFrom = currentRegion;
      const alternatives = group.members.filter((name) => {
        const region = regionFor(name);
        return region !== 'other' && region !== currentRegion;
      });
      const fallbackResults = await mapLimit(alternatives, 6, (name) => measureNodeStable(name, VERIFY_TEST_URL, 5000, samples, request, job), { signal: job.signal });
      updateHealth(fallbackResults, scope);
      fallbackResults.sort((a, b) => (a.ok ? healthScore(a, scope) : Infinity) - (b.ok ? healthScore(b, scope) : Infinity));
      best = fallbackResults.find((item) => item.ok);
      results = fallbackResults;
    }

    if (!best) {
      const body = { skipped: true, reason: '所有可识别地区节点测速全部失败', code: 'all-candidates-failed', group: group.name, region: currentRegion, fallbackFrom, results };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: body.reason, code: body.code, region: currentRegion });
      return { status: 200, body };
    }

    const selectedRegion = regionFor(best.name);
    const currentDelay = results.find((item) => item.name === group.now)?.delay ?? Infinity;
    const improvement = currentDelay - best.delay;
    const shouldSwitch = group.now !== best.name && (currentDelay === Infinity || improvement >= runtime.settings.switchThresholdMs);
    let decision = { active: group.now, switched: false, reasonCode: group.now === best.name ? 'already-active' : 'below-threshold' };
    if (shouldSwitch) decision = await applySelectorDecision({ backend, request, group, target: best.name, allowSwitch: true, jobKind: 'auto' });

    if (decision.reasonCode === 'external-change') {
      const body = { skipped: true, reason: '检测到手动切换，已暂停自动切换', code: decision.reasonCode, lockMs: decision.lockMs, group: group.name, active: decision.active, results };
      addHistory({ group: group.name, backend: backend.id, skipped: true, reason: body.reason, code: body.code, lockMs: decision.lockMs });
      return { status: 200, body };
    }

    setLastAuto(backend, group.name, decision.active);
    runtime.lastResults = {
      at: new Date().toISOString(),
      source: 'automatic',
      backend: backend.id,
      group: group.name,
      active: decision.active,
      region: selectedRegion,
      reasonCode: decision.reasonCode,
      results: results.map(({ name, delay, ok, error, successCount, failureCount, jitter }) => ({ name, delay, ok, error, successCount, failureCount, jitter }))
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
      success: results.filter((item) => item.ok).length,
      candidates: results.length,
      improvement,
      score: Math.round(healthScore(best, scope)),
      reasonCode: decision.reasonCode
    };
    addHistory(entry);
    return { status: 200, body: { jobId: job.id, ...entry, lockMs: lockRemainingFor(backend, group.name), results } };
  });
}

async function runScheduledOptimize(body = {}) {
  const now = Date.now();
  const nextRunAt = Date.parse(runtime.nextRunAt || '');
  const nextConnectivityCheckAt = Date.parse(runtime.nextConnectivityCheckAt || '');
  const optimizationDue = body.force || !Number.isFinite(nextRunAt) || nextRunAt <= now;
  const connectivityDue = body.force || !Number.isFinite(nextConnectivityCheckAt) || nextConnectivityCheckAt <= now;

  if (connectivityDue) {
    const heal = await runConnectivityHeal({ ...body, switch: true });
    persistRuntimeState();
    const result = heal.body;
    if (!result.skipped || result.code === 'target-service-outage' || result.code === 'common-probe-failure' || result.code === 'all-candidates-failed') {
      recordConnectivityResult(result);
      persistRuntimeState();
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
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const { groups, backend } = await inventory();
    const targetGroup = await pickPrimaryGroup(groups, backend);
    const discovered = await discoverBackends();
    const v2rayN = detectV2rayN();
    const currentJob = coordinator.snapshot();
    return sendJson(res, 200, {
      connected: true,
      startup: startupStatus(),
      backend: safeBackend(backend),
      backends: discovered.map((item) => safeBackend(item)),
      detectedClients: [...discovered.map((item) => ({ ...safeBackend(item), writable: true })), v2rayN],
      groups: groups.map((group) => ({ name: group.name, now: group.now, nodeCount: group.members.length, regions: summarizeRegions(group.members) })),
      targetGroup: targetGroup?.name,
      targetSource: backend.id === 'clash-verge' && (await selectedUiGroup(groups)) ? 'clash-verge-ui' : 'fallback',
      automation: { running: Boolean(currentJob), currentJob, startedAt: currentJob?.startedAt || null, history: runtime.history, lastResults: runtime.lastResults, nextRunAt: runtime.nextRunAt, nextConnectivityCheckAt: runtime.nextConnectivityCheckAt, lockMs: targetGroup ? lockRemainingFor(backend, targetGroup.name) : 0, monitorOnly: Boolean(runtime.monitorOnly), settings: runtime.settings, trackedNodes: Object.keys(runtime.health).length },
      persistence: runtime.persistence,
      diagnostics: runtime.diagnostics,
      defaults: { testUrl: DEFAULT_TEST_URL, timeout: 5000 }
    });
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
      runtime.selectedBackend = selected.id;
      persistRuntimeState();
      return sendJson(res, 200, { backend: safeBackend(selected) });
    }
    const { groups, backend } = await inventory();
    const group = await pickPrimaryGroup(groups, backend);
    if (!group) return sendJson(res, 404, { error: 'No active selector group' });
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
    persistRuntimeState();
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
    persistRuntimeState();
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
    if (url.pathname.startsWith('/api/')) await apiHandler(req, res, url);
    else await staticHandler(res, url);
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error.name === 'TimeoutError' ? 504 : error.status || 500;
    const message = status === 500 ? `无法连接 Clash Verge：${error.message}` : error.message;
    sendJson(res, status, { error: message, code: error.code || 'internal-error' });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    const boundPort = listeningPort();
    console.log(`Clash Node Pilot: http://${HOST}:${boundPort}`);
    if (process.env.CLASH_PILOT_DISABLE_AUTO_LOOP !== '1') {
      const runAutomaticCheck = async () => {
        await fetch(`http://${HOST}:${boundPort}/api/auto-optimize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
        const nextRunAt = Date.parse(runtime.nextRunAt || '');
        const delay = Number.isFinite(nextRunAt) ? Math.min(60000, Math.max(5000, nextRunAt - Date.now())) : 30000;
        setTimeout(runAutomaticCheck, delay);
      };
      setTimeout(runAutomaticCheck, 10000);
    }
  });
}

module.exports = { parseConfig, regionFor, summarizeRegions, mapLimit, detectSelectedGroupFromBuffer, resolvePilotDataDir, resolveStatePath, migrateLegacyState, resolveEffectiveSelector, realMembers, server };
