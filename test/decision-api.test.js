const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

function createController({ active = 'Japan 01', delays = {}, applyPut = true } = {}) {
  const state = { active, puts: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: 'fake-decision' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/proxies') {
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
      const delay = delays[name];
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

async function withPilot(fake, stateSnapshot, run) {
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
  try {
    await run(pilotPort, statePath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fake.close();
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
