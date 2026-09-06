const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const HOST = '127.0.0.1';
const DEFAULT_ZIP = path.join(__dirname, '..', 'outputs', 'clash-node-pilot-v0.1.0-windows-x64-portable.zip');

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
    `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destination)} -Force`
  ], { stdio: 'pipe' });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestText(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port,
      path: route,
      method: 'GET',
      headers: { Host: `${HOST}:${port}` }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          reject(new Error(`${route} returned HTTP ${res.statusCode}: ${body}`));
          return;
        }
        resolve(body);
      });
    });
    req.on('error', reject);
    req.end();
  });
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
    for (const required of [nodeExe, demoScript, benchmarkScript, path.join(appDir, 'public', 'index.html'), path.join(appDir, 'docs', 'benchmarks.md')]) {
      if (!fs.existsSync(required)) throw new Error(`Required extracted file missing: ${required}`);
    }

    let output = '';
    demo = spawn(nodeExe, [demoScript, '--no-auto'], {
      cwd: appDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    demo.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
    demo.stderr.on('data', (chunk) => { output += chunk.toString('utf8'); });
    const port = await waitForPort(demo, () => output);

    const health = JSON.parse(await requestText(port, '/api/health'));
    if (health.ok !== true || Number(health.port) !== port) throw new Error('Health response mismatch');
    const status = JSON.parse(await requestText(port, '/api/status'));
    if (status.backend?.id !== 'demo' || status.demo?.enabled !== true) throw new Error('Demo status mismatch');

    for (const route of ['/', '/styles.css', '/app.js', '/guide.html']) {
      const content = await requestText(port, route);
      if (!content.trim()) throw new Error(`Static resource was empty: ${route}`);
    }

    const benchmark = execFileSync(nodeExe, [benchmarkScript, '--scenario', 'threshold-noise', '--json'], { cwd: appDir, encoding: 'utf8' });
    const report = JSON.parse(benchmark);
    if (report.results?.[0]?.reasonCodes?.at(-1) !== 'below-threshold') throw new Error('Bundled benchmark result mismatch');

    return { appDir, port, benchmark: report.results[0] };
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

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
