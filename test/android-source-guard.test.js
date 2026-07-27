const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('Android ControllerClient sets Authorization before opening request body', () => {
  const text = source('android/app/src/main/java/com/clashnodepilot/companion/ControllerClient.java');
  const auth = text.indexOf('setRequestProperty("Authorization"');
  const output = text.indexOf('getOutputStream()');
  assert.notEqual(auth, -1);
  assert.notEqual(output, -1);
  assert.ok(auth < output);
});

test('Android pairing persistence enforces phone-local Controller URLs', () => {
  const store = source('android/app/src/main/java/com/clashnodepilot/companion/PairingStore.java');
  const activity = source('android/app/src/main/java/com/clashnodepilot/companion/MainActivity.java');
  assert.match(store, /validateLocalControllerUrl\(controllerUrl\)/);
  assert.match(store, /new URI\(value\)/);
  assert.match(store, /isPhoneLocalHost\(host\)/);
  assert.match(store, /rawPath/);
  assert.doesNotMatch(activity, /controllerUrl\.matches\(/);
});
