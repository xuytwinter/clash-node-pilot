const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ControllerClient, parseConfig: parseControllerConfig } = require('./src/core/controller');
const { createRegionResolver, loadRegions, summarizeRegions: summarizeRegionCounts } = require('./src/core/regions');
const optimizerCore = require('./src/core/optimizer');
const { discoverBackends: discoverPlatformBackends } = require('./src/platform');
const { createSecureStore } = require('./src/platform/secure-store');
const windowsPlatform = require('./src/platform/windows');
const { macosStartupStatus, setMacosStartupEnabled } = require('./src/platform/macos');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
const STATIC_ROOT = path.join(__dirname, 'public');
const WEBVIEW_LEVELDB = windowsPlatform.clashVergeLevelDbPath(process.env);
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const VERIFY_TEST_URL = 'https://cp.cloudflare.com/generate_204';
const TARGET_GROUP = process.env.CLASH_TARGET_GROUP || '🐟漏网之鱼';
const SWITCH_THRESHOLD_MS = Number(process.env.SWITCH_THRESHOLD_MS || 25);
const MANUAL_PAUSE_MS = Number(process.env.MANUAL_PAUSE_MINUTES || 15) * 60 * 1000;
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
const secureStorePlatform = process.env.CLASH_PILOT_SECURE_STORE === 'file' ? 'test' : process.platform;
const secureStore = createSecureStore({ platform: secureStorePlatform, dataDir: resolvePilotDataDir() });
const runtime = { running: false, startedAt: null, history: [], health: {}, lastResults: null, locks: new Map(), lastAuto: new Map(), nextRunAt: null, monitorOnly: false, selectedBackend: null, pairings: [], settings: { autoIntervalMinutes: 3, switchThresholdMs: SWITCH_THRESHOLD_MS, samples: 2, manualPauseMinutes: MANUAL_PAUSE_MS / 60000 } };

function manualPairingApiEnabled() {
  return secureStore.backend !== 'local-profile-file' || process.env.CLASH_PILOT_SECURE_STORE === 'file';
}

function requireManualPairingApi() {
  if (!manualPairingApiEnabled()) {
    throw Object.assign(new Error('Manual Controller pairing requires an OS-backed secure store on this platform'), { status: 501 });
  }
}

function loadRuntimeState() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(STATE_PATH, 'utf8'));
    runtime.history = Array.isArray(saved.history) ? saved.history.slice(0, 100) : [];
    runtime.health = saved.health && typeof saved.health === 'object' ? saved.health : {};
    runtime.lastResults = saved.lastResults || null;
    runtime.monitorOnly = Boolean(saved.monitorOnly);
    runtime.nextRunAt = saved.nextRunAt || null;
    runtime.locks = new Map(Object.entries(saved.locks || {}).map(([key, value]) => [key, Number(value)]));
    runtime.lastAuto = new Map(Object.entries(saved.lastAuto || {}));
    runtime.settings = { ...runtime.settings, ...(saved.settings || {}) };
    runtime.selectedBackend = saved.selectedBackend || null;
    runtime.pairings = Array.isArray(saved.pairings) ? saved.pairings.filter((item) => item && item.id && item.controller) : [];
  } catch { /* first run or invalid state starts cleanly */ }
}

function persistRuntimeState() {
  try {
    fsSync.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.tmp`;
    fsSync.writeFileSync(temporary, JSON.stringify({ history: runtime.history, health: runtime.health, lastResults: runtime.lastResults, monitorOnly: runtime.monitorOnly, nextRunAt: runtime.nextRunAt, locks: Object.fromEntries(runtime.locks), lastAuto: Object.fromEntries(runtime.lastAuto), settings: runtime.settings, selectedBackend: runtime.selectedBackend, pairings: runtime.pairings }, null, 2), 'utf8');
    fsSync.renameSync(temporary, STATE_PATH);
  } catch { /* state persistence must not stop proxy switching */ }
}

migrateLegacyState();
loadRuntimeState();

let REGIONS = [
  { id: 'jp', label: '日本', flag: '🇯🇵', pattern: /🇯🇵|日本|东京|東京|大阪|名古屋|jp\b|japan|tokyo|osaka/i },
  { id: 'hk', label: '香港', flag: '🇭🇰', pattern: /🇭🇰|香港|港(?!口)|hk\b|hong\s*kong/i },
  { id: 'tw', label: '台湾', flag: '🇹🇼', pattern: /🇹🇼|台湾|臺灣|台北|臺北|高雄|tw\b|taiwan|taipei/i },
  { id: 'sg', label: '新加坡', flag: '🇸🇬', pattern: /🇸🇬|新加坡|狮城|獅城|sg\b|singapore/i },
  { id: 'us', label: '美国', flag: '🇺🇸', pattern: /🇺🇸|美国|美國|洛杉矶|洛杉磯|圣何塞|聖何塞|西雅图|西雅圖|纽约|紐約|us\b|usa\b|united states|los angeles|seattle|san jose/i },
  { id: 'kr', label: '韩国', flag: '🇰🇷', pattern: /🇰🇷|韩国|韓國|首尔|首爾|kr\b|korea|seoul/i },
  { id: 'de', label: '德国', flag: '🇩🇪', pattern: /🇩🇪|德国|德國|法兰克福|法蘭克福|de\b|germany|frankfurt/i },
  { id: 'uk', label: '英国', flag: '🇬🇧', pattern: /🇬🇧|英国|英國|伦敦|倫敦|uk\b|britain|london/i }
];
try {
  const customRegions = JSON.parse(fsSync.readFileSync(path.join(__dirname, 'regions.json'), 'utf8'));
  REGIONS = REGIONS.map((region) => ({ ...region, pattern: customRegions[region.id] ? new RegExp(customRegions[region.id].join('|'), 'i') : region.pattern }));
} catch { /* bundled defaults remain active */ }
REGIONS = loadRegions(__dirname);
const resolveRegion = createRegionResolver(REGIONS);

function parseConfig(text) {
  return parseControllerConfig(text);
}

function regionFor(name) {
  return resolveRegion(name);
}

async function discoverBackends() {
  return discoverPlatformBackends({ env: process.env, pairings: runtime.pairings, secureStore });
}

function startupStatus() {
  if (process.platform === 'win32') return windowsPlatform.startupStatus();
  if (process.platform === 'darwin') return macosStartupStatus();
  return { supported: false, enabled: false, source: null };
}

function setStartupEnabled(enabled) {
  if (process.platform === 'darwin') return setMacosStartupEnabled(enabled, __dirname);
  return windowsPlatform.setStartupEnabled(enabled, __dirname);
}

async function activeBackend(backends) {
  backends ||= await discoverBackends();
  return backends.find((item) => item.online && item.id === runtime.selectedBackend) || backends.find((item) => item.online) || null;
}

async function controllerRequest(route, options = {}, backendOverride = null) {
  const backend = backendOverride || await activeBackend();
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  const client = new ControllerClient({ controller: backend.config.controller, secret: backend.config.secret });
  return client.request(route, options);
}

async function inventory(backendOverride = null) {
  const backend = backendOverride || await activeBackend();
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  const payload = await controllerRequest('/proxies', {}, backend);
  const { proxies, groups } = optimizerCore.selectorGroupsFromPayload(payload);
  return { proxies, groups, backend };
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

async function measureNode(name, testUrl, timeout) {
  return optimizerCore.measureNode(controllerRequest, name, testUrl, timeout);
}

async function measureNodeStable(name, testUrl, timeout, samples = 2) {
  return optimizerCore.measureNodeStable(controllerRequest, name, testUrl, timeout, samples);
}

function addHistory(entry) {
  runtime.history.unshift({ at: new Date().toISOString(), ...entry });
  runtime.history = runtime.history.slice(0, 100);
  persistRuntimeState();
}

function lockRemaining(group) {
  return Math.max(0, (runtime.locks.get(group) || 0) - Date.now());
}

function updateHealth(results) {
  optimizerCore.updateHealth(runtime.health, results);
}

function healthScore(result) {
  return optimizerCore.healthScore(result, runtime.health);
}

async function mapLimit(items, limit, mapper) {
  return optimizerCore.mapLimit(items, limit, mapper);
}

function validatePairingInput(body) {
  const controller = String(body.controller || '').trim();
  if (!/^(https?:\/\/)?(127\.0\.0\.1|localhost|\[::1\]|::1)(:\d{2,5})?$/i.test(controller)) {
    throw new Error('Controller must be an explicit local Clash/Mihomo URL such as http://127.0.0.1:9097');
  }
  return {
    id: body.id && /^[a-z0-9][a-z0-9-]{2,60}$/i.test(body.id) ? body.id : `manual-${crypto.randomUUID()}`,
    name: String(body.name || 'Manual Clash/Mihomo Controller').slice(0, 80),
    controller
  };
}

async function saveManualPairing(body) {
  const pairing = validatePairingInput(body);
  secureStore.set(pairing.id, String(body.secret || ''));
  runtime.pairings = runtime.pairings.filter((item) => item.id !== pairing.id);
  runtime.pairings.push(pairing);
  runtime.selectedBackend = pairing.id;
  persistRuntimeState();
  return { id: pairing.id, name: pairing.name, controller: pairing.controller, secretStored: Boolean(body.secret), secureStore: secureStore.backend };
}

function revokeManualPairing(id) {
  runtime.pairings = runtime.pairings.filter((item) => item.id !== id);
  secureStore.delete(id);
  if (runtime.selectedBackend === id) runtime.selectedBackend = null;
  persistRuntimeState();
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (chunks.reduce((sum, item) => sum + item.length, 0) > 64 * 1024) throw new Error('Request body too large');
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function publicBackend({ id, name, online, version, platform, capabilities, diagnostic }) {
  return { id, name, online, version, platform, capabilities, diagnostic };
}

function automationStatus(targetGroup = null) {
  return {
    running: runtime.running,
    startedAt: runtime.startedAt,
    history: runtime.history,
    lastResults: runtime.lastResults,
    nextRunAt: runtime.nextRunAt,
    lockMs: targetGroup ? lockRemaining(targetGroup.name) : 0,
    monitorOnly: Boolean(runtime.monitorOnly),
    settings: runtime.settings,
    trackedNodes: Object.keys(runtime.health).length
  };
}

function isLocalWebOrigin(value) {
  try {
    const parsed = new URL(value);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) && (!parsed.port || Number(parsed.port) === PORT);
  } catch {
    return false;
  }
}

function assertLocalApiWrite(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (origin && !isLocalWebOrigin(origin)) throw Object.assign(new Error('Cross-origin local API write rejected'), { status: 403 });
  const referer = req.headers.referer;
  if (!origin && referer && !isLocalWebOrigin(referer)) throw Object.assign(new Error('Cross-origin local API write rejected'), { status: 403 });
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) throw Object.assign(new Error('Cross-origin local API write rejected'), { status: 403 });
}

async function apiHandler(req, res, url) {
  assertLocalApiWrite(req);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      name: 'Clash Node Pilot',
      version: require('./package.json').version,
      host: HOST,
      port: PORT
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/pairings') {
    requireManualPairingApi();
    return sendJson(res, 200, { secureStore: secureStore.backend, pairings: runtime.pairings.map(({ id, name, controller }) => ({ id, name, controller })) });
  }
  if (req.method === 'POST' && url.pathname === '/api/pairings') {
    requireManualPairingApi();
    const saved = await saveManualPairing(await readJson(req));
    return sendJson(res, 201, saved);
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/api/pairings/')) {
    requireManualPairingApi();
    const id = decodeURIComponent(url.pathname.slice('/api/pairings/'.length));
    revokeManualPairing(id);
    return sendJson(res, 200, { revoked: true });
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const discovered = await discoverBackends();
    const backend = await activeBackend(discovered);
    const v2rayN = windowsPlatform.detectV2rayN(process.env);
    if (!backend) {
      return sendJson(res, 200, {
        connected: false,
        startup: startupStatus(),
        backend: null,
        backends: discovered.map(publicBackend),
        detectedClients: [...discovered.map((item) => ({ ...publicBackend(item), writable: Boolean(item.capabilities?.switching === 'supported') })), v2rayN],
        groups: [],
        targetGroup: null,
        targetSource: 'unavailable',
        automation: automationStatus(),
        defaults: { testUrl: DEFAULT_TEST_URL, timeout: 5000 },
        diagnostic: { code: 'controller-unavailable', message: 'No supported Clash/Mihomo controller is online' }
      });
    }
    const { groups } = await inventory(backend);
    const targetGroup = await pickPrimaryGroup(groups, backend);
    return sendJson(res, 200, {
      connected: true,
      startup: startupStatus(),
      backend: { id: backend.id, name: backend.name, version: backend.version },
      backends: discovered.map(publicBackend),
      detectedClients: [...discovered.map((item) => ({ ...publicBackend(item), writable: Boolean(item.capabilities?.switching === 'supported') })), v2rayN],
      groups: groups.map((group) => ({ name: group.name, now: group.now, nodeCount: group.members.length, regions: summarizeRegions(group.members) })),
      targetGroup: targetGroup?.name,
      targetSource: backend.id === 'clash-verge' && (await selectedUiGroup(groups)) ? 'clash-verge-ui' : 'fallback',
      automation: automationStatus(targetGroup),
      defaults: { testUrl: DEFAULT_TEST_URL, timeout: 5000 }
    });
  }
  if (url.pathname === '/api/startup' && req.method === 'POST') {
    const body = await readJson(req);
    const startup = setStartupEnabled(Boolean(body.enabled));
    return sendJson(res, 200, startup);
  }
  if (req.method === 'POST' && url.pathname === '/api/automation') {
    const body = await readJson(req);
    if (body.action === 'backend') {
      const available = await discoverBackends();
      const selected = available.find((item) => item.id === body.value && item.online);
      if (!selected) return sendJson(res, 400, { error: 'Selected backend is offline or unavailable' });
      runtime.selectedBackend = selected.id;
      persistRuntimeState();
      return sendJson(res, 200, { backend: { id: selected.id, name: selected.name, version: selected.version } });
    }
    const { groups, backend } = await inventory();
    const group = await pickPrimaryGroup(groups, backend);
    if (!group) return sendJson(res, 404, { error: 'No active selector group' });
    if (body.action === 'lock') runtime.locks.set(group.name, Date.now() + runtime.settings.manualPauseMinutes * 60000);
    if (body.action === 'unlock') { runtime.locks.delete(group.name); runtime.lastAuto.delete(group.name); }
    if (body.action === 'monitor') runtime.monitorOnly = Boolean(body.value);
    if (body.action === 'clear-history') runtime.history = [];
    if (body.action === 'settings') runtime.settings = {
      autoIntervalMinutes: Math.min(60, Math.max(1, Number(body.settings?.autoIntervalMinutes) || 3)),
      switchThresholdMs: Math.min(500, Math.max(0, Number(body.settings?.switchThresholdMs) || 25)),
      samples: Math.min(5, Math.max(1, Number(body.settings?.samples) || 2)),
      manualPauseMinutes: Math.min(1440, Math.max(1, Number(body.settings?.manualPauseMinutes) || 15))
    };
    if (body.action === 'settings') runtime.nextRunAt = new Date(Date.now() + runtime.settings.autoIntervalMinutes * 60000).toISOString();
    persistRuntimeState();
    return sendJson(res, 200, { lockMs: lockRemaining(group.name), monitorOnly: Boolean(runtime.monitorOnly) });
  }
  if (req.method === 'POST' && url.pathname === '/api/optimize') {
    const body = await readJson(req);
    const region = REGIONS.find((item) => item.id === body.region);
    if (!region) return sendJson(res, 400, { error: '请选择有效地区' });
    const { groups } = await inventory();
    const group = groups.find((item) => item.name === body.group);
    if (!group) return sendJson(res, 400, { error: '代理组不存在或不是手动选择组' });
    const candidates = group.members.filter((name) => regionFor(name) === region.id);
    if (!candidates.length) return sendJson(res, 404, { error: `${region.label}没有可测速节点` });
    const timeout = Math.min(10000, Math.max(1000, Number(body.timeout) || 5000));
    const testUrl = typeof body.testUrl === 'string' && /^https?:\/\//.test(body.testUrl) ? body.testUrl : DEFAULT_TEST_URL;
    const results = await mapLimit(candidates, 6, (name) => measureNode(name, testUrl, timeout));
    results.sort((a, b) => (a.delay ?? Infinity) - (b.delay ?? Infinity));
    const best = results.find((item) => item.ok);
    if (!best) return sendJson(res, 502, { error: `${region.label}节点全部测速失败`, results });
    if (body.switch !== false && group.now !== best.name) {
      await controllerRequest(`/proxies/${encodeURIComponent(group.name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ name: best.name })
      });
    }
    const refreshed = await controllerRequest('/proxies');
    const active = refreshed.proxies?.[group.name]?.now;
    return sendJson(res, 200, { region: region.label, group: group.name, previous: group.now, active, best, switched: group.now !== active, results });
  }
  if (req.method === 'POST' && url.pathname === '/api/auto-optimize') {
    if (runtime.running) return sendJson(res, 409, { skipped: true, reason: '已有优选任务正在运行' });
    const now = Date.now();
    const nextRunAt = Date.parse(runtime.nextRunAt || '');
    if (Number.isFinite(nextRunAt) && nextRunAt > now) return sendJson(res, 200, { skipped: true, reason: 'Not due yet', nextRunAt: runtime.nextRunAt });
    runtime.running = true;
    runtime.startedAt = new Date().toISOString();
    runtime.nextRunAt = new Date(now + runtime.settings.autoIntervalMinutes * 60000).toISOString();
    persistRuntimeState();
    const { groups, backend } = await inventory();
    const group = await pickPrimaryGroup(groups, backend);
    if (!group) { runtime.running = false; return sendJson(res, 404, { skipped: true, reason: '没有可用的手动代理组' }); }
    const locked = lockRemaining(group.name);
    if (locked > 0) { runtime.running = false; addHistory({ group: group.name, skipped: true, reason: '手动保护中', lockMs: locked }); return sendJson(res, 200, { skipped: true, reason: '手动保护中', lockMs: locked, group: group.name }); }
    const previousAuto = runtime.lastAuto.get(group.name);
    if (previousAuto && previousAuto !== group.now) {
      const pauseMs = runtime.settings.manualPauseMinutes * 60000;
      runtime.locks.set(group.name, Date.now() + pauseMs);
      persistRuntimeState();
      runtime.running = false;
      addHistory({ group: group.name, skipped: true, reason: '检测到手动切换', lockMs: pauseMs });
      return sendJson(res, 200, { skipped: true, reason: '检测到手动切换，已暂停自动切换', lockMs: pauseMs, group: group.name, active: group.now });
    }
    const currentRegion = regionFor(group.now);
    if (currentRegion === 'other') { runtime.running = false; return sendJson(res, 200, { skipped: true, reason: '当前节点地区无法识别', group: group.name, current: group.now }); }
    const candidates = group.members.filter((name) => regionFor(name) === currentRegion);
    let results = candidates.length ? await mapLimit(candidates, 6, (name) => measureNodeStable(name, DEFAULT_TEST_URL, 5000, runtime.settings.samples)) : [];
    updateHealth(results);
    results.sort((a, b) => (a.ok ? healthScore(a) : Infinity) - (b.ok ? healthScore(b) : Infinity));
    let best = results.find((item) => item.ok);
    let fallbackFrom = null;
    if (!best) {
      fallbackFrom = currentRegion;
      const alternatives = group.members.filter((name) => {
        const region = regionFor(name);
        return region !== 'other' && region !== currentRegion;
      });
      const fallbackResults = await mapLimit(alternatives, 6, (name) => measureNodeStable(name, VERIFY_TEST_URL, 5000, runtime.settings.samples));
      updateHealth(fallbackResults);
      fallbackResults.sort((a, b) => (a.ok ? healthScore(a) : Infinity) - (b.ok ? healthScore(b) : Infinity));
      best = fallbackResults.find((item) => item.ok);
      results = fallbackResults;
    }
    if (!best) { runtime.running = false; addHistory({ group: group.name, skipped: true, reason: '所有可识别地区节点测速全部失败', region: currentRegion }); return sendJson(res, 200, { skipped: true, reason: '所有可识别地区节点测速全部失败', group: group.name, region: currentRegion, fallbackFrom, results }); }
    const selectedRegion = regionFor(best.name);
    const currentDelay = results.find((item) => item.name === group.now)?.delay ?? Infinity;
    const improvement = currentDelay - best.delay;
    const shouldSwitch = group.now !== best.name && (currentDelay === Infinity || improvement >= runtime.settings.switchThresholdMs);
    if (shouldSwitch && !runtime.monitorOnly) await controllerRequest(`/proxies/${encodeURIComponent(group.name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ name: best.name }) });
    const active = shouldSwitch && !runtime.monitorOnly ? best.name : group.now;
    runtime.lastAuto.set(group.name, active);
    runtime.running = false;
    persistRuntimeState();
    const entry = { skipped: false, region: selectedRegion, fallbackFrom, group: group.name, previous: group.now, active, best, switched: shouldSwitch && !runtime.monitorOnly, success: results.filter((item) => item.ok).length, candidates: results.length, improvement, score: Math.round(healthScore(best)) };
    runtime.lastResults = { at: new Date().toISOString(), source: 'automatic', backend: backend.id, group: group.name, active, region: selectedRegion, results: results.map(({ name, delay, ok, error }) => ({ name, delay, ok, error })) };
    addHistory(entry);
    return sendJson(res, 200, entry);
  }
  sendJson(res, 404, { error: 'Not found' });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
async function staticHandler(res, url) {
  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.resolve(STATIC_ROOT, relative);
  if (!file.startsWith(STATIC_ROOT)) return sendJson(res, 403, { error: 'Forbidden' });
  const data = await fs.readFile(file);
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    if (url.pathname.startsWith('/api/')) await apiHandler(req, res, url);
    else await staticHandler(res, url);
  } catch (error) {
    if (req.url?.startsWith('/api/auto-optimize')) runtime.running = false;
    const status = error.code === 'ENOENT' ? 404 : error.name === 'TimeoutError' ? 504 : error.status || 500;
    sendJson(res, status, { error: status === 500 ? `无法连接 Clash Verge：${error.message}` : error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Clash Node Pilot: http://${HOST}:${PORT}`);
    if (process.env.CLASH_PILOT_DISABLE_AUTO_LOOP !== '1') {
      const runAutomaticCheck = () => fetch(`http://${HOST}:${PORT}/api/auto-optimize`, { method: 'POST' }).catch(() => {});
      setTimeout(runAutomaticCheck, 10000);
      setInterval(runAutomaticCheck, 15000);
    }
  });
}

module.exports = { server, parseConfig, regionFor, summarizeRegions, mapLimit, detectSelectedGroupFromBuffer, resolvePilotDataDir, resolveStatePath, migrateLegacyState };
