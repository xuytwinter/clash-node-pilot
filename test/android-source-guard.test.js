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

test('Android UI uses user-facing node selection language and result ranking', () => {
  const activity = source('android/app/src/main/java/com/clashnodepilot/companion/MainActivity.java');
  const service = source('android/app/src/main/java/com/clashnodepilot/companion/PilotForegroundService.java');
  const optimizer = source('android/app/src/main/java/com/clashnodepilot/companion/AndroidOptimizer.java');
  assert.match(activity, /节点优选/);
  assert.match(activity, /开始测速并优选/);
  assert.match(activity, /测速结果/);
  assert.match(activity, /regionHk|regionJp|regionSg|regionUs/);
  assert.match(activity, /renderResults\(AndroidOptimizer\.Result/);
  assert.match(service, /节点优选/);
  assert.match(optimizer, /List<NodeResult> rankings/);
  assert.doesNotMatch(activity, /自动优化|立即优化|启动自动|停止自动|保存优化|优化失败|优化设置/);
});
