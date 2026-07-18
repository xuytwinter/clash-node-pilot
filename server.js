const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3210);
const STATIC_ROOT = path.join(__dirname, 'public');
const VERGE_CONFIG_PATH = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'io.github.clash-verge-rev.clash-verge-rev',
  'config.yaml'
);
const CFW_CONFIG_PATH = path.join(os.homedir(), '.config', 'clash', 'config.yaml');
const MIHOMO_BACKENDS = [
  ...(process.env.CLASH_CONFIG ? [{ id: 'custom', name: 'Custom Clash/Mihomo', configPath: process.env.CLASH_CONFIG }] : []),
  { id: 'clash-verge', name: 'Clash Verge Rev', configPath: VERGE_CONFIG_PATH },
  { id: 'clash-for-windows', name: 'Clash for Windows', configPath: CFW_CONFIG_PATH }
];
const WEBVIEW_LEVELDB = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'io.github.clash-verge-rev.clash-verge-rev', 'EBWebView', 'Default', 'Local Storage', 'leveldb'
);
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const VERIFY_TEST_URL = 'https://cp.cloudflare.com/generate_204';
const TARGET_GROUP = process.env.CLASH_TARGET_GROUP || '🐟漏网之鱼';
const SWITCH_THRESHOLD_MS = Number(process.env.SWITCH_THRESHOLD_MS || 25);
const MANUAL_PAUSE_MS = Number(process.env.MANUAL_PAUSE_MINUTES || 15) * 60 * 1000;
const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'LoadBalance', 'Relay']);
const STATE_PATH = process.env.CLASH_PILOT_STATE || path.join(__dirname, 'data', 'state.json');
const runtime = { running: false, startedAt: null, history: [], health: {}, locks: new Map(), lastAuto: new Map(), nextRunAt: null, monitorOnly: false, selectedBackend: null, settings: { switchThresholdMs: SWITCH_THRESHOLD_MS, samples: 2, manualPauseMinutes: MANUAL_PAUSE_MS / 60000 } };

function loadRuntimeState() {
  try {
    const saved = JSON.parse(fsSync.readFileSync(STATE_PATH, 'utf8'));
    runtime.history = Array.isArray(saved.history) ? saved.history.slice(0, 100) : [];
    runtime.health = saved.health && typeof saved.health === 'object' ? saved.health : {};
    runtime.monitorOnly = Boolean(saved.monitorOnly);
    runtime.nextRunAt = saved.nextRunAt || null;
    runtime.locks = new Map(Object.entries(saved.locks || {}).map(([key, value]) => [key, Number(value)]));
    runtime.lastAuto = new Map(Object.entries(saved.lastAuto || {}));
    runtime.settings = { ...runtime.settings, ...(saved.settings || {}) };
    runtime.selectedBackend = saved.selectedBackend || null;
  } catch { /* first run or invalid state starts cleanly */ }
}

function persistRuntimeState() {
  try {
    fsSync.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.tmp`;
    fsSync.writeFileSync(temporary, JSON.stringify({ history: runtime.history, health: runtime.health, monitorOnly: runtime.monitorOnly, nextRunAt: runtime.nextRunAt, locks: Object.fromEntries(runtime.locks), lastAuto: Object.fromEntries(runtime.lastAuto), settings: runtime.settings, selectedBackend: runtime.selectedBackend }, null, 2), 'utf8');
    fsSync.renameSync(temporary, STATE_PATH);
  } catch { /* state persistence must not stop proxy switching */ }
}

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

function parseConfig(text) {
  const value = (key) => {
    const match = text.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'));
    return match ? match[1].replace(/^['"]|['"]$/g, '') : '';
  };
  return { controller: value('external-controller') || '127.0.0.1:9097', secret: value('secret') };
}

function regionFor(name) {
  return REGIONS.find((region) => region.pattern.test(name))?.id || 'other';
}

async function probeBackend(backend) {
  try {
    const config = parseConfig(await fs.readFile(backend.configPath, 'utf8'));
    const controller = /^https?:\/\//i.test(config.controller) ? config.controller : `http://${config.controller}`;
    const headers = config.secret ? { Authorization: `Bearer ${config.secret}` } : {};
    const response = await fetch(`${controller}/version`, { headers, signal: AbortSignal.timeout(1800) });
    if (!response.ok) return { ...backend, online: false };
    const version = await response.json().catch(() => ({}));
    return { ...backend, online: true, version: version.version || version.meta || 'unknown', config };
  } catch { return { ...backend, online: false }; }
}

async function discoverBackends() {
  return Promise.all(MIHOMO_BACKENDS.map(probeBackend));
}

function discoverV2rayNHome() {
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
    const result = { id: 'v2rayn', name: 'v2rayN', online: true, writable: false, mode: 'read-only', currentId: config.IndexId || null, groupId: config.SubIndexId || null };
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

async function activeBackend() {
  const backends = await discoverBackends();
  return backends.find((item) => item.online && item.id === runtime.selectedBackend) || backends.find((item) => item.online) || null;
}

async function controllerRequest(route, options = {}) {
  const backend = await activeBackend();
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  const config = backend.config;
  const controller = /^https?:\/\//i.test(config.controller) ? config.controller : `http://${config.controller}`;
  const headers = { Accept: 'application/json', ...options.headers };
  if (config.secret) headers.Authorization = `Bearer ${config.secret}`;
  const response = await fetch(`${controller}${route}`, { ...options, headers, signal: AbortSignal.timeout(options.timeout || 10000) });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(body?.message || `Mihomo returned ${response.status}`), { status: response.status });
  return body;
}

async function inventory() {
  const backend = await activeBackend();
  if (!backend) throw new Error('No supported Clash/Mihomo controller is online');
  const payload = await controllerRequest('/proxies');
  const entries = Object.entries(payload.proxies || {});
  const proxies = new Map(entries);
  const groups = entries
    .filter(([, proxy]) => proxy.type === 'Selector')
    .map(([name, proxy]) => ({
      name,
      now: proxy.now,
      members: (proxy.all || []).filter((member) => {
        const item = proxies.get(member);
        return item && !GROUP_TYPES.has(item.type) && !['DIRECT', 'REJECT'].includes(member);
      })
    }))
    .filter((group) => group.members.length > 0);
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
  const counts = new Map(REGIONS.map((region) => [region.id, 0]));
  for (const member of members) {
    const id = regionFor(member);
    if (counts.has(id)) counts.set(id, counts.get(id) + 1);
  }
  return REGIONS.map(({ id, label, flag }) => ({ id, label, flag, count: counts.get(id) })).filter((item) => item.count > 0);
}

async function measureNode(name, testUrl, timeout) {
  const route = `/proxies/${encodeURIComponent(name)}/delay?timeout=${timeout}&url=${encodeURIComponent(testUrl)}`;
  const started = Date.now();
  try {
    const result = await controllerRequest(route, { timeout: timeout + 1500 });
    return { name, delay: Number(result.delay), ok: Number(result.delay) > 0 };
  } catch (error) {
    return { name, delay: null, ok: false, error: error.message, elapsed: Date.now() - started };
  }
}

async function measureNodeStable(name, testUrl, timeout, samples = 2) {
  const attempts = [];
  for (let index = 0; index < samples; index++) attempts.push(await measureNode(name, testUrl, timeout));
  const delays = attempts.filter((item) => item.ok).map((item) => item.delay).sort((a, b) => a - b);
  if (!delays.length) return { name, delay: null, ok: false, error: attempts.at(-1)?.error || 'All samples failed', samples: attempts };
  return { name, delay: delays[Math.floor(delays.length / 2)], ok: true, samples: attempts };
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
  for (const result of results) {
    const health = runtime.health[result.name] || { success: 0, failure: 0, latencies: [] };
    if (result.ok) {
      health.success++;
      health.latencies.unshift(result.delay);
      health.latencies = health.latencies.slice(0, 20);
    } else health.failure++;
    health.updatedAt = new Date().toISOString();
    runtime.health[result.name] = health;
  }
}

function healthScore(result) {
  const health = runtime.health[result.name] || { success: 0, failure: 0 };
  const total = health.success + health.failure;
  const failureRate = total ? health.failure / total : 0;
  return result.delay + failureRate * 200;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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

async function apiHandler(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/status') {
    const { groups, backend } = await inventory();
    const targetGroup = await pickPrimaryGroup(groups, backend);
    const discovered = await discoverBackends();
    const v2rayN = detectV2rayN();
    return sendJson(res, 200, {
      connected: true,
      backend: { id: backend.id, name: backend.name, version: backend.version },
      backends: discovered.map(({ id, name, online, version }) => ({ id, name, online, version })),
      detectedClients: [...discovered.map(({ id, name, online, version }) => ({ id, name, online, version, writable: true })), v2rayN],
      groups: groups.map((group) => ({ name: group.name, now: group.now, nodeCount: group.members.length, regions: summarizeRegions(group.members) })),
      targetGroup: targetGroup?.name,
      targetSource: backend.id === 'clash-verge' && (await selectedUiGroup(groups)) ? 'clash-verge-ui' : 'fallback',
      automation: { running: runtime.running, startedAt: runtime.startedAt, history: runtime.history, nextRunAt: runtime.nextRunAt, lockMs: targetGroup ? lockRemaining(targetGroup.name) : 0, monitorOnly: Boolean(runtime.monitorOnly), settings: runtime.settings, trackedNodes: Object.keys(runtime.health).length },
      defaults: { testUrl: DEFAULT_TEST_URL, timeout: 5000 }
    });
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
    if (body.action === 'unlock') runtime.locks.delete(group.name);
    if (body.action === 'monitor') runtime.monitorOnly = Boolean(body.value);
    if (body.action === 'clear-history') runtime.history = [];
    if (body.action === 'settings') runtime.settings = {
      switchThresholdMs: Math.min(500, Math.max(0, Number(body.settings?.switchThresholdMs) || 25)),
      samples: Math.min(5, Math.max(1, Number(body.settings?.samples) || 2)),
      manualPauseMinutes: Math.min(1440, Math.max(1, Number(body.settings?.manualPauseMinutes) || 15))
    };
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
    runtime.running = true;
    runtime.startedAt = new Date().toISOString();
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
    runtime.nextRunAt = new Date(Date.now() + 180000).toISOString();
    persistRuntimeState();
    const entry = { skipped: false, region: selectedRegion, fallbackFrom, group: group.name, previous: group.now, active, best, switched: shouldSwitch && !runtime.monitorOnly, success: results.filter((item) => item.ok).length, candidates: results.length, improvement, score: Math.round(healthScore(best)) };
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

if (require.main === module) server.listen(PORT, HOST, () => console.log(`Clash Node Pilot: http://${HOST}:${PORT}`));

module.exports = { parseConfig, regionFor, summarizeRegions, mapLimit, detectSelectedGroupFromBuffer };
