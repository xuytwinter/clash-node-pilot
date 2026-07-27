const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLaunchAgentPlist, macosLaunchAgentPath, macosStartupStatus, setMacosStartupEnabled, MACOS_CLIENT_ADAPTERS, manualPairingBackend } = require('../src/platform/macos');
const { createSecureStore } = require('../src/platform/secure-store');
const { windowsConfigBackends } = require('../src/platform/windows');

test('macOS adapters model supported Controller capabilities', () => {
  assert.ok(MACOS_CLIENT_ADAPTERS.length >= 3);
  for (const adapter of MACOS_CLIENT_ADAPTERS) {
    assert.equal(adapter.platform, 'macos');
    assert.equal(adapter.capabilities.switching, 'supported');
    assert.match(adapter.configPath, /config\.yaml$/);
  }
});

test('manual pairing backend reads secret through secure store only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-secure-store-'));
  const store = createSecureStore({ platform: 'test', dataDir: root });
  store.set('manual-test', 'secret-value');
  const backend = manualPairingBackend({ id: 'manual-test', name: 'Lab Controller', controller: 'http://127.0.0.1:40001' }, store);
  assert.equal(backend.config.secret, 'secret-value');
  const publicShape = { id: backend.id, name: backend.name, controller: backend.config.controller };
  assert.deepEqual(publicShape, { id: 'manual-test', name: 'Lab Controller', controller: 'http://127.0.0.1:40001' });
  store.delete('manual-test');
  assert.equal(store.get('manual-test'), '');
});

test('LaunchAgent preview plist contains no secret and keeps a local service command', () => {
  const plist = createLaunchAgentPlist({
    programPath: '/Applications/Clash Node Pilot/runtime/node',
    workingDirectory: '/Applications/Clash Node Pilot',
    port: 3210
  });
  assert.match(plist, /com\.clash-node-pilot\.service/);
  assert.match(plist, /server\.js/);
  assert.match(plist, /3210/);
  assert.doesNotMatch(plist, /secret|Bearer|token/i);
});

test('macOS startup preview writes and removes a per-user LaunchAgent plist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-macos-startup-'));
  const env = { HOME: path.join(root, 'home'), PORT: '43121' };
  const calls = [];
  const execFile = (file, args) => {
    calls.push([file, args]);
    if (args[0] === 'bootout') throw new Error('not loaded');
  };

  const enabled = setMacosStartupEnabled(true, root, { platform: 'darwin', env, execFile, uid: 501 });
  const plistPath = macosLaunchAgentPath(env);
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.plistPath, plistPath);
  assert.match(fs.readFileSync(plistPath, 'utf8'), /43121/);
  assert.deepEqual(calls.at(-1), ['launchctl', ['bootstrap', 'gui/501', plistPath]]);

  const disabled = setMacosStartupEnabled(false, root, { platform: 'darwin', env, execFile, uid: 501 });
  assert.equal(disabled.enabled, false);
  assert.equal(fs.existsSync(plistPath), false);
});

test('macOS startup preview removes plist when launchctl bootstrap fails', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-macos-startup-fail-'));
  const env = { HOME: path.join(root, 'home'), PORT: '43122' };
  const execFile = (file, args) => {
    if (args[0] === 'bootstrap') throw new Error('bootstrap failed');
  };

  assert.throws(() => setMacosStartupEnabled(true, root, { platform: 'darwin', env, execFile, uid: 501 }), /bootstrap failed/);
  assert.equal(fs.existsSync(macosLaunchAgentPath(env)), false);
});

test('macOS startup status remains unsupported on non-macOS platforms', () => {
  const status = macosStartupStatus({ platform: 'linux', env: { HOME: os.tmpdir() } });
  assert.equal(status.supported, false);
  assert.equal(status.enabled, false);
  assert.equal(status.plistPath, null);
});

test('Windows adapters retain v0.1.0 discovery ids', () => {
  const env = { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' };
  assert.deepEqual(windowsConfigBackends(env).map((item) => item.id), ['clash-verge', 'clash-for-windows']);
});
