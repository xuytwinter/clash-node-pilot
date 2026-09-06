const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createController({ active = 'Japan 01', delays = {}, applyPut = true, failReadbackAfterPut = false } = {}) {
  const state = { active, puts: [], delayRequests: [], failProxies: false };
  const resolveDelay = typeof delays === 'function' ? delays : (name) => delays[name];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-decision' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proxies') {
      if (state.failProxies) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'controller unavailable' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proxies: {
          'Proxy Select': { type: 'Selector', now: state.active, all: ['Japan 01', 'Japan 02', 'US 01'] },
          'Japan 01': { type: 'Vless' },
          'Japan 02': { type: 'Vless' },
          'US 01': { type: 'Vless' }
        }
      }));
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/proxies/') && url.pathname.endsWith('/delay')) {
      const name = decodeURIComponent(url.pathname.split('/')[2]);
      const testUrl = url.searchParams.get('url');
      state.delayRequests.push({ name, timeout: url.searchParams.get('timeout'), testUrl });
      const delay = resolveDelay(name, testUrl);
      res.writeHead(delay ? 200 : 504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(delay ? { delay } : { message: 'timeout' }));
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/proxies/Proxy%20Select') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      state.puts.push(body.name);
      if (applyPut) state.active = body.name;
      if (failReadbackAfterPut) state.failProxies = true;
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
  return {
    state,
    listen: () => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function postJson(port, pathName, body = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathName,
      method: 'POST',
      headers: {
        Host: `127.0.0.1:${port}`,
        'Content-Type': 'application/json'
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function startPilot(fake, stateSnapshot) {
  const fakePort = await fake.listen();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'clash-node-pilot-decision-api-'));
  const configPath = path.join(sandbox, 'config.yaml');
  const statePath = path.join(sandbox, 'state.json');
  fs.writeFileSync(configPath, `external-controller: 127.0.0.1:${fakePort}\n`, 'utf8');
  fs.writeFileSync(statePath, JSON.stringify(stateSnapshot), 'utf8');

  process.env.APPDATA = path.join(sandbox, 'Roaming');
  process.env.LOCALAPPDATA = path.join(sandbox, 'Local');
  process.env.USERPROFILE = sandbox;
  process.env.HOME = sandbox;
  process.env.CLASH_CONFIG = configPath;
  process.env.CLASH_PILOT_STATE = statePath;
  process.env.CLASH_PILOT_DISABLE_AUTO_LOOP = '1';
  process.env.CLASH_PILOT_DISABLE_OS_INTEGRATION = '1';
  process.env.CLASH_PILOT_DEMO = '1';
  process.env.CLASH_TARGET_GROUP = 'Proxy Select';
  process.env.PORT = '0';

  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  const pilotPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  let serverClosed = false;
  const closeServer = async () => {
    if (serverClosed) return;
    serverClosed = true;
    await new Promise((resolve) => server.close(resolve));
  };
  return {
    pilotPort,
    statePath,
    closeServer,
    close: async () => {
      await closeServer();
      await fake.close();
    }
  };
}

async function openPilotFromEnv() {
  delete require.cache[require.resolve('../server')];
  const { server } = require('../server');
  const pilotPort = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  return {
    pilotPort,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function withPilot(fake, stateSnapshot, run) {
  const context = await startPilot(fake, stateSnapshot);
  try {
    await run(context.pilotPort, context.statePath);
  } finally {
    await context.close();
  }
}

function dueState(overrides = {}) {
  const now = Date.now();
  return {
    schemaVersion: 2,
    selectedBackend: 'demo',
    nextRunAt: new Date(now - 1000).toISOString(),
    nextConnectivityCheckAt: new Date(now + 60 * 60 * 1000).toISOString(),
    settings: {
      autoIntervalMinutes: 3,
      switchThresholdMs: 25,
      switchCooldownMinutes: 60,
      healthHalfLifeMinutes: 60,
      samples: 1,
      manualPauseMinutes: 15,
      connectivityCheckMinutes: 1,
      connectivityTimeoutMs: 5000
    },
    lastSwitch: {
      'demo|Proxy%20Select': now
    },
    ...overrides
  };
}

test('automatic optimization holds during cooldown when current node is healthy', async () => {
  const fake = createController({ delays: { 'Japan 01': 100, 'Japan 02': 50, 'US 01': 130 } });
  await withPilot(fake, dueState(), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/auto-optimize', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, false);
    assert.equal(response.body.reasonCode, 'cooldown-active');
    assert.equal(response.body.decision.action, 'hold');
    assert.equal(response.body.decision.protection.remainingCooldownMs > 0, true);
    assert.deepEqual(fake.state.puts, []);
  });
});

test('automatic optimization bypasses cooldown when the current region hard-fails', async () => {
  const fake = createController({ delays: { 'Japan 02': 80, 'US 01': 130 } });
  await withPilot(fake, dueState(), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/auto-optimize', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, true);
    assert.equal(response.body.active, 'Japan 02');
    assert.equal(response.body.reasonCode, 'switched');
    assert.equal(response.body.decision.action, 'switch');
    assert.equal(response.body.decision.protection.cooldownBypassed, true);
    assert.deepEqual(fake.state.puts, ['Japan 02']);
  });
});

test('automatic optimization rechecks the same region before crossing regions on target outage', async () => {
  const fake = createController({
    delays: (name, testUrl) => {
      if (testUrl === 'https://www.gstatic.com/generate_204' && (name === 'Japan 01' || name === 'Japan 02')) return undefined;
      if (testUrl === 'https://cp.cloudflare.com/generate_204' && name === 'Japan 01') return 95;
      if (testUrl === 'https://cp.cloudflare.com/generate_204' && name === 'Japan 02') return 55;
      if (testUrl === 'https://www.gstatic.com/generate_204' && name === 'US 01') return 120;
      if (testUrl === 'https://cp.cloudflare.com/generate_204' && name === 'US 01') return 130;
      return undefined;
    }
  });
  await withPilot(fake, dueState({ settings: { ...dueState().settings, switchCooldownMinutes: 0 } }), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/auto-optimize', {});
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, false);
    assert.equal(response.body.reasonCode, 'target-service-outage');
    assert.equal(response.body.decision.code, 'target-service-outage');
    assert.equal(response.body.active, 'Japan 01');
    assert.equal(fake.state.delayRequests.some((request) => request.name === 'US 01'), false);
    const defaultRequests = fake.state.delayRequests.filter((request) => request.testUrl === 'https://www.gstatic.com/generate_204');
    const verifyRequests = fake.state.delayRequests.filter((request) => request.testUrl === 'https://cp.cloudflare.com/generate_204');
    assert.deepEqual(defaultRequests.map((request) => request.name).sort(), ['Japan 01', 'Japan 02']);
    assert.deepEqual(verifyRequests.map((request) => request.name).sort(), ['Japan 01', 'Japan 02']);
    assert.ok(fake.state.delayRequests.lastIndexOf(defaultRequests.at(-1)) < fake.state.delayRequests.indexOf(verifyRequests[0]));
    assert.deepEqual(response.body.resultBatches.map((batch) => ({ target: batch.target, candidates: batch.candidates })), [
      { target: 'https://www.gstatic.com/generate_204', candidates: ['Japan 01', 'Japan 02'] },
      { target: 'https://cp.cloudflare.com/generate_204', candidates: ['Japan 01', 'Japan 02'] }
    ]);
  });
});

test('selector write must be confirmed by readback before reporting switched', async () => {
  const fake = createController({ delays: { 'Japan 01': 100, 'Japan 02': 50 }, applyPut: false });
  await withPilot(fake, dueState({ lastSwitch: {}, settings: { ...dueState().settings, switchCooldownMinutes: 0 } }), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/optimize', {
      group: 'Proxy Select',
      region: 'jp',
      switch: true,
      testUrl: 'https://www.gstatic.com/generate_204',
      timeout: 1000
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, false);
    assert.equal(response.body.reasonCode, 'write-not-applied');
    assert.equal(response.body.active, 'Japan 01');
    assert.equal(response.body.commit.verified, false);
    assert.deepEqual(fake.state.puts, ['Japan 02']);
  });
});

test('selector write reports unknown result when readback fails after commit starts', async () => {
  const fake = createController({ delays: { 'Japan 01': 100, 'Japan 02': 50 }, failReadbackAfterPut: true });
  await withPilot(fake, dueState({ lastSwitch: {}, settings: { ...dueState().settings, switchCooldownMinutes: 0 } }), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/optimize', {
      group: 'Proxy Select',
      region: 'jp',
      switch: true,
      testUrl: 'https://www.gstatic.com/generate_204',
      timeout: 1000
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.switched, false);
    assert.equal(response.body.reasonCode, 'write-result-unknown');
    assert.equal(response.body.decision.code, 'write-result-unknown');
    assert.equal(response.body.commit.writeResult, 'unknown');
    assert.equal(response.body.commit.verified, false);
    assert.deepEqual(fake.state.puts, ['Japan 02']);
  });
});

test('manual switch persists cooldown across a pilot restart', async () => {
  let phase = 'manual';
  const fake = createController({
    delays: (name) => {
      if (phase === 'manual') {
        if (name === 'Japan 01') return 100;
        if (name === 'Japan 02') return 50;
      } else {
        if (name === 'Japan 01') return 40;
        if (name === 'Japan 02') return 100;
      }
      return undefined;
    }
  });
  const settings = { ...dueState().settings, switchCooldownMinutes: 5 };
  const context = await startPilot(fake, dueState({ lastSwitch: {}, settings }));
  try {
    const manual = await postJson(context.pilotPort, '/api/optimize', {
      group: 'Proxy Select',
      region: 'jp',
      switch: true,
      testUrl: 'https://www.gstatic.com/generate_204',
      timeout: 1000
    });
    assert.equal(manual.status, 200);
    assert.equal(manual.body.switched, true);
    const saved = JSON.parse(fs.readFileSync(context.statePath, 'utf8'));
    assert.ok(saved.lastSwitch['demo|Proxy%20Select'] > 0);

    phase = 'restart';
    await context.closeServer();
    const restarted = await openPilotFromEnv();
    try {
      const unlock = await postJson(restarted.pilotPort, '/api/automation', { action: 'unlock' });
      assert.equal(unlock.status, 200);
      const auto = await postJson(restarted.pilotPort, '/api/auto-optimize', {});
      assert.equal(auto.status, 200);
      assert.equal(auto.body.switched, false);
      assert.equal(auto.body.reasonCode, 'cooldown-active');
      assert.equal(auto.body.decision.protection.remainingCooldownMs > 0, true);
    } finally {
      await restarted.close();
    }
  } finally {
    await context.close();
  }
});

test('manual optimization uses persisted probe URL and timeout settings', async () => {
  const fake = createController({ delays: { 'Japan 01': 100, 'Japan 02': 50 } });
  const settings = {
    ...dueState().settings,
    switchCooldownMinutes: 0,
    manualTestUrl: 'https://cp.cloudflare.com/generate_204',
    manualTimeoutMs: 1500
  };
  await withPilot(fake, dueState({ lastSwitch: {}, settings }), async (pilotPort) => {
    const response = await postJson(pilotPort, '/api/optimize', {
      group: 'Proxy Select',
      region: 'jp',
      switch: false
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.reasonCode, 'switch-disabled');
    assert.equal(fake.state.delayRequests.length, 2);
    assert.equal(fake.state.delayRequests.every((request) => request.timeout === '1500'), true);
    assert.equal(fake.state.delayRequests.every((request) => request.testUrl === 'https://cp.cloudflare.com/generate_204'), true);
  });
});
