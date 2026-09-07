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
  migrateLegacyState,
  resolveEffectiveSelector,
  realMembers
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

test('resolves nested selector chain to the selector that owns the real node', () => {
  const proxies = new Map([
    ['AI Sites', { type: 'Selector', now: 'Proxy Select', all: ['Proxy Select', 'US 01'] }],
    ['Proxy Select', { type: 'Selector', now: 'Japan 01', all: ['Japan 01', 'Japan 02'] }],
    ['Japan 01', { type: 'Vless' }],
    ['Japan 02', { type: 'Vless' }],
    ['US 01', { type: 'Vless' }]
  ]);
  assert.deepEqual(resolveEffectiveSelector(proxies, 'AI Sites'), {
    group: 'AI Sites',
    chain: [{ name: 'AI Sites', now: 'Proxy Select' }, { name: 'Proxy Select', now: 'Japan 01' }],
    controlGroup: 'Proxy Select',
    leaf: 'Japan 01'
  });
  assert.deepEqual(realMembers(proxies, 'AI Sites'), ['US 01']);
  assert.deepEqual(realMembers(proxies, 'Proxy Select'), ['Japan 01', 'Japan 02']);
});
test('state path honors CLASH_PILOT_STATE before LocalAppData default', () => {
  const base = path.join(sandbox, 'Local App Data');
  const explicit = path.join(sandbox, 'pilot', 'state.json');
  const env = { LOCALAPPDATA: base, CLASH_PILOT_STATE: explicit };
  assert.equal(resolveStatePath(env, 'win32'), path.resolve(explicit));
  assert.equal(resolveStatePath({ LOCALAPPDATA: base }, 'win32'), path.join(base, 'ClashNodePilot', 'state.json'));
  assert.equal(resolvePilotDataDir({ LOCALAPPDATA: base }, 'win32'), path.join(base, 'ClashNodePilot'));
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
  const release = fs.readFileSync(path.join(root, 'release.ps1'), 'utf8');
  assert.match(startCmd, /-File "%~dp0start-pilot\.ps1"/);
  const launcher = fs.readFileSync(path.join(root, 'start-pilot.ps1'), 'utf8');
  assert.match(launcher, /startup-watchdog\.ps1/);
  assert.match(launcher, /LASTEXITCODE/);
  assert.match(watchdog, /runtime\\node\.exe/);
  assert.match(watchdog, /Get-Command node\.exe/);
  assert.match(install, /install-pilot-autostart\.ps1/);
  assert.match(release, /'src'/);
  assert.match(release, /Test-PilotLaunch -AppDir \$stageDir/);
  assert.match(release, /Expand-Archive -LiteralPath \$zipPath/);
});
