const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'smoke-installer.ps1');
const version = require('../package.json').version;
const setup = process.env.CLASH_PILOT_TEST_INSTALLER || path.join(root, 'outputs', `clash-node-pilot-v${version}-windows-x64-setup.exe`);

test('user integration mode rejects local execution before resolving or running the installer', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-SetupPath', 'missing-installer-must-not-be-resolved.exe', '-VerifyIntegration'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000,
    env: { ...process.env, GITHUB_ACTIONS: 'false', RUNNER_OS: 'Windows' }
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VerifyIntegration requires a GitHub Actions Windows runner/);
  assert.doesNotMatch(result.stderr, /Resolve-Path/);
});

test('installer lifecycle preserves state and refuses live replacement (no user integration)', {
  skip: process.platform !== 'win32' ? 'Windows installer requires Windows.' : !fs.existsSync(setup) ? 'Build the setup executable to run actual installer acceptance.' : false,
  timeout: 240000
}, () => {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-SetupPath', setup], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 230000
  });
  const report = JSON.parse(output.replace(/^\uFEFF/, '').trim());
  assert.equal(report.ok, true);
  assert.equal(report.mode, 'real-installer-no-user-integration');
  assert.match(report.setupSha256, /^[a-f0-9]{64}$/);
  assert.ok(report.checks.length >= 15);
  assert.equal(report.retainedPath, null);
});
