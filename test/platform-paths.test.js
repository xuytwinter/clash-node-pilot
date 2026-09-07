const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  clashVergeLevelDbPath,
  configBackends,
  macosConfigBackends,
  resolvePilotDataDir,
  resolveStatePath,
  windowsConfigBackends
} = require('../src/platform/paths');

test('Windows state and config paths preserve current defaults', () => {
  const env = {
    APPDATA: 'C:\\Users\\Pilot\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\Pilot\\AppData\\Local',
    USERPROFILE: 'C:\\Users\\Pilot'
  };

  assert.equal(resolvePilotDataDir(env, 'win32'), path.join(env.LOCALAPPDATA, 'ClashNodePilot'));
  assert.equal(resolveStatePath(env, 'win32'), path.join(env.LOCALAPPDATA, 'ClashNodePilot', 'state.json'));
  assert.deepEqual(windowsConfigBackends(env).map((backend) => [backend.id, backend.configPath]), [
    ['clash-verge', path.join(env.APPDATA, 'io.github.clash-verge-rev.clash-verge-rev', 'config.yaml')],
    ['clash-for-windows', path.join(env.USERPROFILE, '.config', 'clash', 'config.yaml')]
  ]);
  assert.equal(
    clashVergeLevelDbPath(env, 'win32'),
    path.join(env.LOCALAPPDATA, 'io.github.clash-verge-rev.clash-verge-rev', 'EBWebView', 'Default', 'Local Storage', 'leveldb')
  );
});

test('macOS state defaults to Application Support and honors explicit state override', () => {
  const env = { HOME: '/Users/pilot' };
  const explicit = { ...env, CLASH_PILOT_STATE: '/tmp/pilot-state.json' };

  assert.equal(resolvePilotDataDir(env, 'darwin'), '/Users/pilot/Library/Application Support/ClashNodePilot');
  assert.equal(resolveStatePath(env, 'darwin'), '/Users/pilot/Library/Application Support/ClashNodePilot/state.json');
  assert.equal(resolveStatePath(explicit, 'darwin'), path.resolve('/tmp/pilot-state.json'));
  assert.equal(resolvePilotDataDir({ ...env, LOCALAPPDATA: 'ignored-windows-path' }, 'darwin'), '/Users/pilot/Library/Application Support/ClashNodePilot');
  assert.equal(resolvePilotDataDir({ HOME: '/Users/another' }, 'darwin'), '/Users/another/Library/Application Support/ClashNodePilot');
});

test('CLASH_CONFIG is first and demo mode excludes discovered clients', () => {
  const env = {
    HOME: '/Users/pilot',
    CLASH_CONFIG: '/Users/pilot/manual/config.yaml'
  };

  assert.deepEqual(configBackends({ env, platform: 'darwin' }).map((backend) => backend.id), [
    'custom',
    'macos-clash-verge-rev',
    'macos-clash-nyanpasu',
    'macos-clashx-meta'
  ]);
  assert.deepEqual(configBackends({ env, platform: 'darwin', demoMode: true }).map((backend) => backend.id), ['demo']);
  assert.deepEqual(configBackends({ env: { HOME: '/Users/pilot' }, platform: 'darwin', demoMode: true }), []);
});

test('macOS discovers reused Clash Verge and Mihomo-compatible config candidates without Windows LevelDB', () => {
  const env = { HOME: '/Users/pilot' };

  assert.deepEqual(macosConfigBackends(env).map((backend) => [backend.id, backend.configPath]), [
    ['macos-clash-verge-rev', '/Users/pilot/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/config.yaml'],
    ['macos-clash-nyanpasu', '/Users/pilot/Library/Application Support/clash-nyanpasu/config.yaml'],
    ['macos-clashx-meta', '/Users/pilot/.config/clash/config.yaml']
  ]);
  assert.equal(clashVergeLevelDbPath(env, 'darwin'), null);
});
