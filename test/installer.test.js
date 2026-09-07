const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'smoke-installer.ps1');
const version = require('../package.json').version;
const setup = process.env.CLASH_PILOT_TEST_INSTALLER || path.join(root, 'outputs', `clash-node-pilot-v${version}-windows-x64-setup.exe`);

test('shortcut path handling accepts COM quote pairs and rejects malformed paths', { skip: process.platform !== 'win32' }, () => {
  const command = `
    $ErrorActionPreference = 'Stop'
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($env:PILOT_SMOKE_SCRIPT, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw 'Smoke script parse failed' }
    $definition = $ast.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'ConvertFrom-ShortcutPath' }, $true)
    . ([scriptblock]::Create($definition.Extent.Text))
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut((Join-Path ([IO.Path]::GetTempPath()) 'pilot-unsaved-shortcut-test.lnk'))
    try {
      $expected = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
      $link.WorkingDirectory = [char]34 + $expected + [char]34
      if ($link.WorkingDirectory -cne ([char]34 + $expected + [char]34)) { throw 'COM reproduction did not retain quotes' }
      if ([IO.Path]::GetFullPath((ConvertFrom-ShortcutPath $link.WorkingDirectory)) -cne $expected) { throw 'COM path did not normalize' }
      if ((ConvertFrom-ShortcutPath $expected) -cne $expected) { throw 'Unquoted path was modified' }
      foreach ($bad in @('', 'relative', ([char]34 + $expected), ($expected + [char]34), ([char]34 + $expected + [char]34 + ' extra'))) {
        $rejected = $false
        try { ConvertFrom-ShortcutPath $bad | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Malformed shortcut path was accepted' }
      }
    } finally {
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($link)
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
    }
  `;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, PILOT_SMOKE_SCRIPT: script }
  });
});

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
