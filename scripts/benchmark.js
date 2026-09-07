const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const clock = require('../src/core/clock');

const HOST = '127.0.0.1';
const STEP_SECONDS = 30;
const DEFAULT_SEED = 20260907;
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const VERIFY_TEST_URL = 'https://cp.cloudflare.com/generate_204';
const NODE_NAMES = ['Japan 01', 'Japan 02', 'US 01'];
const EPOCH = Date.UTC(2026, 8, 7);
const TICKS = 12;
const sessions = new Map();

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
    '  cooldown-expiry',
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

function postJson(port, route, body = {}, method = 'POST') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port,
      path: route,
      method,
      headers: {
        Host: `${HOST}:${port}`,
        'Content-Type': 'application/json',
        ...(sessions.has(port) ? { 'x-pilot-session': sessions.get(port) } : {})
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
    req.end(method === 'GET' ? undefined : JSON.stringify(body));
  });
}

function baseDelay(scenario, name, tick = 0) {
  if (scenario === 'threshold-noise') {
    return { 'Japan 01': tick % 2 ? 90 : 100, 'Japan 02': tick % 2 ? 100 : 90, 'US 01': 130 }[name] || null;
  }
  if (scenario === 'cooldown-expiry') return { 'Japan 01': tick === 0 ? 100 : 35, 'Japan 02': tick === 0 ? 35 : 100, 'US 01': 150 }[name] || null;
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
  if (scenario === 'target-outage-auto' && tick >= 2 && tick <= 7 && targetUrl === DEFAULT_TEST_URL) return null;
  const base = baseDelay(scenario, name, tick);
  if (!base) return null;
  const jitter = deterministicJitter(seed, scenario, tick, name, targetUrl);
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
  const now = clock.now();
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
      switchCooldownMinutes: 2,
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
  const session = await postJson(pilotPort, '/api/session', {}, 'GET');
  assert.equal(session.status, 200, 'Session bootstrap must succeed');
  assert.equal(typeof session.body.token, 'string');
  sessions.set(pilotPort, session.body.token);
  return {
    pilotPort,
    async close() {
      await closeServer(server);
      await closeServer(fake.server);
      sessions.delete(pilotPort);
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function summarizePolicy(name, policy, observations, probes, writes, reasonCodes = []) {
  const outageStart = observations.findIndex((item) => !item.availableBefore);
  const recovery = outageStart < 0 ? null : observations.findIndex((item, index) => index >= outageStart && item.availableAfter);
  return {
    name, policy, ticks: observations.length,
    recoverySteps: outageStart < 0 ? 0 : recovery < 0 ? null : recovery - outageStart + 1,
    unavailableBeforeActionSteps: observations.filter((item) => !item.availableBefore).length,
    unavailableAfterActionSteps: observations.filter((item) => !item.availableAfter).length,
    switches: writes.length,
    probeCount: probes.length,
    harmfulSwitches: writes.filter((item) => item.fromServiceable && !item.toServiceable).length,
    healthyNodeSwitches: writes.filter((item) => item.fromServiceable && item.toServiceable).length,
    meanSelectedLatencyMs: mean(observations.filter((item) => item.availableAfter).map((item) => item.latency)),
    finalActive: observations.at(-1).activeAfter,
    reasonCodes,
    observations
  };
}

function mean(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : null;
}

function observation(scenario, seed, tick, activeBefore, activeAfter) {
  return {
    tick, simulatedAt: new Date(EPOCH + tick * STEP_SECONDS * 1000).toISOString(),
    activeBefore, activeAfter,
    availableBefore: truthServiceable(scenario, activeBefore, tick),
    availableAfter: truthServiceable(scenario, activeAfter, tick),
    latency: delayFor({ scenario, seed, name: activeAfter, tick, targetUrl: VERIFY_TEST_URL })
  };
}

function baseline(scenario, seed, policy) {
  let active = NODE_NAMES[0];
  const observations = [];
  const probes = [];
  const writes = [];
  for (let tick = 0; tick < TICKS; tick++) {
    const before = active;
    if (policy === 'naive-lowest-latency') {
      const candidates = NODE_NAMES.map((name) => {
        const delay = delayFor({ scenario, seed, name, tick, targetUrl: DEFAULT_TEST_URL });
        probes.push({ tick, name, delay });
        return { name, delay };
      }).filter((item) => item.delay !== null).sort((a, b) => a.delay - b.delay || a.name.localeCompare(b.name));
      if (candidates.length) active = candidates[0].name;
    }
    if (active !== before) writes.push({
      tick, from: before, to: active,
      fromServiceable: truthServiceable(scenario, before, tick),
      toServiceable: truthServiceable(scenario, active, tick)
    });
    observations.push(observation(scenario, seed, tick, before, active));
  }
  return summarizePolicy(scenario, policy, observations, probes, writes);
}

function assertInvariants(result, responses, writes) {
  assert.equal(result.ticks, TICKS);
  assert.equal(result.harmfulSwitches, 0, 'Policy must never select a known unavailable node');
  for (const response of responses) assert.equal(response.status, 200, 'Every HTTP policy request must succeed');
  for (const item of result.observations) assert.ok(NODE_NAMES.includes(item.activeAfter));
  if (result.name === 'threshold-noise') {
    assert.equal(result.switches, 0, 'Sub-threshold alternating noise must not cause switches');
    assert.ok(result.reasonCodes.includes('below-threshold'));
  }
  if (result.name === 'target-outage-auto') {
    assert.ok(result.reasonCodes.includes('target-service-outage'), JSON.stringify({ reasonCodes: result.reasonCodes, observations: result.observations }));
    for (const item of result.observations) assert.ok(isJapan(item.activeAfter), 'Single-target failure must not force a region change');
  }
  if (result.name === 'regional-failover') {
    assert.equal(result.observations[2].activeAfter, 'US 01', 'Regional outage must cause healthy fallback');
    assert.equal(result.unavailableAfterActionSteps, 0);
  }
  if (result.name === 'cooldown-expiry') {
    assert.ok(result.reasonCodes.includes('cooldown-active'), 'Continuous trajectory must exercise cooldown');
    assert.ok(writes.some((item) => item.tick >= 4 && item.to === 'Japan 01'), 'Clock advancement must permit switching after cooldown expiry');
    assert.ok(!writes.some((item) => item.tick > 0 && item.tick < 4), 'Healthy switches must obey cooldown');
  }
}

async function runScenario(scenario, seed) {
  clock.setForTesting(EPOCH);
  const fake = createFakeController({ scenario, seed });
  let context;
  try {
    context = await startPilot(fake, initialState());
    const observations = [];
    const responses = [];
    for (let tick = 0; tick < TICKS; tick++) {
      fake.state.tick = tick;
      clock.setForTesting(EPOCH + tick * STEP_SECONDS * 1000);
      const before = fake.activeNode();
      const response = await postJson(context.pilotPort, '/api/auto-optimize', { force: true });
      responses.push(response);
      observations.push(observation(scenario, seed, tick, before, fake.activeNode()));
    }
    const reasonCodes = responses.map((response) => response.body?.reasonCode || response.body?.code || `http-${response.status}`);
    const result = summarizePolicy(scenario, 'pilot-http', observations, fake.state.probes, fake.state.puts, reasonCodes);
    assertInvariants(result, responses, fake.state.puts);
    return [result, baseline(scenario, seed, 'fixed-initial'), baseline(scenario, seed, 'naive-lowest-latency')];
  } finally {
    if (context) await context.close();
    clock.reset();
  }
}

const SCENARIOS = ['regional-failover', 'target-outage-auto', 'threshold-noise', 'cooldown-expiry'];

function printTable(report) {
  console.log(`Clash Node Pilot synthetic policy benchmark (seed ${report.seed})`);
  console.log(`Each step advances the injected clock by ${report.stepSeconds}s; recovery is in action steps, not real seconds.`);
  console.table(report.results.map((item) => ({
    Scenario: item.name, Policy: item.policy, RecoverySteps: item.recoverySteps,
    UnavailableBefore: item.unavailableBeforeActionSteps,
    UnavailableAfter: item.unavailableAfterActionSteps,
    Switches: item.switches, Probes: item.probeCount,
    HarmfulSwitches: item.harmfulSwitches, MeanLatencyMs: item.meanSelectedLatencyMs
  })));
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return showHelp();
  const scenarios = options.scenario ? [options.scenario] : SCENARIOS;
  for (const scenario of scenarios) {
    if (!SCENARIOS.includes(scenario)) throw new Error(`Unknown scenario "${scenario}". Use one of: ${SCENARIOS.join(', ')}`);
  }
  const results = [];
  for (const scenario of scenarios) results.push(...await runScenario(scenario, options.seed));
  const report = {
    schemaVersion: 2, seed: options.seed, stepSeconds: STEP_SECONDS, ticks: TICKS,
    clock: 'in-process injected policy clock; real network deadlines unchanged',
    comparison: 'Identical seeded node/target/tick outcomes and action cadence; unequal probe budgets are reported explicitly. Fixed uses zero probes, naive uses three primary probes per step, Pilot uses its adaptive primary/verification probes. No equal-cost or real-world superiority claim.',
    results
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printTable(report);
  return report;
}

module.exports = { baseline, delayFor, parseArgs, runScenario, SCENARIOS, summarizePolicy, truthServiceable };
if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
