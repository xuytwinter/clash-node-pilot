const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-test-'));
process.env.APPDATA = path.join(sandbox, 'Roaming');
process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
process.env.USERPROFILE = sandbox;
process.env.HOME = sandbox;
process.env.CLASH_PILOT_STATE = path.join(sandbox, 'explicit-state.json');
process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';

const {
  parseConfig,
  regionFor,
  summarizeRegions,
  mapLimit,
  detectSelectedGroupFromBuffer,
  resolvePilotDataDir,
  resolveStatePath,
  migrateLegacyState
} = require('../server');

test('parses controller config without requiring YAML dependency', () => {
  assert.deepEqual(parseConfig("external-controller: 127.0.0.1:9097\nsecret: 'abc'\n"), { controller: '127.0.0.1:9097', secret: 'abc' });
});

test('recognizes common region labels', () => {
  assert.equal(regionFor('🇯🇵 日本东京 01'), 'jp');
  assert.equal(regionFor('Tokyo Premium'), 'jp');
  assert.equal(regionFor('🇺🇸 美国 02'), 'us');
  assert.equal(regionFor('Singapore 03'), 'sg');
  assert.equal(regionFor('套餐剩余流量'), 'other');
});

test('summarizes only supported regions', () => {
  assert.deepEqual(summarizeRegions(['日本 01', 'Tokyo 02', '香港 01', '流量信息']).map(({ id, count }) => ({ id, count })), [{ id: 'jp', count: 2 }, { id: 'hk', count: 1 }]);
});

test('mapLimit preserves result order', async () => {
  const result = await mapLimit([3, 1, 2], 2, async (value) => value * 2);
  assert.deepEqual(result, [6, 2, 4]);
});

test('uses the latest Clash Verge UI selected group record', () => {
  const key = Buffer.from('clash-verge-selected-proxy-group:profile');
  const oldRecord = Buffer.concat([key, Buffer.from('🐟漏网之鱼', 'utf16le')]);
  const newRecord = Buffer.concat([key, Buffer.from('🚀节点选择', 'utf16le')]);
  const groups = [{ name: '🐟漏网之鱼' }, { name: '🚀节点选择' }];
  assert.equal(detectSelectedGroupFromBuffer(Buffer.concat([oldRecord, newRecord]), groups), '🚀节点选择');
});
test('state path honors CLASH_PILOT_STATE before LocalAppData default', () => {
  const base = path.join(sandbox, 'Local App Data');
  const explicit = path.join(sandbox, 'pilot', 'state.json');
  const env = { LOCALAPPDATA: base, CLASH_PILOT_STATE: explicit };
  assert.equal(resolveStatePath(env), path.resolve(explicit));
  assert.equal(resolveStatePath({ LOCALAPPDATA: base }), path.join(base, 'ClashNodePilot', 'state.json'));
  assert.equal(resolvePilotDataDir({ LOCALAPPDATA: base }), path.join(base, 'ClashNodePilot'));
});

test('legacy repository state migrates once without deleting the old file', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-migrate-'));
  const legacy = path.join(base, 'repo', 'data', 'state.json');
  const target = path.join(base, 'Local', 'ClashNodePilot', 'state.json');
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, '{"history":[{"ok":true}]}', 'utf8');
  assert.equal(migrateLegacyState(target, legacy, { LOCALAPPDATA: path.join(base, 'Local') }), true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"history":[{"ok":true}]}');
  assert.equal(fs.existsSync(legacy), true);
  fs.writeFileSync(target, '{"history":[]}', 'utf8');
  assert.equal(migrateLegacyState(target, legacy, { LOCALAPPDATA: path.join(base, 'Local') }), false);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"history":[]}');
});

test('Windows launch scripts prefer bundled runtime and keep PATH fallback', () => {
  const root = path.join(__dirname, '..');
  const startCmd = fs.readFileSync(path.join(root, 'start-clash-node-pilot.cmd'), 'utf8');
  const watchdog = fs.readFileSync(path.join(root, 'startup-watchdog.ps1'), 'utf8');
  const install = fs.readFileSync(path.join(root, 'install-autostart.ps1'), 'utf8');
  assert.match(startCmd, /runtime\\node\.exe/);
  assert.match(startCmd, /set "NODE_EXE=node\.exe"/);
  assert.match(watchdog, /runtime\\node\.exe/);
  assert.match(watchdog, /Get-Command node\.exe/);
  assert.match(install, /runtime\\node\.exe/);
  assert.match(install, /Get-Command node\.exe/);
});
