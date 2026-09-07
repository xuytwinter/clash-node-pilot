const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const HOST = '127.0.0.1';
const DEFAULT_ZIP = path.join(__dirname, '..', 'outputs', `clash-node-pilot-v${require('../package.json').version}-windows-x64-portable.zip`);

function parseArgs(argv) {
  const options = { zip: DEFAULT_ZIP, keep: false };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--zip') options.zip = argv[++index] || options.zip;
    else if (item.startsWith('--zip=')) options.zip = item.slice('--zip='.length);
    else if (item === '--keep') options.keep = true;
    else if (item === '--help' || item === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${item}`);
  }
  return options;
}

function showHelp() {
  console.log([
    'Usage: node scripts/smoke-package.js [--zip PATH] [--keep]',
    '',
    'Extracts the portable zip to a temp path containing spaces and Chinese characters,',
    'starts the bundled demo with the bundled Node runtime, fetches API/static resources,',
    'and runs the bundled benchmark script.'
  ].join('\n'));
}

function expandArchive(zipPath, destination) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destination)} -Force`
  ], { stdio: 'pipe', windowsHide: true, timeout: 60000 });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestText(port, route, { token, method = 'GET', body, expectedStatus = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port,
      path: route,
      method,
      headers: {
        Host: `${HOST}:${port}`,
        ...(token ? { 'x-pilot-session': token } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== expectedStatus) {
          reject(new Error(`${route} returned HTTP ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error(`Timed out requesting ${route}`)));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function verifyDemo(port, version) {
  const json = async (route, options) => JSON.parse(await requestText(port, route, options));
  const health = await json('/api/health');
  assert.equal(health.ok, true);
  assert.equal(Number(health.port), port);
  assert.equal(health.version, version);
  for (const route of ['/api/status', '/api/diagnostics']) {
    assert.equal((await json(route, { expectedStatus: 403 })).code, 'invalid-session');
  }
  const { token } = await json('/api/session');
  assert.match(token, /^[a-f0-9]{64}$/);
  const get = route => json(route, { token });
  const post = (route, body) => json(route, { token, method: 'POST', body });
  const initial = await get('/api/status');
  assert.equal(initial.backend?.id, 'demo');
  assert.equal(initial.demo?.enabled, true);
  assert.equal(initial.startup?.supported, false);

  await post('/api/demo-scenario', { scenario: 'healthy' });
  const manual = await post('/api/optimize', { group: 'Proxy Select', region: 'us', switch: true });
  assert.equal(manual.switched, true);
  assert.equal(manual.active, 'US 01');
  assert.equal(manual.commit?.writeResult, 'verified');
  assert.equal(manual.commit?.verified, true);
  const selected = await get('/api/status');
  assert.equal(selected.groups.find(group => group.name === 'Proxy Select')?.now, manual.active);
  await post('/api/automation', { action: 'unlock' });
  await post('/api/auto-optimize', { force: true });
  const measured = await get('/api/status');
  assert.ok(measured.automation.history.length > 0);
  assert.ok(measured.automation.trackedNodes > 0);

  const diagnostics = await get('/api/diagnostics');
  assert.equal(diagnostics.schemaVersion, 1);
  assert.equal(diagnostics.identifierScheme, 'report-local-index');
  assert.equal(diagnostics.app?.version, version);
  assert.ok(diagnostics.history.length > 0);
  assert.match(diagnostics.privacy, /review before sharing/i);
  const diagnosticText = JSON.stringify(diagnostics);
  for (const identifier of ['Proxy Select', 'Japan 01', 'US 01', 'external-controller']) {
    assert.ok(!diagnosticText.includes(identifier), `Diagnostic leaked ${identifier}`);
  }

  await post('/api/automation', { action: 'lock' });
  await post('/api/automation', { action: 'monitor', value: true });
  const locked = await get('/api/status');
  assert.ok(locked.automation.lockMs > 0);
  assert.equal(locked.automation.monitorOnly, true);
  const reset = await post('/api/demo-scenario', { scenario: 'target-outage' });
  assert.equal(reset.scenario, 'target-outage');
  const clean = await get('/api/status');
  assert.deepEqual(clean.automation.history, []);
  assert.equal(clean.automation.lastResults, null);
  assert.equal(clean.automation.trackedNodes, 0);
  assert.equal(clean.automation.lockMs, 0);
  assert.equal(clean.automation.monitorOnly, false);
  assert.equal(clean.automation.nextRunAt, null);
  assert.equal(clean.automation.nextConnectivityCheckAt, null);
  assert.equal(clean.groups.find(group => group.name === 'Proxy Select')?.now, 'Japan 01');
  const cleanDiagnostics = await get('/api/diagnostics');
  assert.equal(cleanDiagnostics.automation.activeLocks, 0);
  return { authenticated: true, writeResult: manual.commit.writeResult, diagnosticsSchema: diagnostics.schemaVersion, resetScenario: reset.scenario };
}

function verifyBenchmark(report) {
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.ticks, 12);
  assert.equal(report.stepSeconds, 30);
  assert.equal(report.results.length, 3);
  const rows = new Map(report.results.map(row => [row.policy, row]));
  for (const policy of ['pilot-http', 'fixed-initial', 'naive-lowest-latency']) {
    const row = rows.get(policy);
    assert.ok(row, `Missing benchmark policy: ${policy}`);
    assert.equal(row.name, 'threshold-noise');
    assert.equal(row.observations.length, report.ticks);
    assert.equal(row.recoverySteps, 0);
    assert.equal(row.unavailableAfterActionSteps, 0);
    assert.equal(row.harmfulSwitches, 0);
    assert.ok(Number.isFinite(row.meanSelectedLatencyMs));
  }
  const pilot = rows.get('pilot-http');
  assert.equal(pilot.switches, 0);
  assert.ok(pilot.reasonCodes.includes('below-threshold'));
  assert.equal(rows.get('fixed-initial').probeCount, 0);
  assert.equal(rows.get('naive-lowest-latency').probeCount, 3 * report.ticks);
  assert.ok(pilot.probeCount > rows.get('naive-lowest-latency').probeCount);
  return pilot;
}

async function waitForPort(process, getOutput) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Demo exited early:\n${getOutput()}`);
    const match = getOutput().match(/Clash Node Pilot demo: http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) return Number(match[1]);
    await wait(250);
  }
  throw new Error(`Timed out waiting for demo port:\n${getOutput()}`);
}

function findAppDir(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const app = entries.find((entry) => entry.name.startsWith('clash-node-pilot-v') && entry.name.endsWith('-windows-x64'));
  if (!app) throw new Error('Extracted app directory was not found');
  return path.join(root, app.name);
}

function cleanup(root, keep) {
  if (keep) return;
  const resolved = path.resolve(root);
  const temp = path.resolve(os.tmpdir());
  if (!resolved.startsWith(temp + path.sep)) throw new Error(`Refusing to remove non-temp smoke path: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

async function smoke(options) {
  const zipPath = path.resolve(options.zip);
  if (!fs.existsSync(zipPath)) throw new Error(`Package zip not found: ${zipPath}`);
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot package smoke 中文 '));
  let demo = null;
  try {
    expandArchive(zipPath, smokeRoot);
    const appDir = findAppDir(smokeRoot);
    const nodeExe = path.join(appDir, 'runtime', 'node.exe');
    const demoScript = path.join(appDir, 'scripts', 'demo.js');
    const benchmarkScript = path.join(appDir, 'scripts', 'benchmark.js');
    for (const required of [nodeExe, demoScript, benchmarkScript,
      ...['package.json', 'BUILD-INFO.json', 'start-pilot.ps1', 'windows-common.ps1',
        'runtime/NODE-LICENSE', 'runtime/NODE-RUNTIME.txt', 'src/core/diagnostics.js',
        'public/index.html', 'public/guide.html', 'docs/benchmarks.md'].map(file => path.join(appDir, file))]) {
      if (!fs.existsSync(required)) throw new Error(`Required extracted file missing: ${required}`);
    }
    const packageVersion = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
    const buildInfo = JSON.parse(fs.readFileSync(path.join(appDir, 'BUILD-INFO.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(buildInfo.version, packageVersion);
    assert.match(buildInfo.sourceSha, /^[a-f0-9]{40}$/);
    assert.ok(['clean', 'dirty'].includes(buildInfo.workingTree));

    let output = '';
    demo = spawn(nodeExe, [demoScript, '--no-auto'], {
      cwd: appDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    demo.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    demo.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    const port = await waitForPort(demo, () => output);

    const api = await verifyDemo(port, packageVersion);
    const stateDirectory = output.match(/Demo state directory: ([^\r\n]+)/)?.[1];
    if (!stateDirectory) throw new Error('Demo did not report its isolated state directory');
    const resetState = JSON.parse(fs.readFileSync(path.join(stateDirectory, 'state.json'), 'utf8'));
    for (const field of ['health', 'locks', 'lastAuto', 'lastSwitch']) {
      assert.deepEqual(resetState[field], {}, `Demo reset retained ${field}`);
    }
    assert.deepEqual(resetState.history, []);
    assert.equal(resetState.lastResults, null);

    for (const route of ['/', '/styles.css', '/app.js', '/guide.html', '/guide.css']) {
      const content = await requestText(port, route);
      if (!content.trim()) throw new Error(`Static resource was empty: ${route}`);
    }

    const benchmark = execFileSync(nodeExe, [benchmarkScript, '--scenario', 'threshold-noise', '--json'], {
      cwd: appDir, encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
    });
    const report = JSON.parse(benchmark);
    const pilot = verifyBenchmark(report);

    return { appDir, port, api, benchmark: pilot };
  } finally {
    if (demo && demo.exitCode === null) {
      demo.kill();
      await new Promise((resolve) => demo.once('exit', resolve));
    }
    cleanup(smokeRoot, options.keep);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  const result = await smoke(options);
  console.log(`package smoke ok: ${result.appDir}`);
  console.log(`demo port: ${result.port}`);
  console.log(`benchmark outcome: ${result.benchmark.reasonCodes.at(-1)}`);
}

module.exports = { verifyDemo, verifyBenchmark, smoke };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
