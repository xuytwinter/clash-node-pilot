const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = '127.0.0.1';
const STEP_SECONDS = 30;
const DEFAULT_SEED = 20260907;
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const VERIFY_TEST_URL = 'https://cp.cloudflare.com/generate_204';
const NODE_NAMES = ['Japan 01', 'Japan 02', 'US 01'];

function parseArgs(argv) {
  const options = { seed: DEFAULT_SEED, json: false, scenario: null };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === '--json') options.json = true;
    else if (item === '--seed') options.seed = Number(argv[++index]);
    else if (item.startsWith('--seed=')) options.seed = Number(item.slice('--seed='.length));
    else if (item === '--scenario') options.scenario = argv[++index] || null;
    else if (item.startsWith('--scenario=')) options.scenario = item.slice('--scenario='.length);
    else if (item === '--help' || item === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }
  if (!Number.isInteger(options.seed)) throw new Error('Seed must be an integer');
  return options;
}

function showHelp() {
  console.log([
    'Usage: node scripts/benchmark.js [--json] [--seed N] [--scenario NAME]',
    '',
    'Scenarios:',
    '  regional-failover',
    '  target-outage-auto',
    '  threshold-noise',
    '',
    'The benchmark starts an isolated fake Mihomo controller and drives the real local HTTP API.'
  ].join('\n'));
}

function hashParts(seed, parts) {
  let hash = seed >>> 0;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash >>> 0;
}

function deterministicJitter(seed, ...parts) {
  return (hashParts(seed, parts) % 9) - 4;
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function postJson(port, route, body = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port,
      path: route,
      method: 'POST',
      headers: {
        Host: `${HOST}:${port}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function baseDelay(scenario, name) {
  if (scenario === 'threshold-noise') {
    return { 'Japan 01': 100, 'Japan 02': 75.4, 'US 01': 130 }[name] || null;
  }
  return { 'Japan 01': 90, 'Japan 02': 55, 'US 01': 120 }[name] || null;
}

function isJapan(name) {
  return name.startsWith('Japan');
}

function truthServiceable(scenario, name, tick) {
  if (!NODE_NAMES.includes(name)) return false;
  if (scenario === 'regional-failover' && isJapan(name) && tick >= 2 && tick <= 5) return false;
  return true;
}

function delayFor({ scenario, seed, name, targetUrl, tick }) {
  if (!truthServiceable(scenario, name, tick)) return null;
  if (scenario === 'target-outage-auto' && isJapan(name) && targetUrl === DEFAULT_TEST_URL) return null;
  const base = baseDelay(scenario, name);
  if (!base) return null;
  const jitter = scenario === 'threshold-noise' ? 0 : deterministicJitter(seed, scenario, tick, name, targetUrl);
  return Math.max(1, base + jitter);
}

function createFakeController({ scenario, seed }) {
  const state = {
    tick: 0,
    active: { 'Proxy Select': 'Japan 01' },
    probes: [],
    puts: []
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}`);
    if (req.method === 'GET' && url.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: `fake-benchmark-${scenario}` }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proxies') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          'Proxy Select': { type: 'Selector', now: state.active['Proxy Select'], all: [...NODE_NAMES] },
          'Japan 01': { type: 'Vless' },
          'Japan 02': { type: 'Vless' },
          'US 01': { type: 'Vless' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/proxies/') && url.pathname.endsWith('/delay')) {
      const name = decodeURIComponent(url.pathname.split('/')[2]);
      const targetUrl = url.searchParams.get('url') || '';
      const delay = delayFor({ scenario, seed, name, targetUrl, tick: state.tick });
      state.probes.push({ tick: state.tick, name, targetUrl, ok: delay !== null });
      res.writeHead(delay !== null ? 200 : 504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(delay !== null ? { delay } : { message: 'benchmark timeout' }));
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/proxies/Proxy%20Select') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const from = state.active['Proxy Select'];
      const to = body.name;
      if (NODE_NAMES.includes(to)) {
        state.puts.push({
          tick: state.tick,
          from,
          to,
          fromServiceable: truthServiceable(scenario, from, state.tick),
          toServiceable: truthServiceable(scenario, to, state.tick)
        });
        state.active['Proxy Select'] = to;
        res.writeHead(204);
        res.end();
        return;
      }
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return {
    state,
    server,
    activeNode: () => state.active['Proxy Select'],
    isServiceable: (name, tick = state.tick) => truthServiceable(scenario, name, tick)
  };
}

function initialState(overrides = {}) {
  const now = Date.now();
  return {
    schemaVersion: 2,
    history: [],
    health: {},
    lastResults: null,
    monitorOnly: false,
    nextRunAt: new Date(now - 1000).toISOString(),
    nextConnectivityCheckAt: new Date(now + 60 * 60 * 1000).toISOString(),
    locks: {},
    lastAuto: {},
    lastSwitch: {},
    selectedBackend: 'demo',
    settings: {
      autoIntervalMinutes: 3,
      switchThresholdMs: 25,
      switchCooldownMinutes: 0,
      healthHalfLifeMinutes: 60,
      manualTestUrl: DEFAULT_TEST_URL,
      manualTimeoutMs: 1000,
      samples: 1,
      manualPauseMinutes: 15,
      connectivityCheckMinutes: 1,
      connectivityTimeoutMs: 1000
    },
    diagnostics: [],
    ...overrides
  };
}

async function startPilot(fake, stateSnapshot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-bench-'));
  const fakePort = await listen(fake.server);
  const configPath = path.join(root, 'config.yaml');
  const statePath = path.join(root, 'state.json');
  fs.writeFileSync(configPath, `external-controller: ${HOST}:${fakePort}\n`, 'utf8');
  fs.writeFileSync(statePath, JSON.stringify(stateSnapshot, null, 2), 'utf8');

  process.env.APPDATA = path.join(root, 'Roaming');
  process.env.LOCALAPPDATA = path.join(root, 'Local');
  process.env.USERPROFILE = root;
  process.env.HOME = root;
  process.env.CLASH_CONFIG = configPath;
  process.env.CLASH_PILOT_STATE = statePath;
  process.env.CLASH_TARGET_GROUP = 'Proxy Select';
  process.env.CLASH_PILOT_DEMO = '1';
  process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
  process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION = '1';
  process.env.PORT = '0';
  delete process.env.V2RAYN_HOME;

  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  const pilotPort = await listen(server);
  return {
    pilotPort,
    async close() {
      await closeServer(server);
      await closeServer(fake.server);
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function summarize({ name, endpoint, fake, responses, recoveryTimeSec, unavailableDurationSec }) {
  const switches = fake.state.puts.length;
  const falseSwitches = fake.state.puts.filter((event) => event.fromServiceable).length;
  const reasonCodes = responses.map((response) => response.body?.reasonCode || response.body?.code || `http-${response.status}`);
  return {
    name,
    endpoint,
    recoveryTimeSec,
    switches,
    unavailableDurationSec,
    probeCount: fake.state.probes.length,
    falseSwitches,
    finalActive: fake.activeNode(),
    reasonCodes
  };
}

async function runRegionalFailover(seed) {
  const fake = createFakeController({ scenario: 'regional-failover', seed });
  const context = await startPilot(fake, initialState());
  const responses = [];
  let outageStartedAt = null;
  let recoveredAt = null;
  let unavailableDurationSec = 0;
  try {
    for (let tick = 0; tick < 8; tick++) {
      fake.state.tick = tick;
      const activeBefore = fake.activeNode();
      const availableBefore = fake.isServiceable(activeBefore, tick);
      if (!availableBefore) {
        if (outageStartedAt === null) outageStartedAt = tick * STEP_SECONDS;
        unavailableDurationSec += STEP_SECONDS;
      }
      const response = await postJson(context.pilotPort, '/api/connectivity-heal', { timeout: 1000, budgetMs: 10000 });
      responses.push(response);
      if (outageStartedAt !== null && recoveredAt === null && fake.isServiceable(fake.activeNode(), tick)) {
        recoveredAt = (tick + 1) * STEP_SECONDS;
      }
    }
    return summarize({
      name: 'regional-failover',
      endpoint: 'POST /api/connectivity-heal',
      fake,
      responses,
      recoveryTimeSec: outageStartedAt === null || recoveredAt === null ? null : recoveredAt - outageStartedAt,
      unavailableDurationSec
    });
  } finally {
    await context.close();
  }
}

async function runTargetOutageAuto(seed) {
  const fake = createFakeController({ scenario: 'target-outage-auto', seed });
  const context = await startPilot(fake, initialState());
  try {
    fake.state.tick = 0;
    const unavailableDurationSec = fake.isServiceable(fake.activeNode(), 0) ? 0 : STEP_SECONDS;
    const response = await postJson(context.pilotPort, '/api/auto-optimize', {});
    return summarize({
      name: 'target-outage-auto',
      endpoint: 'POST /api/auto-optimize',
      fake,
      responses: [response],
      recoveryTimeSec: 0,
      unavailableDurationSec
    });
  } finally {
    await context.close();
  }
}

async function runThresholdNoise(seed) {
  const fake = createFakeController({ scenario: 'threshold-noise', seed });
  const context = await startPilot(fake, initialState());
  try {
    fake.state.tick = 0;
    const unavailableDurationSec = fake.isServiceable(fake.activeNode(), 0) ? 0 : STEP_SECONDS;
    const response = await postJson(context.pilotPort, '/api/auto-optimize', {});
    return summarize({
      name: 'threshold-noise',
      endpoint: 'POST /api/auto-optimize',
      fake,
      responses: [response],
      recoveryTimeSec: 0,
      unavailableDurationSec
    });
  } finally {
    await context.close();
  }
}

const RUNNERS = {
  'regional-failover': runRegionalFailover,
  'target-outage-auto': runTargetOutageAuto,
  'threshold-noise': runThresholdNoise
};

function printTable(report) {
  console.log(`Clash Node Pilot benchmark (seed ${report.seed})`);
  console.log(`Step size: ${report.stepSeconds}s`);
  const rows = report.results.map((item) => ({
    Scenario: item.name,
    Recovery: item.recoveryTimeSec === null ? 'n/a' : String(item.recoveryTimeSec),
    Switches: String(item.switches),
    Unavailable: String(item.unavailableDurationSec),
    Probes: String(item.probeCount),
    False: String(item.falseSwitches),
    Final: item.finalActive,
    Outcome: item.reasonCodes.at(-1)
  }));
  const headers = ['Scenario', 'Recovery', 'Switches', 'Unavailable', 'Probes', 'False', 'Final', 'Outcome'];
  const widths = Object.fromEntries(headers.map((header) => [
    header,
    Math.max(header.length, ...rows.map((row) => row[header].length))
  ]));
  console.log(headers.map((header) => header.padEnd(widths[header])).join('  '));
  console.log(headers.map((header) => '-'.repeat(widths[header])).join('  '));
  for (const row of rows) {
    console.log(headers.map((header) => row[header].padEnd(widths[header])).join('  '));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  const scenarios = options.scenario ? [options.scenario] : Object.keys(RUNNERS);
  for (const scenario of scenarios) {
    if (!RUNNERS[scenario]) throw new Error(`Unknown scenario "${scenario}". Use one of: ${Object.keys(RUNNERS).join(', ')}`);
  }
  const results = [];
  for (const scenario of scenarios) {
    results.push(await RUNNERS[scenario](options.seed));
  }
  const report = { seed: options.seed, stepSeconds: STEP_SECONDS, results };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printTable(report);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
