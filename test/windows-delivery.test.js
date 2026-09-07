const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
const quote = value => "'" + value.replaceAll("'", "''") + "'";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot spaces ' \u4e2d\u6587 "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of fs.readdirSync(root).filter(name => name.endsWith('.ps1'))) {
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  fs.mkdirSync(path.join(dir, 'runtime'));
  fs.writeFileSync(path.join(dir, 'runtime', 'node.exe'), '');
  fs.writeFileSync(path.join(dir, 'server.js'), '');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"9.8.7"}');
  return dir;
}

function powershell(script, env = {}) {
  const started = Date.now();
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')
  ], { encoding: 'utf8', timeout: 25000, windowsHide: true, env: { ...process.env, ...env } });
  assert.ifError(result.error && Object.assign(new Error(
    `PowerShell execution failed after ${Date.now() - started}ms: ${result.error.code}; status=${result.status}; signal=${result.signal}; stdout=${result.stdout}; stderr=${result.stderr}`
  ), { cause: result.error }));
  return result;
}

test('Windows health survives controller disconnect without process changes', { skip: !windows }, t => {
  const dir = fixture(t);
  const result = powershell(`
    function Invoke-RestMethod { param($Uri) Write-Host $Uri; return @{ok=$true; port=43210; connected=$false} }
    function Start-Process { throw 'Unexpected start' }
    function Stop-Process { throw 'Unexpected stop' }
    & ${quote(path.join(dir, 'startup-watchdog.ps1'))}
  `, { PORT: '43210' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /http:\/\/127\.0\.0\.1:43210\/api\/health/);
});

test('Windows watchdog quotes project path and uses bundled node and custom port', { skip: !windows }, t => {
  const dir = fixture(t);
  const capture = path.join(dir, 'start.json');
  const result = powershell(`
    $global:probes = 0
    function Invoke-RestMethod {
      $global:probes++
      if ($global:probes -eq 1) { throw 'offline' }
      return @{ok=$true; port=43211}
    }
    function Start-Process {
      param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle)
      @{file=$FilePath; arguments=$ArgumentList; cwd=$WorkingDirectory; style=$WindowStyle; port=$env:PORT} |
        ConvertTo-Json | Set-Content -LiteralPath ${quote(capture)} -Encoding UTF8
    }
    function Stop-Process { throw 'Unexpected stop' }
    & ${quote(path.join(dir, 'startup-watchdog.ps1'))} -Port 43211
  `);
  assert.equal(result.status, 0, result.stderr);
  const start = JSON.parse(fs.readFileSync(capture, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(start.file, path.join(dir, 'runtime', 'node.exe'));
  assert.equal(start.arguments, '"' + path.join(dir, 'server.js') + '"');
  assert.equal(start.cwd, dir);
  assert.equal(start.port, '43211');
  assert.equal(start.style, 'Hidden');
});

test('Windows port validation rejects invalid values before any network or process operation', { skip: !windows }, t => {
  const dir = fixture(t);
  for (const port of ['0', '65536', '3210&whoami']) {
    const result = powershell(`
      function Invoke-RestMethod { throw 'Unexpected request' }
      function Start-Process { throw 'Unexpected start' }
      & ${quote(path.join(dir, 'startup-watchdog.ps1'))} -Port ${quote(port)}
    `);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PORT must be an integer/);
  }
});

test('Windows autostart persists the port and registers no optimizer or Clash startup', { skip: !windows }, t => {
  const dir = fixture(t);
  const capture = path.join(dir, 'registration.json');
  const result = powershell(`
    function Set-ItemProperty {
      param($Path, $Name, $Value)
      @{name=$Name; value=$Value} | ConvertTo-Json | Set-Content -LiteralPath ${quote(capture)} -Encoding UTF8
    }
    function Remove-ItemProperty { param($Path, $Name, $ErrorAction) }
    function Unregister-ScheduledTask { param($TaskName, $Confirm, $ErrorAction) }
    & ${quote(path.join(dir, 'install-pilot-autostart.ps1'))} -Port 43212
  `);
  assert.equal(result.status, 0, result.stderr);
  const registration = JSON.parse(fs.readFileSync(capture, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(registration.name, 'Clash Node Pilot Startup');
  assert.equal(registration.value, 'wscript.exe "' + path.join(dir, 'run-powershell-hidden.vbs') +
    '" "' + path.join(dir, 'startup-watchdog.ps1') + '" -Port 43212');
});

test('Windows release takes package version and preserves old archives on native git failure', { skip: !windows }, t => {
  const dir = fixture(t);
  fs.mkdirSync(path.join(dir, 'outputs'));
  const oldZip = path.join(dir, 'outputs', 'clash-node-pilot-v1.0.0-windows-x64-portable.zip');
  fs.writeFileSync(oldZip, 'old release');
  const result = powershell(`
    function git { $global:LASTEXITCODE = 23; return 'pretend-output' }
    function Invoke-WebRequest { throw 'Unexpected download' }
    & ${quote(path.join(dir, 'release.ps1'))}
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot determine build source SHA/);
  assert.equal(fs.readFileSync(oldZip, 'utf8'), 'old release');
});

test('Windows manual optimization obtains session token before posting on configured port', { skip: !windows }, t => {
  const dir = fixture(t);
  const capture = path.join(dir, 'requests.json');
  const result = powershell(`
    $global:requests = @()
    function Invoke-RestMethod {
      param($Uri, $Method, $Headers, $ContentType, $Body, $TimeoutSec)
      $token = if ($Headers) { $Headers['x-pilot-session'] } else { $null }
      $global:requests += @{uri=$Uri; method=$Method; token=$token}
      $global:requests | ConvertTo-Json | Set-Content -LiteralPath ${quote(capture)} -Encoding UTF8
      if ($Uri.EndsWith('/api/session')) { return @{token='isolated-test-token'} }
      return @{ok=$true}
    }
    & ${quote(path.join(dir, 'auto-optimize.ps1'))} -Port 43213
  `, { LOCALAPPDATA: dir });
  assert.equal(result.status, 0, result.stderr);
  const requests = JSON.parse(fs.readFileSync(capture, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(requests[0].uri, 'http://127.0.0.1:43213/api/session');
  assert.equal(requests[1].uri, 'http://127.0.0.1:43213/api/auto-optimize');
  assert.equal(requests[1].method, 'Post');
  assert.equal(requests[1].token, 'isolated-test-token');
});

test('release workflow fails immediately after every native validation and build command', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  for (const command of ['npm test', 'node --check server.js', 'node --check public/app.js',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\release.ps1 -Version $version']) {
    const lines = workflow.split(/\r?\n/);
    const index = lines.findIndex(line => line.trim() === command);
    assert.ok(index >= 0, command);
    assert.match(lines[index + 1], /if \(\$LASTEXITCODE -ne 0\).*throw/);
  }
});
