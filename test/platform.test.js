const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLaunchAgentPlist, MACOS_CLIENT_ADAPTERS, manualPairingBackend } = require('../src/platform/macos');
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

test('Windows adapters retain v0.1.0 discovery ids', () => {
  const env = { APPDATA: 'C:\\Users\\Test\\AppData\\Roaming' };
  assert.deepEqual(windowsConfigBackends(env).map((item) => item.id), ['clash-verge', 'clash-for-windows']);
});
